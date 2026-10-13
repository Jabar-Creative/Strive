import { z } from 'zod';
import { coinAmountSchema, cursorPaginatedSchema } from '../common';
import { coinLedgerEntrySchema } from './coin-ledger';

/**
 * Batas entri dompet — SATU sumber untuk web dan API (isu #182).
 *
 * Web mengimpor NILAI keduanya langsung dari sini (web boleh impor nilai
 * dari paket ini). `apps/api` TIDAK boleh — `nest build` mengirim `.ts`
 * mentah (`ERR_UNSUPPORTED_DIR_IMPORT`, CLAUDE.md) — jadi servicenya
 * memelihara konstantanya sendiri dan test paritas
 * (`wallet-limit.parity.spec.ts`) memerah kalau keduanya menyimpang.
 */
export const WALLET_LEDGER_LIMIT_MAX = 50;
export const WALLET_LEDGER_LIMIT_DEFAULT = 20;

/** GET /wallet — docs/PRD.md §10.3 ("Saldo + 20 entri terakhir"). */
export const walletResponseSchema = z.object({
  balance: coinAmountSchema,
  recent_entries: z.array(coinLedgerEntrySchema).max(WALLET_LEDGER_LIMIT_DEFAULT),
});
export type WalletResponse = z.infer<typeof walletResponseSchema>;

/** GET /wallet/ledger?cursor= — docs/PRD.md §10.3 ("Riwayat lengkap"). */
export const walletLedgerResponseSchema = cursorPaginatedSchema(coinLedgerEntrySchema);
export type WalletLedgerResponse = z.infer<typeof walletLedgerResponseSchema>;
