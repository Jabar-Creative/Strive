import { z } from 'zod';
import { coinAmountSchema, cursorPaginatedSchema } from '../common';
import { coinLedgerEntrySchema } from './coin-ledger';

/** GET /wallet — docs/PRD.md §10.3 ("Saldo + 20 entri terakhir"). */
export const walletResponseSchema = z.object({
  balance: coinAmountSchema,
  recent_entries: z.array(coinLedgerEntrySchema).max(20),
});
export type WalletResponse = z.infer<typeof walletResponseSchema>;

/** GET /wallet/ledger?cursor= — docs/PRD.md §10.3 ("Riwayat lengkap"). */
export const walletLedgerResponseSchema = cursorPaginatedSchema(coinLedgerEntrySchema);
export type WalletLedgerResponse = z.infer<typeof walletLedgerResponseSchema>;
