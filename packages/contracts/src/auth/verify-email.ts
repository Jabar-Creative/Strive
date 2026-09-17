import { z } from 'zod';

/** POST /auth/verify-email — docs/PRD.md §10.3 ("Token dari email"). */
export const verifyEmailRequestSchema = z.object({
  token: z.string().min(1),
});
export type VerifyEmailRequest = z.infer<typeof verifyEmailRequestSchema>;
