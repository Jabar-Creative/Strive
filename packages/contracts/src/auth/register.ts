import { z } from 'zod';

/**
 * POST /auth/register — docs/PRD.md §10.3 + §7 E1 aturan AU-1, AU-2, AU-7.
 * Password minimal 10 karakter, TANPA aturan komposisi (huruf besar/simbol) —
 * keputusan produk eksplisit (AU-2): panjang lebih efektif, dan aturan
 * komposisi mendorong orang memakai pola predictable seperti "Password1!".
 * `timezone` opsional; server fallback ke 'Asia/Jakarta' kalau tidak valid
 * (AU-7) — validasi IANA yang sebenarnya terjadi di server, bukan di sini.
 */
// `.max(128)` di password — koreksi audit F-08 (T-4), sama alasannya seperti
// login.ts: tanpa batas atas, hashing scrypt Better-Auth bisa dibebani
// input megabyte tanpa perlu login dulu.
export const registerRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(10, 'Password minimal 10 karakter').max(128),
  display_name: z.string().min(1).max(100),
  timezone: z.string().optional(),
});
export type RegisterRequest = z.infer<typeof registerRequestSchema>;
