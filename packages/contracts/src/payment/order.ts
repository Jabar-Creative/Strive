import { z } from 'zod';
import { coinAmountSchema, isoDateTimeSchema, uuidSchema } from '../common';

/**
 * docs/PRD.md §7 E6 alur order: `pending` → `paid` (webhook sah) ATAU
 * `failed`/`expired` (webhook deny/cancel/expire, atau job harian PA-9).
 */
export const orderStatusSchema = z.enum(['pending', 'paid', 'failed', 'expired']);
export type OrderStatus = z.infer<typeof orderStatusSchema>;

/**
 * GET /payments/orders/:id — docs/PRD.md §10.3 ("Status order, untuk polling
 * UI"). `pricing_version` disertakan karena PA-4: harga order lama tetap
 * dibaca dari versi saat order dibuat, bukan versi aktif sekarang.
 */
export const orderResponseSchema = z.object({
  id: uuidSchema,
  pricing_version: z.number().int(),
  coins: coinAmountSchema,
  amount_idr: coinAmountSchema,
  status: orderStatusSchema,
  provider: z.string(),
  paid_at: isoDateTimeSchema.nullable(),
  created_at: isoDateTimeSchema,
});
export type OrderResponse = z.infer<typeof orderResponseSchema>;
