import { z } from 'zod';
import { coinAmountSchema, isoDateTimeSchema, uuidSchema } from '../common';

/** docs/PRD.md §9.2 ENUM `coin_entry`. */
export const coinEntryTypeSchema = z.enum([
  'earn_lesson',
  'earn_streak',
  'earn_review',
  'purchase',
  'hold',
  'settle',
  'release',
  'spend_store',
  'spend_scan',
  'spend_ai',
  'adjust',
]);
export type CoinEntryType = z.infer<typeof coinEntryTypeSchema>;

/**
 * Satu baris `coin_ledger` — docs/PRD.md §9.3. Dipakai di `/wallet` dan
 * `/wallet/ledger`, dan di-reuse (bukan di-copy) oleh `admin/transactions`.
 *
 * `id` bertipe `bigserial` di database; direpresentasikan sebagai STRING di
 * response, bukan `number` — `bigserial` bisa melewati `Number.MAX_SAFE_INTEGER`
 * dan JSON/JS tidak punya integer presisi penuh untuk itu. Ini keputusan
 * desain, bukan salinan literal dari PRD (yang tidak menuliskan tipe JSON-nya).
 */
export const coinLedgerEntrySchema = z.object({
  id: z.string(),
  entry_type: coinEntryTypeSchema,
  amount: coinAmountSchema,
  balance_after: coinAmountSchema,
  ref_type: z.string().nullable(),
  ref_id: uuidSchema.nullable(),
  note: z.string().nullable(),
  created_at: isoDateTimeSchema,
});
export type CoinLedgerEntry = z.infer<typeof coinLedgerEntrySchema>;
