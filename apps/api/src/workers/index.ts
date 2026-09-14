import { Module } from '@nestjs/common';

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
 *   reaper             K-02  lepas hold menggantung > 30 menit
 *
 * Semua konsumen outbox WAJIB idempoten — pengantaran at-least-once
 * (docs/PRD.md §8.3 aturan 3).
 */
@Module({})
export class WorkerModule {}
