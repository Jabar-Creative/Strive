import type { ConnectionOptions } from 'bullmq';
import Redis from 'ioredis';

/**
 * Antrean yang ada — PRD §8.1 ("outbox · scan · ai-dispatch · notify").
 *
 * Namanya konstanta, bukan string bertebaran: nama antrean adalah kunci Redis,
 * dan salah ketik menghasilkan antrean baru yang kosong selamanya alih-alih
 * galat.
 */
export const QUEUE = {
  ai: 'ai',
} as const;

export type QueueName = (typeof QUEUE)[keyof typeof QUEUE];

/** Token injeksi untuk `Queue` antrean AI. */
export const AI_QUEUE = Symbol('AI_QUEUE');

/**
 * Koneksi Redis untuk BullMQ — SENGAJA bukan `createRedis()`.
 *
 * `createRedis()` memakai `maxRetriesPerRequest: 2` supaya request yang
 * menunggu Redis gagal cepat (Redis adalah turunan, aturan keras 7). BullMQ
 * **menolak** nilai itu untuk koneksi yang memblokir: `Worker` memakai
 * `BRPOPLPUSH`, yang memang menggantung sampai ada job, dan pembatas retry
 * per-request akan memutusnya terus-menerus. Pustakanya melempar
 * `"maxRetriesPerRequest must be null"` — atau, untuk koneksi non-blocking,
 * menuliskannya sebagai peringatan yang mudah terlewat di antara log lain.
 *
 * `enableOfflineQueue` juga dibiarkan bawaan (`true`), berbeda dari klien
 * biasa: job yang ditambahkan saat Redis sedang tersendat lebih baik menunggu
 * sebentar daripada hilang. Job yang hilang berarti pengguna membayar koin
 * untuk pekerjaan yang tidak pernah dijalankan.
 */
export function createBullConnection(url?: string): Redis {
  return new Redis(url ?? process.env['REDIS_URL'] ?? 'redis://127.0.0.1:56379', {
    maxRetriesPerRequest: null,
  });
}

/** Opsi koneksi yang diterima konstruktor `Queue`/`Worker`. */
export function bullConnection(url?: string): ConnectionOptions {
  return createBullConnection(url);
}

/**
 * Opsi job bawaan — `AI-06`, PRD §12.3.
 *
 * Tiga percobaan dengan backoff eksponensial. Angka 3 datang dari acceptance
 * criteria AI-06 ("job yang gagal 3× masuk status failed") dan §12.2 memakai
 * angka yang sama untuk Copyleaks — satu kebiasaan, bukan dua.
 */
export const OPSI_JOB_AI = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 2_000 },
  // Job yang selesai tidak perlu disimpan selamanya; yang GAGAL disimpan lebih
  // lama, karena itu yang dibaca orang saat menelusuri keluhan pengguna.
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 1_000 },
} as const;
