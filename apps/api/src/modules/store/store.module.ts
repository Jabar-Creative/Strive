import { Module } from '@nestjs/common';

import { KyselyModule } from '../../infra/kysely';
import { WalletModule } from '../wallet';
import { StoreController } from './store.controller';
import { StoreService } from './store.service';

/**
 * E14 · Strive Store — docs/PRD.md §7 E14
 *
 * `ST-01` memasang etalase dan pembelian. `ST-02` (Dev B) menyusul dengan UI
 * dan rute unduh bertanda tangan.
 *
 * Pembelian transaksional: debit lewat CoinLedgerService + insert
 * store_purchases dalam SATU transaksi (SR-3). Tidak ada satu pun query di
 * modul ini yang menulis `coin_ledger` atau `users.coin_balance` langsung —
 * aturan keras 3.
 */
@Module({
  imports: [KyselyModule, WalletModule],
  controllers: [StoreController],
  providers: [StoreService],
  exports: [StoreService],
})
export class StoreModule {}
