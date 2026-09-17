import { z } from 'zod';
import { uuidSchema } from '../common';

/**
 * POST /payments/checkout — docs/PRD.md §10.3 + §7 E6 PA-2/PA-4.
 * `package_code` mengacu ke `pricingPackageSchema.code` (GET /pricing).
 * Wajib header `Idempotency-Key` (⚡) — tidak dimodelkan di body, itu header.
 */
export const checkoutRequestSchema = z.object({
  package_code: z.string().min(1),
});
export type CheckoutRequest = z.infer<typeof checkoutRequestSchema>;

/** → `{order_id, snap_token, redirect_url}` — docs/PRD.md §10.3. */
export const checkoutResponseSchema = z.object({
  order_id: uuidSchema,
  snap_token: z.string(),
  redirect_url: z.string().url(),
});
export type CheckoutResponse = z.infer<typeof checkoutResponseSchema>;
