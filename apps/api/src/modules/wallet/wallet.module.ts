import { Module } from '@nestjs/common';

import { CoinLedgerService } from './coin-ledger.service';

/**
 * E4 · Coin & Wallet — docs/PRD.md §7 E4
 *
 * MILIK DEV A. Di sinilah CoinLedgerService tinggal.
 *
 * TIDAK ADA kode lain di repo ini yang boleh INSERT INTO coin_ledger atau
 * UPDATE users.coin_balance — semuanya memanggil service ini
 * (CLAUDE.md aturan 1-4). Diekspor supaya modul lain (store, scan, payment,
 * learning) bisa menyuntikkannya.
 */
@Module({
  providers: [CoinLedgerService],
  exports: [CoinLedgerService],
})
export class WalletModule {}
