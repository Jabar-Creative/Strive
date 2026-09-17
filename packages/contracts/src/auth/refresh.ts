import { z } from 'zod';
import { authTokensSchema } from './login';

/**
 * POST /auth/refresh — docs/PRD.md §10.3 ("Rotasi token; token lama langsung
 * dicabut") + AU-4/AU-5. PRD tidak menuliskan bentuk body secara eksplisit;
 * ASUMSI: refresh token dikirim di body (konsisten dengan `authTokensSchema`
 * yang sudah dipakai di respons login). Kalau implementasi Dev A memakai
 * cookie httpOnly alih-alih body, skema ini perlu direvisi di PR susulan.
 */
export const refreshRequestSchema = z.object({
  refresh: z.string(),
});
export type RefreshRequest = z.infer<typeof refreshRequestSchema>;

/** Token baru hasil rotasi — bentuknya sama dengan login (access + refresh). */
export const refreshResponseSchema = authTokensSchema;
export type RefreshResponse = z.infer<typeof refreshResponseSchema>;
