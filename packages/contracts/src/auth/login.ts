import { z } from 'zod';
import { userSchema } from './user';

export const loginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, 'Password wajib diisi'),
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
