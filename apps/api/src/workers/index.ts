import { Module } from '@nestjs/common';

import { KyselyModule } from '../infra/kysely';
import { RedisModule } from '../infra/redis';
import { StorageModule } from '../infra/storage';
import { ScanModule } from '../modules/scan';
import { WalletModule } from '../modules/wallet';
import { NotificationModule } from '../modules/notification';
import { ReconcileBalanceService } from './reconcile-balance.service';
import { PartitionService } from './partition.service';
import { StreakWarningService } from './streak-warning.service';

/**
 * Pool worker (MODE=worker). Satu pool, banyak queue dengan prioritas —
 * bukan satu deployment per jenis job (docs/PRD.md §8.2).
 *
 * Worker yang direncanakan:
 *   outbox             Q-03  poll outbox_events FOR UPDATE SKIP LOCKED -> ZINCRBY + WS
 *   scan               K-03  submit ke Copyleaks, proses webhook hasil
 *   ai-dispatch        AI-06 kirim ai_jobs ke AI service, catat biaya
 *   notify             N-01  email Resend + notifikasi in-app, retry 3x
 *   league-rollup      Q-04  tutup musim, promosi/degradasi 20%, IDEMPOTEN
 *   reconcile-balance  C-04  bandingkan users.coin_balance vs SUM(coin_ledger)
 *   reaper             K-02  lepas hold menggantung > 30 menit — SUDAH ADA,
 *                            `ScanService.releaseStale()`. Belum dijadwalkan;
 *                            alasannya sama dengan ReconcileBalanceService.
 *
 * Semua konsumen outbox WAJIB idempoten — pengantaran at-least-once
 * (docs/PRD.md §8.3 aturan 3).
 * `ReconcileBalanceService` (C-04) sengaja TIDAK dijadwalkan di sini.
 * Penjadwalnya adalah bagian dari deploy, dan staging ditunda (isu #29).
 * Sampai itu ada, job-nya dipanggil manual atau dari test — yang penting
 * logikanya sudah berdiri dan terbukti, bukan menunggu penjadwal.
 */
@Module({
  // `KyselyModule` dan `RedisModule` WAJIB diimpor di sini meski keduanya
  // `@Global()`. Global berarti "sekali diimpor, terlihat di mana-mana" —
  // BUKAN "terdaftar otomatis". `AppModule` mengimpornya; `WorkerModule`
  // tidak, dan akibatnya `MODE=worker` GAGAL BOOT sama sekali:
  //
  //   Nest can't resolve dependencies of the WalletService (?).
  //   Please make sure that the argument Symbol(DATABASE) is available
  //   in the WalletModule context.
  //
  // Itu berlaku sejak WorkerModule pertama punya provider berdependensi, dan
  // tidak ada yang menangkapnya: `app.module.spec.ts` menguji AppModule, dan
  // TIDAK ADA test yang pernah membangun WorkerModule. Separuh deployment
  // (PRD §8.1 "satu image, dua peran") tidak pernah diperiksa. Isu #86.
  //
  // `StorageModule` ketahuan dengan cara yang sama, satu menit setelah test
  // `worker.module.spec.ts` ditulis — kelas kesalahan yang sama, modul yang
  // berbeda. Itu yang membuat test murah itu sepadan.
  imports: [KyselyModule, RedisModule, StorageModule, WalletModule, NotificationModule, ScanModule],
  providers: [ReconcileBalanceService, StreakWarningService, PartitionService],
  exports: [ReconcileBalanceService, StreakWarningService, PartitionService],
})
export class WorkerModule {}
export * from './reconcile-balance.service';
export * from './streak-warning.service';
export * from './partition.service';
