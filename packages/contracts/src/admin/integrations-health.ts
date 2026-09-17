import { z } from 'zod';
import { isoDateTimeSchema } from '../common';

/**
 * GET /admin/integrations/health — docs/PRD.md §10.3 ("Status & biaya harian
 * per vendor") + §7 E9 SA-6. `name` SENGAJA `z.string()` polos, bukan enum
 * vendor tertutup — daftar vendor (Midtrans, Copyleaks, OpenAI/Gemini,
 * Resend) ada di §12 tapi PRD tidak menjanjikan daftar itu final/tertutup,
 * dan mengunci enum di sini berarti setiap vendor baru = breaking change di
 * kontrak padahal semestinya cukup penambahan baris data.
 */
export const integrationHealthSchema = z.object({
  name: z.string(),
  status: z.enum(['up', 'degraded', 'down']),
  cost_today_usd: z.number().nullable(),
  cost_today_idr: z.number().int().nullable(),
  requests_today: z.number().int(),
  last_checked_at: isoDateTimeSchema,
});
export type IntegrationHealth = z.infer<typeof integrationHealthSchema>;

export const integrationsHealthResponseSchema = z.array(integrationHealthSchema);
export type IntegrationsHealthResponse = z.infer<typeof integrationsHealthResponseSchema>;
