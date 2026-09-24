import { randomUUID } from 'node:crypto';
import { Queue, Worker } from 'bullmq';
import { Kysely, sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { OPSI_JOB_AI, QUEUE, bullConnection, createBullConnection } from '../src/infra/bullmq';
import { createDatabase, type DB } from '../src/infra/kysely';
import { AiJobsService } from '../src/modules/ai';
import {
  GalatAiPermanen,
  type AiRunInput,
  type AiRunResult,
  type AiServiceClient,
} from '../src/modules/ai/ai-service.client';
import { AiDispatchService } from '../src/workers';

/**
 * `AI-06` terhadap PostgreSQL dan Redis NYATA — PRD §7 E8, aturan keras 8 & 10.
 *
 * Dua acceptance criteria:
 *   1. Biaya per model dan per pengguna terekam untuk panel admin.
 *   2. Job yang gagal 3× masuk status `failed`, **bukan menggantung**.
 *
 * Yang kedua diuji dengan BullMQ sungguhan — antrean, backoff, dan hitungan
 * percobaannya. Menghitung percobaan dengan memanggil `proses()` tiga kali
 * dari test hanya membuktikan bahwa test-nya bisa berhitung; yang perlu
 * dibuktikan adalah bahwa ANTREAN yang mengulangnya, karena di situlah
 * angkanya disimpan.
 */

const URL_DEV = 'postgres://strive:strive_dev_only@localhost:55432/strive';
const url = process.env['DATABASE_URL_TEST'] ?? process.env['DATABASE_URL'] ?? URL_DEV;
const redisUrl = process.env['REDIS_URL'] ?? 'redis://127.0.0.1:56379';

const PENGGUNA = '00000000-0000-4000-8000-0000000a1601';
const PENGGUNA_B = '00000000-0000-4000-8000-0000000a1602';

let db: Kysely<DB>;
let queue: Queue;
let workers: Worker[] = [];
let reachable = false;

/** Klien AI tiruan yang MENCATAT panggilannya dan bisa disuruh gagal. */
class KlienUji implements AiServiceClient {
  readonly name = 'uji';
  panggilan: AiRunInput[] = [];
  lempar: (() => Error) | null = null;
  hasil: AiRunResult = {
    output: { ringkasan: 'ok' },
    model: 'gpt-4o-mini',
    promptVersion: 'ats-cv/2026-09-01',
    inputTokens: 1200,
    outputTokens: 340,
    costUsd: 0.000042,
  };

  run(p: AiRunInput): Promise<AiRunResult> {
    this.panggilan.push(p);
    if (this.lempar) return Promise.reject(this.lempar());
    return Promise.resolve(this.hasil);
  }
}

/** Menjalankan worker sungguhan sampai antreannya kosong, lalu menutupnya. */
async function jalankanWorker(klien: KlienUji, opsi: { backoffMs?: number } = {}): Promise<void> {
  const jobs = new AiJobsService(db, queue);
  const dispatch = new AiDispatchService(jobs, klien);
  const w = new Worker(QUEUE.ai, (job) => dispatch.proses(job), {
    connection: bullConnection(redisUrl),
    concurrency: 1,
  });
  w.on('error', () => undefined);
  workers.push(w);

  // Menunggu antrean BENAR-BENAR habis, termasuk job yang sedang menunggu
  // jadwal percobaan berikutnya (`delayed`).
  const batas = Date.now() + 20_000;
  for (;;) {
    const n = await queue.getJobCounts('waiting', 'active', 'delayed', 'prioritized');
    const sisa = (n.waiting ?? 0) + (n.active ?? 0) + (n.delayed ?? 0) + (n.prioritized ?? 0);
    if (sisa === 0) break;
    if (Date.now() > batas) throw new Error(`antrean tidak habis: ${JSON.stringify(n)}`);
    await new Promise((r) => setTimeout(r, opsi.backoffMs ?? 120));
  }
  await w.close();
  workers = workers.filter((x) => x !== w);
}

/** Membuat baris `ai_jobs` di dalam transaksi, lalu enqueue SETELAH commit. */
async function buatDanAntre(userId = PENGGUNA): Promise<string> {
  const jobs = new AiJobsService(db, queue);
  const id = await db
    .transaction()
    .execute((trx) => jobs.buat(trx, { userId, kind: 'ats_cv', input: { cv: 'isi' } }));
  await jobs.enqueue(id);
  return id;
}

async function baris(id: string) {
  return db.selectFrom('ai_jobs').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
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
  queue = new Queue(QUEUE.ai, { connection: bullConnection(redisUrl) });
}, 30_000);

afterAll(async () => {
  for (const w of workers) await w.close();
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
    .values([
      { id: PENGGUNA, email: 'ai06-a@uji.test', display_name: 'A' },
      { id: PENGGUNA_B, email: 'ai06-b@uji.test', display_name: 'B' },
    ])
    .execute();
});

describe('AI-06 — dispatcher ai_jobs (PostgreSQL + Redis nyata)', () => {
  it('lingkungan siap', () => {
    expect(reachable, `DATABASE_URL/REDIS_URL tidak bisa dipakai`).toBe(true);
  });

  it('aturan 10: `buat()` TIDAK meng-enqueue — enqueue terjadi setelah commit', async () => {
    if (!reachable) return;
    const jobs = new AiJobsService(db, queue);
    await db
      .transaction()
      .execute((trx) => jobs.buat(trx, { userId: PENGGUNA, kind: 'ats_cv', input: {} }));

    // Worker yang berjalan sebelum commit akan membaca baris yang belum ada.
    const n = await queue.getJobCounts('waiting', 'active', 'delayed');
    expect((n.waiting ?? 0) + (n.active ?? 0) + (n.delayed ?? 0)).toBe(0);
  });

  // ── AC 1: pencatatan biaya ─────────────────────────────────────────────

  it('AC: biaya, model, dan token terekam setelah job selesai', async () => {
    if (!reachable) return;
    const klien = new KlienUji();
    const id = await buatDanAntre();
    await jalankanWorker(klien);

    const r = await baris(id);
    expect(r.status).toBe('done');
    expect(r.model).toBe('gpt-4o-mini');
    expect(r.prompt_version).toBe('ats-cv/2026-09-01');
    expect(r.input_tokens).toBe(1200);
    expect(r.output_tokens).toBe(340);
    expect(r.completed_at).not.toBeNull();
    expect(r.output).toEqual({ ringkasan: 'ok' });
  });

  it('biaya sekecil 0,000042 USD tidak hilang dibulatkan', async () => {
    if (!reachable) return;
    // `numeric(10,6)`. Satu panggilan `gpt-4o-mini` memang sekitar segitu, dan
    // angka yang dibulatkan jadi nol adalah laporan biaya yang bohong dengan
    // cara paling sulit disadari: totalnya tetap terlihat masuk akal.
    const klien = new KlienUji();
    const id = await buatDanAntre();
    await jalankanWorker(klien);

    const r = await baris(id);
    expect(String(r.cost_usd)).toBe('0.000042');
  });

  it('AC: biaya bisa dijumlahkan PER MODEL dan PER PENGGUNA', async () => {
    if (!reachable) return;
    const klien = new KlienUji();

    await buatDanAntre(PENGGUNA);
    await buatDanAntre(PENGGUNA);
    await jalankanWorker(klien);

    klien.hasil = { ...klien.hasil, model: 'gpt-4o', costUsd: 0.005 };
    await buatDanAntre(PENGGUNA_B);
    await jalankanWorker(klien);

    // Bentuk query yang akan dipakai panel admin (SA-03).
    const perModel = await db
      .selectFrom('ai_jobs')
      .select(['model', sql<string>`sum(cost_usd)`.as('total')])
      .where('status', '=', 'done')
      .groupBy('model')
      .orderBy('model')
      .execute();
    expect(perModel).toEqual([
      { model: 'gpt-4o', total: '0.005000' },
      { model: 'gpt-4o-mini', total: '0.000084' },
    ]);

    const perPengguna = await db
      .selectFrom('ai_jobs')
      .select(['user_id', sql<string>`sum(cost_usd)`.as('total')])
      .where('status', '=', 'done')
      .groupBy('user_id')
      .orderBy('user_id')
      .execute();
    expect(perPengguna).toEqual([
      { user_id: PENGGUNA, total: '0.000084' },
      { user_id: PENGGUNA_B, total: '0.005000' },
    ]);
  });

  // ── AC 2: gagal 3× → failed, bukan menggantung ─────────────────────────

  it('AC: gagal terus → tepat 3 percobaan, lalu status failed', async () => {
    if (!reachable) return;
    const klien = new KlienUji();
    klien.lempar = () => new Error('layanan AI sedang mati');
    const id = await buatDanAntre();

    await jalankanWorker(klien);

    // Yang dihitung ANTREAN, bukan test: kalau `attempts` produksi berubah,
    // angka ini ikut berubah dan test-nya yang memberi tahu.
    expect(klien.panggilan).toHaveLength(OPSI_JOB_AI.attempts);

    const r = await baris(id);
    expect(r.status).toBe('failed');
    expect(r.error_message).toContain('layanan AI sedang mati');
    expect(r.completed_at).not.toBeNull();
  }, 40_000);

  it('TIDAK menggantung di `running` setelah percobaan habis', async () => {
    if (!reachable) return;
    // Bunyi AC-nya harfiah: "bukan menggantung". Job yang berhenti di
    // `running` tidak akan pernah diambil ulang siapa pun dan tidak muncul di
    // laporan gagal — ia hilang begitu saja.
    const klien = new KlienUji();
    klien.lempar = () => new Error('jaringan putus');
    const id = await buatDanAntre();
    await jalankanWorker(klien);

    expect((await baris(id)).status).not.toBe('running');
  }, 40_000);

  it('galat PERMANEN (4xx) tidak diulang — satu percobaan, langsung failed', async () => {
    if (!reachable) return;
    // §12.2: "tidak retry untuk 4xx". Input yang ditolak hari ini akan
    // ditolak lagi besok; mengulanginya hanya menunda pesan galatnya.
    const klien = new KlienUji();
    klien.lempar = () => new GalatAiPermanen('Layanan AI menolak job (422): input tidak sah');
    const id = await buatDanAntre();

    await jalankanWorker(klien);

    const r = await baris(id);
    expect(r.status).toBe('failed');
    expect(r.error_message).toContain('422');
    // Percobaan pertama sudah menandai failed; sisa percobaan BullMQ tetap
    // berjalan tapi tidak boleh memanggil layanan lagi — barisnya bukan lagi
    // `queued`/`running`.
    expect(klien.panggilan).toHaveLength(1);
  }, 40_000);

  // ── Idempotensi pengantaran ────────────────────────────────────────────

  it('job yang SUDAH selesai tidak dijalankan ulang — LLM tidak dibayar dua kali', async () => {
    if (!reachable) return;
    const klien = new KlienUji();
    const id = await buatDanAntre();
    await jalankanWorker(klien);
    expect(klien.panggilan).toHaveLength(1);

    // Pengantaran at-least-once: job yang sama bisa datang lagi.
    await queue.add('run', { jobId: id }, { ...OPSI_JOB_AI, jobId: `${id}-ulang` });
    await jalankanWorker(klien);

    expect(klien.panggilan, 'job selesai dijalankan ulang').toHaveLength(1);
    expect((await baris(id)).status).toBe('done');
  }, 40_000);

  it('ai_jobs yang GAGAL bisa diantrekan ulang — bukan no-op senyap', async () => {
    if (!reachable) return;
    // `queue.add` dengan `jobId` yang sudah ada mengembalikan job lama apa
    // adanya, tanpa galat dan tanpa membuat apa pun. Karena `removeOnFail`
    // menahan 1.000 job gagal terakhir, tanpa penanganan khusus setiap
    // antre-ulang `ai_jobs` yang gagal tidak akan pernah jalan — dan persis
    // itu yang akan dilakukan penyapu job yatim (#131).
    const klien = new KlienUji();
    klien.lempar = () => new GalatAiPermanen('Layanan AI menolak job (422)');
    const id = await buatDanAntre();
    await jalankanWorker(klien);
    expect((await baris(id)).status).toBe('failed');

    // Coba lagi, kali ini layanannya sehat.
    klien.lempar = null;
    klien.panggilan = [];
    await db.updateTable('ai_jobs').set({ status: 'queued' }).where('id', '=', id).execute();
    const jobs = new AiJobsService(db, queue);
    await jobs.enqueue(id);
    await jalankanWorker(klien);

    expect(klien.panggilan, 'antre ulang tidak menghasilkan job apa pun').toHaveLength(1);
    expect((await baris(id)).status).toBe('done');
  }, 40_000);

  it('antre ulang saat job MASIH hidup tidak menggandakannya', async () => {
    if (!reachable) return;
    // Sisi lain dari koin yang sama: dedup `jobId` yang menahan antre-ulang
    // juga yang menahan pengantaran ganda. `mulai()` menerima status
    // `running` (supaya job yang worker-nya mati bisa diambil lagi), jadi ia
    // tidak bisa menahannya sendiri — dua pengantaran berarti LLM dibayar
    // dua kali.
    const id = await buatDanAntre();
    const jobs = new AiJobsService(db, queue);
    await jobs.enqueue(id);
    await jobs.enqueue(id);

    const n = await queue.getJobCounts('waiting', 'delayed', 'prioritized');
    expect((n.waiting ?? 0) + (n.delayed ?? 0) + (n.prioritized ?? 0)).toBe(1);

    const klien = new KlienUji();
    await jalankanWorker(klien);
    expect(klien.panggilan, 'job yang sama dijalankan lebih dari sekali').toHaveLength(1);
  }, 40_000);

  it('jobId yang tidak sah tidak menjatuhkan worker', async () => {
    if (!reachable) return;
    const klien = new KlienUji();
    await queue.add('run', { jobId: 42 }, { ...OPSI_JOB_AI, jobId: randomUUID() });
    await queue.add('run', {}, { ...OPSI_JOB_AI, jobId: randomUUID() });

    // Job berikutnya tetap diproses — antrean tidak macet oleh data busuk.
    const id = await buatDanAntre();
    await jalankanWorker(klien);
    expect((await baris(id)).status).toBe('done');
  }, 40_000);
});
