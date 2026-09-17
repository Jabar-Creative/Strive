import { z } from 'zod';
import { coinAmountSchema, isoDateTimeSchema } from '../common';

/**
 * Satu paket top-up — docs/PRD.md §6.3. `code` ASUMSI (PRD hanya menuliskan
 * label "Starter"/"Reguler"/"Skripsi" di tabel harga, bentuk JSON
 * `pricing_config.packages` belum didokumentasikan literal) — perlu
 * disepakati dengan Dev A saat migrasi seed `pricing_config` ditulis.
 */
export const pricingPackageSchema = z.object({
  code: z.string(),
  label: z.string(),
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
