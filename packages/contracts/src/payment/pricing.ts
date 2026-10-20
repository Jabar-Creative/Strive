import { z } from 'zod';
import { coinAmountSchema, isoDateTimeSchema } from '../common';

/**
 * Satu paket top-up — docs/PRD.md §6.3. Bentuk {id, name} BUKAN asumsi lagi:
 * inilah yang ditulis seed `F-13` (`db/seeds/seed-dev.mjs`) dan yang
 * diteruskan apa adanya oleh `GET /pricing` (toPublicResponse memuat
 * `row.packages` mentah). Draf pertama F-08 memakai {code, label} dengan
 * catatan "asumsi, perlu disepakati" — kesepakatannya kini ditutup lewat
 * bentuk yang sudah ter-deploy; P-04 (konsumen pertama endpoint ini)
 * yang menemukan ketidakcocokannya, karena sebelumnya tidak ada pemakai.
 */
export const pricingPackageSchema = z.object({
  id: z.string(),
  name: z.string(),
  coins: coinAmountSchema,
  price_idr: coinAmountSchema,
});
export type PricingPackage = z.infer<typeof pricingPackageSchema>;

/**
 * GET /pricing — docs/PRD.md §10.3 ("Paket koin & harga fitur, versi aktif").
 * F-08 keputusan lokasi: diletakkan di domain `payment` (bukan `wallet`)
 * supaya konsisten dengan nama tabel sumbernya, `pricing_config` — lihat
 * catatan di `wallet/index.ts` dan laporan F-08.
 */
export const pricingResponseSchema = z.object({
  version: z.number().int(),
  coin_price_idr: coinAmountSchema,
  scan_cost_coins: coinAmountSchema,
  scan_cached_cost_coins: coinAmountSchema,
  lesson_reward_coins: coinAmountSchema,
  cv_cost_coins: coinAmountSchema,
  interview_cost_coins: coinAmountSchema,
  statement_cost_coins: coinAmountSchema,
  prompt_run_cost_coins: coinAmountSchema,
  freeze_cost_coins: coinAmountSchema,
  packages: z.array(pricingPackageSchema),
  active_from: isoDateTimeSchema,
});
export type PricingResponse = z.infer<typeof pricingResponseSchema>;
