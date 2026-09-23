import { Module } from '@nestjs/common';

import { BullmqModule } from '../infra/bullmq';
import { KyselyModule } from '../infra/kysely';
import { RedisModule } from '../infra/redis';
import { StorageModule } from '../infra/storage';
import { AiModule } from '../modules/ai';
import { ScanModule } from '../modules/scan';
import { WalletModule } from '../modules/wallet';
import { NotificationModule } from '../modules/notification';
import { LeagueModule } from '../modules/league';
import { RealtimeEmitterModule } from '../realtime/realtime.module';
import { AiDispatchService } from './ai-dispatch.service';
import { LeagueRollupService } from './league-rollup.service';
import { OutboxWorkerService } from './outbox.service';
import { ReconcileBalanceService } from './reconcile-balance.service';
import { PartitionService } from './partition.service';
import { StreakWarningService } from './streak-warning.service';

/**
 * Pool worker (MODE=worker). Satu pool, banyak queue dengan prioritas —
 * bukan satu deployment per jenis job (docs/PRD.md §8.2).
 *
 * Worker yang direncanakan:
 *   outbox             Q-03  poll outbox_events FOR UPDATE SKIP LOCKED -> ZADD mutlak
 *                            SUDAH ADA — `OutboxWorkerService.runOnce()`. WS menyusul RT-01.
 *   scan               K-03  submit ke Copyleaks, proses webhook hasil
 *   ai-dispatch        AI-06 kirim ai_jobs ke AI service, catat biaya
 *                            SUDAH ADA — `AiDispatchService`. Ia SATU-SATUNYA
 *                            worker yang benar-benar memakai BullMQ; sisanya
 *                            masih dipanggil manual. Percobaan ulang dihitung
 *                            BullMQ, bukan kolom `ai_jobs`, supaya tidak ada
 *                            dua sumber kebenaran untuk satu angka.
 *   notify             N-01  email Resend + notifikasi in-app, retry 3x
 *   league-rollup      Q-04  tutup musim, promosi/degradasi 20%, IDEMPOTEN
 *                            SUDAH ADA — `LeagueRollupService.run()`. Belum
 *                            dijadwalkan, alasan yang sama dengan C-04.
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
  imports: [
    KyselyModule,
    RedisModule,
    StorageModule,
    BullmqModule,
    AiModule,
    WalletModule,
    NotificationModule,
    ScanModule,
    LeagueModule,
    RealtimeEmitterModule,
  ],
  providers: [
    ReconcileBalanceService,
    StreakWarningService,
    PartitionService,
    LeagueRollupService,
    OutboxWorkerService,
    AiDispatchService,
  ],
  exports: [
    ReconcileBalanceService,
    StreakWarningService,
    PartitionService,
    LeagueRollupService,
    OutboxWorkerService,
    AiDispatchService,
  ],
})
export class WorkerModule {}
export * from './reconcile-balance.service';
export * from './streak-warning.service';
export * from './partition.service';
export * from './league-rollup.service';
export * from './outbox.service';
export * from './ai-dispatch.service';
