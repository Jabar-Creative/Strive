import { z } from 'zod';
import { userSchema } from './user';

/**
 * `.max(128)` — koreksi audit F-08 (temuan T-4): tanpa batas atas, endpoint
 * ini bisa dipanggil TANPA LOGIN dengan password sepanjang beberapa
 * megabyte. Better-Auth memakai scrypt yang mem-hash SELURUH input (beda
 * dari bcrypt yang memotong di 72 byte) — beberapa puluh request begitu
 * paralel cukup membebani CPU server untuk semua pengguna, bukan cuma
 * pemanggilnya sendiri.
 */
export const loginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, 'Password wajib diisi').max(128),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

/**
 * Sepasang token access+refresh — bentuk yang sama dipakai ulang oleh
 * respons login DAN respons refresh (docs/PRD.md §10.3: keduanya "→
 * {access, refresh, ...}"). AU-4: access 15 menit, refresh 30 hari dan
 * dirotasi setiap dipakai.
 */
export const authTokensSchema = z.object({
  access: z.string(),
  refresh: z.string(),
});
export type AuthTokens = z.infer<typeof authTokensSchema>;

/** POST /auth/login → `{access, refresh, user}` — docs/PRD.md §10.3. */
export const loginResponseSchema = authTokensSchema.extend({
  user: userSchema,
});
export type LoginResponse = z.infer<typeof loginResponseSchema>;
