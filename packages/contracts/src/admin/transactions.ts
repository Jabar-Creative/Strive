import { z } from 'zod';
import {
  coinAmountSchema,
  cursorPaginatedSchema,
  cursorQuerySchema,
  isoDateTimeSchema,
  uuidSchema,
} from '../common';
// Import (bukan re-export) — coinEntryTypeSchema tetap didefinisikan sekali
// di domain `wallet`, di sini hanya dipakai sebagai tipe field.
import { coinEntryTypeSchema } from '../wallet';

/**
 * GET /admin/transactions?cursor= — docs/PRD.md §10.3 ("Order, pembayaran,
 * entri ledger dengan filter") + §7 E9 SA-5 (view `v_transactions`
 * menggabungkan `orders`+`payments`+`coin_ledger`). Karena satu baris bisa
 * berasal dari salah satu dari tiga sumber, field spesifik-order/ledger
 * bersifat nullable.
 */
export const adminTransactionSchema = z.object({
  order_id: uuidSchema.nullable(),
  user_id: uuidSchema,
  ledger_entry_id: z.string().nullable(),
  entry_type: coinEntryTypeSchema.nullable(),
  amount: coinAmountSchema.nullable(),
  amount_idr: coinAmountSchema.nullable(),
  status: z.string().nullable(),
  provider: z.string().nullable(),
  created_at: isoDateTimeSchema,
});
export type AdminTransaction = z.infer<typeof adminTransactionSchema>;

export const adminTransactionsQuerySchema = cursorQuerySchema.extend({
  user_id: uuidSchema.optional(),
  status: z.string().optional(),
});
export type AdminTransactionsQuery = z.infer<typeof adminTransactionsQuerySchema>;

export const adminTransactionsResponseSchema = cursorPaginatedSchema(adminTransactionSchema);
export type AdminTransactionsResponse = z.infer<typeof adminTransactionsResponseSchema>;
