import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';

import { DATABASE, type DB } from '../../infra/kysely';

/**
 * SEMENTARA — pengganti minimal untuk `A-02` (JwtGuard + RolesGuard + @Roles),
 * yang masih `todo`.
 *
 * `apps/api/src/common/guards/index.ts` didokumentasikan sebagai milik `A-02`
 * (Dev A), jadi guard ini sengaja tinggal lokal di modul `notification` supaya
 * tidak bentrok saat `A-02` dikerjakan.
 *
 * ── DITULIS ULANG SAAT REVIEW DEV A ────────────────────────────────────────
 *
 * Versi pertama memverifikasi **tanda tangan JWT** terhadap `AUTH_SECRET`, dan
 * itu benar menurut PRD saat `N-01` mulai dikerjakan.
 *
 * Premisnya berubah di bawahnya: isu #18 mengganti AU-4 dari "access token JWT
 * 15 menit + refresh token dirotasi" menjadi **sesi server Better-Auth dengan
 * token buram**, dan `A-01` menjalankannya beberapa jam sebelum PR ini
 * di-review. **Sistem ini tidak menerbitkan JWT sama sekali lagi.**
 *
 * Guard versi lama karena itu akan menolak SETIAP sesi sungguhan — rute yang
 * terlihat hidup tapi tidak bisa dimasuki siapa pun. Dependensi `jsonwebtoken`
 * ikut dibuang; tidak ada lagi yang memakainya.
 *
 * Sekarang: token Bearer dicocokkan ke baris `sessions` (kolom `token` UNIQUE
 * sejak migrasi 004) dan masa berlakunya diperiksa **di dalam SQL**, bukan
 * dengan membandingkan `Date` milik Node — `expires_at` bertipe `timestamptz`,
 * dan perbandingan waktu yang benar adalah urusan Postgres.
 *
 * TODO(A-02): hapus berkas ini begitu `JwtGuard` resmi ada — namanya akan
 * berubah juga, karena tidak ada JWT lagi untuk dijaga.
 */

export interface AuthenticatedRequestLike {
  headers: Record<string, string | string[] | undefined>;
  /** Diisi guard ini kalau sesinya sah. Controller/decorator membacanya lagi. */
  userId?: string;
}

@Injectable()
export class NotificationsAuthGuard implements CanActivate {
  constructor(@Inject(DATABASE) private readonly db: Kysely<DB>) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequestLike>();
    request.userId = await this.resolveUserId(request);
    return true;
  }

  private async resolveUserId(request: AuthenticatedRequestLike): Promise<string> {
    const header = request.headers['authorization'];
    const value = Array.isArray(header) ? header[0] : header;

    if (!value?.startsWith('Bearer ')) {
      throw new UnauthorizedException({
        error: {
          code: 'UNAUTHENTICATED',
          message: 'Header Authorization Bearer tidak ada',
        },
      });
    }

    const token = value.slice('Bearer '.length).trim();

    // Kedaluwarsa dibandingkan di SQL. Membandingkannya di Node berarti
    // bergantung pada jam proses, dan itu kelas bug yang sama dengan
    // menghitung "hari ini" di luar Postgres (CLAUDE.md aturan 5).
    const sesi = await this.db
      .selectFrom('sessions')
      .select('user_id')
      .where('token', '=', token)
      .where(sql<boolean>`expires_at > now()`)
      .executeTakeFirst();

    if (!sesi) {
      // Pesannya sengaja TIDAK membedakan "token tidak ada" dari "token
      // kedaluwarsa": bedanya tidak berguna bagi pengguna yang sah, dan
      // berguna bagi yang menebak-nebak token.
      throw new UnauthorizedException({
        error: {
          code: 'UNAUTHENTICATED',
          message: 'Sesi tidak valid atau sudah berakhir',
        },
      });
    }

    return sesi.user_id;
  }
}
