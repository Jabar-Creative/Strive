import { Module } from '@nestjs/common';

/**
 * Koneksi Redis 7. Redis adalah TURUNAN: seluruh isinya harus bisa
 * dibangun ulang dari Postgres (docs/PRD.md §8.3 aturan 1, §9.4).
 * Tidak ada penulisan Redis di dalam transaksi Postgres — pakai outbox_events.
 *
 * KERANGKA — provider menyusul di item Q-02 (docs/BACKLOG.md).
 */
@Module({})
export class RedisModule {}
