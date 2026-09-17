import { z } from 'zod';
import { userSchema } from './user';

/** GET /me — docs/PRD.md §10.3 ("Profil, peran, saldo koin, zona waktu"). */
export const meResponseSchema = userSchema;
export type MeResponse = z.infer<typeof meResponseSchema>;

/** PATCH /me — docs/PRD.md §10.3: `{display_name?, timezone?, avatar_url?}`. */
export const updateMeRequestSchema = z.object({
  display_name: z.string().min(1).max(100).optional(),
  timezone: z.string().optional(),
  avatar_url: z.string().url().nullable().optional(),
});
export type UpdateMeRequest = z.infer<typeof updateMeRequestSchema>;
