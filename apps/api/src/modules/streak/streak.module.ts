import { Module } from '@nestjs/common';

import { PaymentModule } from '../payment';
import { WalletModule } from '../wallet';

import { FreezeController } from './freeze.controller';
import { FreezePurchaseService } from './freeze-purchase.service';
import { StreakService } from './streak.service';

/**
 * E3 · Career Streak — docs/PRD.md §7 E3
 *
 * "Hari ini" SELALU zona waktu pengguna, dihitung di Postgres:
 *   (now() AT TIME ZONE users.timezone)::date
 * JANGAN PERNAH ::date atas timestamptz UTC (CLAUDE.md aturan 5).
 *
 * Diekspor supaya transaksi POST /attempts (L-03) bisa memanggilnya di dalam
 * transaksinya sendiri.
 *
 * `S-05` menambahkan `POST /streak/freeze/purchase` — jalur UANG (200 koin,
 * §5 Q3), karena itu `WalletModule` dan `PaymentModule` ikut diimpor.
 */
@Module({
  imports: [WalletModule, PaymentModule],
  controllers: [FreezeController],
  providers: [StreakService, FreezePurchaseService],
  exports: [StreakService, FreezePurchaseService],
})
export class StreakModule {}
