import { Global, Module } from '@nestjs/common';
import Redis from 'ioredis';

/** Token injeksi NestJS untuk klien Redis. */
export const REDIS = Symbol('REDIS');

export function createRedis(url?: string): Redis {
  return new Redis(url ?? process.env['REDIS_URL'] ?? 'redis://127.0.0.1:56379', {
    // Gagal cepat, bukan menggantung: Redis adalah TURUNAN, dan request yang
    // menunggu Redis selamanya lebih buruk daripada request yang jatuh ke
    // Postgres. Rebuild-nya murah; menggantung tidak.
    maxRetriesPerRequest: 2,
    enableOfflineQueue: false,
    lazyConnect: false,
  });
}

/**
 * Koneksi Redis 7. Redis adalah TURUNAN: seluruh isinya harus bisa dibangun
 * ulang dari Postgres (PRD §8.3 aturan 1, §9.4, CLAUDE.md aturan 7).
 *
 * Tidak ada penulisan Redis di dalam transaksi Postgres — pakai `outbox_events`
 * (aturan 6).
 */
@Global()
@Module({
  providers: [{ provide: REDIS, useFactory: () => createRedis() }],
  exports: [REDIS],
})
export class RedisModule {}
