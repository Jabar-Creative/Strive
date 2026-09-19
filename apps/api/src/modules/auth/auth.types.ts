import type { betterAuth } from 'better-auth';

/** Tipe instance Better-Auth yang dipakai repo ini. */
export type StriveAuth = ReturnType<typeof betterAuth>;

export interface AuthOptions {
  connectionString: string;
  secret: string;
  baseURL?: string;
  /**
   * Prefix path tempat handler Better-Auth dipasang (A-03). Test A-01 memanggil
   * `auth.api` langsung sehingga tak butuh ini; HTTP butuh — prefiks global
   * NestJS meletakkan handler di `/api/v1/auth/*`, dan tanpa opsi ini
   * Better-Auth mencocokkan path terhadap `/auth` bawaannya dan menolak semua.
   */
  basePath?: string;
  /**
   * Origin yang dipercaya untuk POST (perlindungan CSRF bawaan Better-Auth).
   * Web dan API berjalan di port berbeda, jadi origin web WAJIB terdaftar —
   * tanpa ini semua POST dari browser ditolak 403 INVALID_ORIGIN.
   */
  trustedOrigins?: string[];
  /**
   * Pengirim email untuk reset password & verifikasi (isu #65 poin 1).
   *
   * Sebuah FUNGSI, bukan `ResendMailerService`, dan itu disengaja:
   * `auth.config.ts` tidak boleh tahu vendor emailnya siapa, dan test bisa
   * menangkap email yang dikirim tanpa memalsukan HTTP. Kalau tidak diisi,
   * kedua callback tidak dipasang — dan Better-Auth kembali menjawab
   * `RESET_PASSWORD_DISABLED`, persis keadaan sebelum isu #65.
   */
  sendEmail?: SendAuthEmail;
}

/** Bentuk minimal pengiriman email yang dibutuhkan auth. */
export type SendAuthEmail = (pesan: { to: string; subject: string; html: string }) => Promise<void>;

/** Konteks sesi yang dicatat ke `audit_log` — sisa satu-satunya dari AU-5. */
export interface SessionContext {
  sessionId: string;
  ip: string | null;
  userAgent: string | null;
}

/** Token injeksi NestJS untuk instance Better-Auth. */
export const AUTH = Symbol('AUTH');
