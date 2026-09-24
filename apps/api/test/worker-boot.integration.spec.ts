import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Queue } from 'bullmq';
import { Kysely, sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { QUEUE, bullConnection, createBullConnection } from '../src/infra/bullmq';
import { createDatabase, type DB } from '../src/infra/kysely';
import { AI_SERVICE_CLIENT, AiJobsService } from '../src/modules/ai';
import type { AiRunResult, AiServiceClient } from '../src/modules/ai/ai-service.client';
import { WorkerModule } from '../src/workers';

/**
 * `MODE=worker` benar-benar MENGERJAKAN sesuatu, bukan cuma bisa di-boot.
 *
 * `worker.module.spec.ts` membuktikan modulnya bisa dirakit dan providernya
 * bisa diambil. Itu menangkap isu #86 (gagal boot total), dan tidak menangkap
 * kelas berikutnya: provider yang berdiri sempurna lalu **tidak pernah
 * disuruh mulai**.
 *
 * Itu yang terjadi pada `AiDispatchService` setelah `AI-06`. `start()` ada,
 * teruji, dan **tidak dipanggil siapa pun** — `bootstrapWorker()` hanya
 * membangun konteks aplikasi. Test integrasi `AI-06` lulus karena ia membuat
 * `Worker` BullMQ-nya sendiri; di produksi antrean `ai` tidak punya satu pun
 * konsumen, dan setiap `ai_jobs` mengendap `queued` selamanya tanpa galat.
 *
 * Pola "hijau tapi rusak saat dijalankan" yang KEEMPAT di repo ini
 * (lihat CLAUDE.md), dan yang pertama di mana kodenya ditulis satu hari
 * sebelum ditemukan.
 *
 * Berkas ini memakai `init()`, BUKAN `compile()` saja — lifecycle hook Nest
 * (`onApplicationBootstrap`) hanya berjalan di `init()`, dan justru hook itu
 * yang jadi jawabannya.
 */

const URL_DEV = 'postgres://strive:strive_dev_only@localhost:55432/strive';
const url = process.env['DATABASE_URL_TEST'] ?? process.env['DATABASE_URL'] ?? URL_DEV;
const redisUrl = process.env['REDIS_URL'] ?? 'redis://127.0.0.1:56379';

const PENGGUNA = '00000000-0000-4000-8000-0000000wb001'.replace('wb', 'ab');

let db: Kysely<DB>;
let queue: Queue;
let ctx: INestApplicationContext | undefined;
let reachable = false;

/** Klien AI tiruan yang selalu berhasil — yang diuji worker-nya, bukan LLM. */
const klienDamai: AiServiceClient = {
  name: 'uji',
  run: (): Promise<AiRunResult> =>
    Promise.resolve({
      output: { ok: true },
      model: 'gpt-4o-mini',
      promptVersion: 'ats-cv/2026-09-01',
      inputTokens: 10,
      outputTokens: 5,
      costUsd: 0.000001,
    }),
};

async function tungguStatus(id: string, batasMs = 15_000): Promise<string> {
  const habis = Date.now() + batasMs;
  for (;;) {
    const r = await db
      .selectFrom('ai_jobs')
      .select('status')
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    if (r.status !== 'queued') return r.status;
    if (Date.now() > habis) return r.status;
    await new Promise((s) => setTimeout(s, 150));
  }
}

beforeAll(async () => {
  db = createDatabase(url);
  const probe = createBullConnection(redisUrl);
  try {
    await db.selectFrom('ai_jobs').select('id').limit(1).execute();
    await probe.ping();
    reachable = true;
  } catch {
    reachable = false;
  } finally {
    probe.disconnect();
  }
  if (!reachable) return;
  process.env['DATABASE_URL'] = url;
  queue = new Queue(QUEUE.ai, { connection: bullConnection(redisUrl) });
}, 30_000);

afterAll(async () => {
  if (ctx) await ctx.close();
  if (queue) {
    await queue.obliterate({ force: true }).catch(() => undefined);
    await queue.close();
  }
  if (db) await db.destroy();
});

beforeEach(async () => {
  if (!reachable) return;
  await queue.obliterate({ force: true }).catch(() => undefined);
  await sql`TRUNCATE users RESTART IDENTITY CASCADE`.execute(db);
  await db
    .insertInto('users')
    .values({ id: PENGGUNA, email: 'worker-boot@uji.test', display_name: 'WB' })
    .execute();
});

describe('MODE=worker — konsumen antrean benar-benar hidup', () => {
  it('lingkungan siap', () => {
    expect(reachable).toBe(true);
  });

  it('job ai_jobs yang diantrekan DIPROSES setelah WorkerModule di-init', async () => {
    if (!reachable) return;

    // Antrekan DULU, sebelum worker hidup: kalau konsumennya benar-benar
    // berdiri, ia menemukan job yang sudah menunggu.
    const jobs = new AiJobsService(db, queue);
    const id = await db
      .transaction()
      .execute((trx) => jobs.buat(trx, { userId: PENGGUNA, kind: 'ats_cv', input: {} }));
    await jobs.enqueue(id);
    expect(
      (
        await db
          .selectFrom('ai_jobs')
          .select('status')
          .where('id', '=', id)
          .executeTakeFirstOrThrow()
      ).status,
    ).toBe('queued');

    // Boot seperti `bootstrapWorker()` — konteks aplikasi, lalu init().
    const moduleRef = await Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(AI_SERVICE_CLIENT)
      .useValue(klienDamai)
      .compile();
    ctx = await moduleRef.init();

    // Tidak ada `Worker` yang dibuat test ini. Kalau `MODE=worker` tidak
    // menyalakan konsumennya sendiri, baris ini tetap `queued` selamanya.
    expect(await tungguStatus(id), 'antrean `ai` tidak punya konsumen di MODE=worker').toBe('done');

    await ctx.close();
    ctx = undefined;
  }, 40_000);

  it('menutup konteks menghentikan konsumennya — tidak ada worker menggantung', async () => {
    if (!reachable) return;
    const moduleRef = await Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(AI_SERVICE_CLIENT)
      .useValue(klienDamai)
      .compile();
    const c = await moduleRef.init();
    await c.close();

    // Job yang diantrekan SETELAH konteks ditutup tidak boleh diproses —
    // kalau diproses, ada Worker yang selamat dari shutdown dan akan
    // menumpuk satu per restart.
    const jobs = new AiJobsService(db, queue);
    const id = await db
      .transaction()
      .execute((trx) => jobs.buat(trx, { userId: PENGGUNA, kind: 'ats_cv', input: {} }));
    await jobs.enqueue(id);
    await new Promise((s) => setTimeout(s, 1_500));

    expect(
      (
        await db
          .selectFrom('ai_jobs')
          .select('status')
          .where('id', '=', id)
          .executeTakeFirstOrThrow()
      ).status,
      'masih ada worker hidup setelah konteks ditutup',
    ).toBe('queued');
  }, 40_000);
});
