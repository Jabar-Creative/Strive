import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JsonWebTokenError, verify } from 'jsonwebtoken';

/**
 * SEMENTARA — pengganti minimal untuk `A-02` (JwtGuard + RolesGuard + @Roles,
 * docs/BACKLOG.md), yang statusnya masih `todo` saat N-01 dikerjakan.
 *
 * `apps/api/src/common/guards/index.ts` secara eksplisit didokumentasikan
 * sebagai milik A-02 ("Diisi oleh A-02 (Dev A)"), jadi guard ini SENGAJA
 * ditaruh lokal di modul `notification`, bukan di `common/guards`, supaya
 * tidak bentrok dengan pekerjaan Dev A saat A-02 dikerjakan.
 *
 * Cakupannya sengaja sempit: verifikasi tanda tangan JWT Bearer terhadap
 * `AUTH_SECRET` (docs/PRD.md §10 "Auth Bearer JWT") dan ekstrak `sub` sebagai
 * user id. TIDAK ADA logika login/registrasi/refresh di sini — itu tetap
 * "dibeli" dari Better-Auth (CLAUDE.md §Yang dibeli, bukan dibangun).
 *
 * TODO(A-02): hapus file ini begitu JwtGuard resmi ada, lalu ganti
 * `@UseGuards(NotificationsAuthGuard)` di notifications.controller.ts dengan
 * `@UseGuards(JwtGuard)` dari `common/guards`. RolesGuard tidak relevan di
 * sini — kedua endpoint terbuka untuk semua peran yang sudah login, ownership
 * dicek di NotificationsService (CLAUDE.md §Guard vs kepemilikan).
 */

export interface AuthenticatedRequestLike {
  headers: Record<string, string | string[] | undefined>;
  // Diisi guard ini kalau token valid. Controller/decorator membacanya lagi.
  userId?: string;
}

@Injectable()
export class NotificationsAuthGuard implements CanActivate {
  private readonly logger = new Logger(NotificationsAuthGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequestLike>();
    const userId = this.extractUserId(request);
    request.userId = userId;
    return true;
  }

  private extractUserId(request: AuthenticatedRequestLike): string {
    const header = request.headers['authorization'];
    const value = Array.isArray(header) ? header[0] : header;

    if (!value?.startsWith('Bearer ')) {
      throw new UnauthorizedException({
        code: 'UNAUTHENTICATED',
        message: 'Header Authorization Bearer tidak ada',
        details: {},
      });
    }

    const secret = process.env['AUTH_SECRET'];
    if (!secret) {
      // Fail closed. AUTH_SECRET sengaja dikosongkan di .env.example
      // (docs/PRD.md §16.1) — dev lokal WAJIB mengisinya sendiri.
      this.logger.error('AUTH_SECRET belum diset — menolak semua request berautentikasi');
      throw new UnauthorizedException({
        code: 'UNAUTHENTICATED',
        message: 'Konfigurasi auth server belum siap',
        details: {},
      });
    }

    const token = value.slice('Bearer '.length);

    try {
      // `algorithms` dikunci eksplisit ke HS256 — tanpa ini token dengan
      // header `alg` lain (atau `none`) bisa memaksa jalur verifikasi yang
      // tidak dimaksud (algorithm confusion attack).
      const payload = verify(token, secret, { algorithms: ['HS256'] });
      const sub = typeof payload === 'object' && payload !== null ? payload.sub : undefined;
      if (typeof sub !== 'string' || sub.length === 0) {
        throw new JsonWebTokenError('klaim sub hilang atau bukan string');
      }
      return sub;
    } catch {
      // Pesan error jsonwebtoken (expired/invalid signature/dst) TIDAK
      // dikembalikan ke client — cukup kode kontrak (CLAUDE.md §Error).
      throw new UnauthorizedException({
        code: 'UNAUTHENTICATED',
        message: 'Token tidak valid atau kedaluwarsa',
        details: {},
      });
    }
  }
}
