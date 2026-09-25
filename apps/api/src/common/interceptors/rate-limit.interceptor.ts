import {
  CallHandler,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import type Redis from 'ioredis';
import type { Observable } from 'rxjs';

import { alamatKlien } from '../client-ip';
import { REDIS } from '../../infra/redis';

/** PRD §7 & §10.1: 120 req/menit per pengguna. */
export const BATAS_UMUM = 120;
/** PRD §16.1: lebih ketat untuk `/auth/*`. */
export const BATAS_AUTH = 10;
/** Jendela tetap 60 detik — PRD §9.4 memberi kunci `rl:` TTL 60 detik. */
export const JENDELA_DETIK = 60;

interface ReqRate {
  path?: string;
  url?: string;
  ip?: string;
  user?: { id?: string };
  headers: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
}

/**
 * Rate limit — `R-03`, PRD §7, §10.1, §16.1, §9.4.
 *
 * > Rate limit 120 req/menit per pengguna, lebih ketat untuk `/auth/*`
 * > (10/menit). Header `X-RateLimit-Remaining`.
 *
 * Sebelum ini **tidak ada rate limit sama sekali**. Yang dikira ada ternyata
 * default bawaan Better-Auth: mati kecuali `NODE_ENV=production`, 100 request
 * per 10 detik (600/menit — lima kali lebih longgar dari janjinya), hanya
 * untuk rute Better-Auth, dan counter-nya `Map` **di dalam proses** — jadi
 * dua instance berarti dua kali limitnya, dan setiap deploy meresetnya.
 * Kunci `rl:` yang didaftarkan §9.4 tidak pernah ditulis siapa pun.
 *
 * ── Interceptor, bukan guard atau middleware ──
 *
 * Yang dibatasi adalah **per pengguna**, jadi identitasnya harus sudah
 * diketahui. Middleware berjalan sebelum autentikasi; guard global berjalan
 * sebelum `SessionGuard`. Interceptor berjalan SETELAH semua guard, jadi
 * `request.user` sudah terisi untuk rute yang dijaga sesi.
 *
 * Alternatifnya — melakukan resolusi sesi sendiri di middleware — berarti
 * satu query Postgres untuk **setiap** request, termasuk banjir yang tidak
 * terautentikasi. Pembatas yang menambah beban database saat diserang adalah
 * penguat serangan, bukan pembatas.
 *
 * ── Rute publik dibatasi per alamat IP ──
 *
 * `/auth/sign-in` belum punya pengguna — di situlah justru limit paling
 * dibutuhkan. Identitasnya jatuh ke IP. Rantai `X-Forwarded-For` dihitung
 * dari kanan sebanyak `TRUST_PROXY_HOPS` (`alamatKlien`). Entri kiri milik
 * klien dan tidak dipakai.
 *
 * ── Satu ember per pengguna, BUKAN per rute ──
 *
 * §9.4 memberi bentuk kunci `rl:{user_id}:{route}`, tapi §7 dan §10.1
 * keduanya menulis "**global** per pengguna 120 req/menit". Ember per rute
 * jauh lebih longgar — 120/menit dikalikan jumlah rute — jadi yang dipakai
 * pembacaan yang lebih ketat, dan yang cocok dengan dua dari tiga tempat.
 * Perbedaan bentuk kunci ini diangkat sebagai isu, bukan diputuskan diam-diam.
 *
 * ── Redis mati berarti MEMBIARKAN LEWAT ──
 *
 * Aturan keras 7: Redis adalah turunan. Pembatas yang gagal tertutup mengubah
 * satu gangguan Redis menjadi padamnya seluruh API — kerusakan yang jauh
 * lebih besar daripada yang dicegahnya. Kehilangan counter berarti "limit
 * longgar sesaat", persis yang ditulis §9.4 di kolom "kalau hilang".
 */
@Injectable()
export class RateLimitInterceptor implements NestInterceptor {
  private readonly log = new Logger(RateLimitInterceptor.name);

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    if (context.getType() !== 'http') return next.handle();

    const http = context.switchToHttp();
    const req = http.getRequest<ReqRate>();
    const res = http.getResponse<{ setHeader(n: string, v: string): void }>();

    const jalur = req.path ?? req.url ?? '';
    const batas = jalur.includes('/auth/') ? BATAS_AUTH : BATAS_UMUM;
    const ember = jalur.includes('/auth/') ? 'auth' : 'all';
    const kunci = `rl:${identitas(req)}:${ember}`;

    let terpakai: number;
    try {
      terpakai = await this.redis.incr(kunci);
      // Hanya saat counter LAHIR. `EXPIRE` di setiap request akan menggeser
      // jendelanya maju terus, dan pengguna yang mengetuk tiap detik tidak
      // pernah direset — jendela geser yang tidak disengaja, dengan perilaku
      // yang jauh lebih ketat daripada yang dijanjikan.
      if (terpakai === 1) await this.redis.expire(kunci, JENDELA_DETIK);
    } catch (err) {
      const pesan = err instanceof Error ? err.message : String(err);
      this.log.warn(`Rate limit dilewati, Redis tidak bisa dihubungi: ${pesan}`);
      return next.handle();
    }

    const sisa = Math.max(0, batas - terpakai);
    res.setHeader('X-RateLimit-Limit', String(batas));
    res.setHeader('X-RateLimit-Remaining', String(sisa));

    if (terpakai > batas) {
      const sisaDetik = await this.sisaTtl(kunci);
      res.setHeader('Retry-After', String(sisaDetik));
      throw new HttpException(
        {
          error: {
            code: 'RATE_LIMITED',
            message: 'Terlalu banyak permintaan, coba lagi sebentar',
            details: { limit: batas, window_seconds: JENDELA_DETIK, retry_after: sisaDetik },
          },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return next.handle();
  }

  private async sisaTtl(kunci: string): Promise<number> {
    try {
      const ttl = await this.redis.ttl(kunci);
      return ttl > 0 ? ttl : JENDELA_DETIK;
    } catch {
      return JENDELA_DETIK;
    }
  }
}

/**
 * Pengguna kalau sesinya sudah terverifikasi, kalau tidak alamatnya.
 *
 * Diberi prefiks berbeda supaya satu ruang nama tidak bisa menyamar jadi yang
 * lain: id pengguna berbentuk uuid dan alamat IP tidak, tapi mengandalkan itu
 * berarti mengandalkan bentuk data yang bisa berubah.
 */
export function identitas(req: ReqRate): string {
  const id = req.user?.id;
  if (typeof id === 'string' && id.length > 0) return `u:${id}`;
  return `ip:${alamatKlien(req)}`;
}
