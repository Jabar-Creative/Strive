import type { SendAuthEmail, StriveAuth } from './auth.types';
import { createAuth } from './auth.config';
import { appOrigins } from '../../common/app-origin';

/**
 * Instance Better-Auth untuk proses API nyata (A-03).
 *
 * A-01 menguji `createAuth()` lewat parameter eksplisit; provider ini adalah
 * pemanggil produksinya — satu-satunya tempat env auth dibaca. Kunci kosong
 * DITOLAK di sini, bukan diisi nilai contoh: keputusan F-02 (kunci dan token
 * di `.env.example` memang dikosongkan), dan pengecekan panjang naif yang
 * meloloskan string kosong adalah jebakan yang sudah dicatat di CLAUDE.md.
 */

/** Prefiks global NestJS (main.ts) + path bawaan Better-Auth. */
export const AUTH_HTTP_BASE_PATH = '/api/v1/auth';

export function createAuthFromEnv(sendEmail?: SendAuthEmail): StriveAuth {
  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL belum diset. Salin .env.example ke .env, atau set variabelnya di shell.',
    );
  }

  const secret = process.env['AUTH_SECRET'];
  // 32 byte = ambang minimum Better-Auth. String kosong atau whitespace
  // hanya mengecoh `length` — makanya di-trim dulu.
  if (!secret || secret.trim().length < 32) {
    throw new Error(
      'AUTH_SECRET belum diset (minimal 32 karakter). Isi di .env — jangan pakai nilai contoh.',
    );
  }

  return createAuth({
    connectionString,
    secret,
    baseURL: process.env['API_URL'] ?? 'http://localhost:3001',
    basePath: AUTH_HTTP_BASE_PATH,
    trustedOrigins: appOrigins(),
    sendEmail,
  });
}
