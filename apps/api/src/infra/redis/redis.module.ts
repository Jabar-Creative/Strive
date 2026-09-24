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
 * Menunggu koneksi benar-benar SIAP.
 *
 * `createRedis()` memakai `enableOfflineQueue: false`, jadi perintah yang
 * dikirim sebelum koneksinya berdiri **ditolak**, bukan diantrekan. Karena
 * `lazyConnect: false` membuat objeknya terlihat langsung bisa dipakai,
 * jebakan ini sudah menggigit tiga kali di repo ini: `RedisIoAdapter` (yang
 * memakai salinan fungsi ini sebelum ada di sini), `RealtimeEmitter` — di mana
 * event pertama worker hilang tanpa suara — dan test keamanan `R-03` yang
 * `ping()` sebagai perintah pertamanya.
 *
 * Siapa pun yang memakai klien Redis sebagai perintah PERTAMA setelah
 * membuatnya wajib menunggu ini dulu.
 */
export function redisSiap(r: Redis, batasMs = 5_000): Promise<void> {
  if (r.status === 'ready') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const selesai = (err?: Error): void => {
      clearTimeout(batas);
      r.off('ready', siap);
      r.off('error', gagal);
      if (err) reject(err);
      else resolve();
    };
    const siap = (): void => selesai();
    const gagal = (err: Error): void => selesai(err);
    const batas = setTimeout(
      () => selesai(new Error('Redis tidak siap dalam waktu yang wajar')),
      batasMs,
    );
    r.once('ready', siap);
    r.once('error', gagal);
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
