import { z } from 'zod';
import { coinAmountSchema } from '../common';
// Import (bukan re-export) — didefinisikan sekali di domain `payment`.
import { pricingPackageSchema, pricingResponseSchema } from '../payment';

/**
 * PATCH /admin/pricing — docs/PRD.md §10.3 ("Menerbitkan versi baru, bukan
 * menimpa") + SA-3. Semua field wajib: menerbitkan versi baru berarti
 * `pricing_config` baris baru dengan SELURUH kolom terisi, bukan patch
 * parsial atas baris lama (baris lama tidak pernah diubah).
 */
export const updatePricingRequestSchema = z.object({
  coin_price_idr: coinAmountSchema.positive(),
  scan_cost_coins: coinAmountSchema.positive(),
  scan_cached_cost_coins: coinAmountSchema.positive(),
  lesson_reward_coins: coinAmountSchema.positive(),
  cv_cost_coins: coinAmountSchema.positive(),
  interview_cost_coins: coinAmountSchema.positive(),
  statement_cost_coins: coinAmountSchema.positive(),
  prompt_run_cost_coins: coinAmountSchema.positive(),
  freeze_cost_coins: coinAmountSchema.positive(),
  packages: z.array(pricingPackageSchema).min(1),
});
export type UpdatePricingRequest = z.infer<typeof updatePricingRequestSchema>;

/** Versi baru yang diterbitkan — bentuknya sama dengan GET /pricing. */
export const updatePricingResponseSchema = pricingResponseSchema;
export type UpdatePricingResponse = z.infer<typeof updatePricingResponseSchema>;
