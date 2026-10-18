import { z } from 'zod';
import { uuidSchema } from '../common';

/**
 * POST /payments/checkout — docs/PRD.md §10.3 + §7 E6 PA-2/PA-4.
 * `package_id` mengacu ke `pricingPackageSchema.id` (GET /pricing) — nama
 * fieldnya ikut bentuk {id, name} yang diteruskan seed & `GET /pricing`
 * (lihat catatan di pricing.ts). Rute-nya sendiri belum punya controller
 * (isu #233), jadi kontrak inilah satu-satunya definisi sampai controller
 * berdiri. Wajib header `Idempotency-Key` (⚡) — tidak dimodelkan di body.
 */
export const checkoutRequestSchema = z.object({
  package_id: z.string().min(1),
});
export type CheckoutRequest = z.infer<typeof checkoutRequestSchema>;

/** → `{order_id, snap_token, redirect_url}` — docs/PRD.md §10.3. */
export const checkoutResponseSchema = z.object({
  order_id: uuidSchema,
  snap_token: z.string(),
  // https EKSPLISIT: `z.string().url()` polos lolos untuk skema javascript:/
  // data: (temuan audit P-04) — URL ini berakhir di window.open klien.
  redirect_url: z.string().url().regex(/^https:\/\//),
});
export type CheckoutResponse = z.infer<typeof checkoutResponseSchema>;
