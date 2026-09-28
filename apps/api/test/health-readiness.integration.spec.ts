import type { Kysely } from 'kysely';
import type Redis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, type DB } from '../src/infra/kysely';
import { createRedis, redisSiap } from '../src/infra/redis';
import { ReadinessService } from '../src/modules/health';

/**
 * Probe kesiapan terhadap PostgreSQL dan Redis NYATA — isu #155.
 *
 * Kenapa ini ada padahal unit test-nya sudah lengkap: unit test menirukan
 * `executeQuery` dan `ping`, jadi ia membuktikan PERCABANGANNYA benar dan
 * tidak pernah menjalankan query-nya. Salah ketik di SQL, atau API Kysely
 * yang berubah bentuk, akan lolos sepenuhnya. Yang membuktikan probe ini
 * benar-benar bisa bertanya ke dependensinya cuma dependensi sungguhan.
 */

const URL_DEV = 'postgres://strive:strive_dev_only@localhost:55432/strive';
const url = process.env['DATABASE_URL_TEST'] ?? process.env['DATABASE_URL'] ?? URL_DEV;
const urlRedis = process.env['REDIS_URL'] ?? 'redis://localhost:56379';

let db: Kysely<DB>;
let redis: Redis;
let reachable = false;

beforeAll(async () => {
  db = createDatabase(url);
  redis = createRedis(urlRedis);
  try {
    await db.selectFrom('tracks').select('id').limit(1).execute();
    await redisSiap(redis);
    await redis.ping();
    reachable = true;
  } catch {
    reachable = false;
  }
});

afterAll(async () => {
  await db?.destroy().catch(() => {});
  redis?.disconnect();
});

describe('GET /health/ready — ReadinessService (PostgreSQL + Redis nyata)', () => {
  it('database dan Redis siap dipakai', () => {
    // Penjaga wajib: tanpa ini seluruh berkas melaporkan hijau terhadap
    // dependensi MATI. Ditegakkan `test/penjaga-spec-integrasi.spec.ts`.
    expect(reachable).toBe(true);
  });

  it('keduanya hidup → siap, dan query-nya benar-benar dijalankan', async () => {
    if (!reachable) return;
    await expect(new ReadinessService(db, redis).check()).resolves.toEqual({
      status: 'siap',
      checks: { database: 'ok', redis: 'ok' },
    });
  });

  it('Postgres tak terjangkau → gagal, TANPA membocorkan host atau kredensial', async () => {
    if (!reachable) return;
    const mati = createDatabase('postgres://vitest:vitest@127.0.0.1:1/tidak_ada');
    try {
      const hasil = await new ReadinessService(mati, redis).check();
      expect(hasil).toEqual({ status: 'belum', checks: { database: 'gagal', redis: 'ok' } });
      // Yang keluar hanya `ok`/`gagal`. Sebabnya di log, yang butuh akses.
      expect(JSON.stringify(hasil)).not.toMatch(/127\.0\.0\.1|vitest|ECONNREFUSED/);
    } finally {
      await mati.destroy().catch(() => {});
    }
  });

  it('Redis tak terjangkau → gagal, dan Postgres tetap dilaporkan apa adanya', async () => {
    if (!reachable) return;
    const mati = createRedis('redis://127.0.0.1:1');
    try {
      await expect(new ReadinessService(db, mati).check()).resolves.toEqual({
        status: 'belum',
        checks: { database: 'ok', redis: 'gagal' },
      });
    } finally {
      mati.disconnect();
    }
  });
});
