import { z } from 'zod';

/**
 * SATU skema contoh — sengaja yang paling tidak berbahaya.
 *
 * Skema endpoint sungguhan adalah item F-08 milik Dev B. Yang ditunjukkan di
 * sini hanya POLANYA: skema zod dulu, tipe TypeScript diturunkan darinya
 * dengan `z.infer`, tidak pernah ditulis dua kali.
 */
export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.enum(['api', 'ai']),
  mode: z.enum(['api', 'worker']),
  timestamp: z.string().datetime(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
