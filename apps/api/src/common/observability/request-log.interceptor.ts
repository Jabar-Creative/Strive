import { randomUUID } from 'node:crypto';
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

import { ringkasanIp, type SumberIp } from '../client-ip';
import { barisLog, formatJson } from './structured-logger';

/** Header yang dipakai kalau proxy sudah menyetel id-nya. */
export const HEADER_REQUEST_ID = 'x-request-id';

interface ReqLog extends SumberIp {
  method?: string;
  path?: string;
  url?: string;
  route?: { path?: string };
  user?: { id?: string };
}

/**
 * Satu baris log per request — `R-04`, PRD §17.1.
 *
 * > Wajib ada: `request_id`, `user_id` (kalau ada), `route`, `duration_ms`,
 * > `status`.
 *
 * Kelima bidang itu yang membuat §17.2 bisa dihitung sama sekali: error rate
 * 5xx dan p95 latensi `/hub` tidak punya sumber lain.
 *
 * ── `route`, bukan `url` ──
 *
 * `/squads/abc-123/leaderboard` dan `/squads/def-456/leaderboard` adalah rute
 * yang SAMA. Mencatat URL mentah membuat p95 per rute tidak bisa dihitung —
 * setiap baris jadi rute tersendiri — dan sekalian menaruh id sumber daya
 * pengguna di log yang dibaca banyak orang.
 *
 * ── `request_id` dari header kalau ada ──
 *
 * Kalau nanti ada proxy yang sudah menyetelnya, satu request harus bisa
 * ditelusuri lintas layanan dengan id yang sama. Membuat id baru di sini akan
 * memutus rantai itu tepat di tempat yang paling dibutuhkan.
 *
 * ── Interceptor, bukan middleware ──
 *
 * Middleware berjalan sebelum guard, jadi `user_id` belum ada. Alasan yang
 * sama persis dengan `RateLimitInterceptor`.
 */
@Injectable()
export class RequestLogInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const http = context.switchToHttp();
    const req = http.getRequest<ReqLog>();
    const res = http.getResponse<{ statusCode?: number; setHeader(n: string, v: string): void }>();

    const dari = req.headers[HEADER_REQUEST_ID];
    const requestId = (Array.isArray(dari) ? dari[0] : dari) || randomUUID();
    res.setHeader(HEADER_REQUEST_ID, requestId);

    // Diambil SEBELUM handler. Rute auth menimpa X-Forwarded-For menjadi satu
    // IP sebelum Better-Auth membacanya; menghitung sesudah itu selalu 1 dan
    // tidak lagi bisa dipakai mengukur hop.
    const ip = ringkasanIp(req);

    const mulai = process.hrtime.bigint();
    const tulis = (status: number): void => {
      if (!formatJson()) return;
      const durasi = Number(process.hrtime.bigint() - mulai) / 1_000_000;
      process.stdout.write(
        `${barisLog(status >= 500 ? 'error' : 'log', 'http', {
          request_id: requestId,
          user_id: req.user?.id ?? null,
          method: req.method ?? null,
          route: req.route?.path ?? req.path ?? req.url ?? null,
          status,
          duration_ms: Number(durasi.toFixed(1)),
          client_ip: ip.clientIp,
          xff_count: ip.xffCount,
          trust_proxy_hops: ip.hops,
        })}\n`,
      );
    };

    return next.handle().pipe(
      tap({
        next: () => tulis(res.statusCode ?? 200),
        // Galat TETAP dicatat. Baris request yang hanya muncul saat berhasil
        // membuat error rate 5xx mustahil dihitung — pembilangnya hilang,
        // dan yang tersisa justru terlihat seperti sistem yang sehat.
        error: (err: unknown) => tulis(statusDari(err)),
      }),
    );
  }
}

/** Status HTTP dari exception Nest; apa pun yang tidak punya berarti 500. */
function statusDari(err: unknown): number {
  const s = (err as { status?: unknown } | null)?.status;
  return typeof s === 'number' ? s : 500;
}
