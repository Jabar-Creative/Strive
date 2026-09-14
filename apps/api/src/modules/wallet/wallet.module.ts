import { Module } from '@nestjs/common';

/**
 * E4 · Coin & Wallet — docs/PRD.md §7 E4
 *
 * KERANGKA KOSONG. Controller & service menyusul di item: C-01, C-02, C-04.
 *
 * MILIK DEV A. Di sinilah CoinLedgerService tinggal.
 * TIDAK ADA kode lain di repo ini yang boleh INSERT INTO coin_ledger atau
 * UPDATE users.coin_balance — semuanya memanggil service ini
 * (CLAUDE.md aturan 1-4).
 */
@Module({})
export class WalletModule {}
