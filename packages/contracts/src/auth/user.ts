import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from '../common';

/** docs/PRD.md §9.2 ENUM `user_role`. */
export const userRoleSchema = z.enum(['student', 'mentor', 'superadmin']);
export type UserRole = z.infer<typeof userRoleSchema>;

/**
 * Bentuk umum objek `user` di response API — docs/PRD.md §9.3 tabel `users`.
 * Dipakai di banyak tempat (login, `/me`, admin user list), jadi didefinisikan
 * SATU KALI di sini lalu di-reuse, bukan ditulis ulang per endpoint.
 *
 * `password_hash` TIDAK PERNAH ada di sini — itu tidak boleh meninggalkan
 * server sama sekali (CLAUDE.md: kode error boleh diketahui, rahasia tidak).
 */
export const userSchema = z.object({
  id: uuidSchema,
  email: z.string().email(),
  display_name: z.string(),
  avatar_url: z.string().url().nullable(),
  role: userRoleSchema,
  timezone: z.string(),
  coin_balance: z.number().int(),
  status: z.enum(['active', 'suspended', 'deleted']),
  email_verified_at: isoDateTimeSchema.nullable(),
  created_at: isoDateTimeSchema,
});
export type User = z.infer<typeof userSchema>;
