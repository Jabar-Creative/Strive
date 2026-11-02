import { randomUUID } from 'node:crypto';
import { Queue, Worker } from 'bullmq';
import { Kysely, sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { OPSI_JOB_AI, QUEUE, bullConnection, createBullConnection } from '../src/infra/bullmq';
import { createDatabase, type DB } from '../src/infra/kysely';
import {
  AMBANG_MENGGANTUNG_MENIT,
  AiJobsService,
  type BarisJobAi,
  type PenyelesaiJobAi,
} from '../src/modules/ai';
import {
  GalatAiPermanen,
  GalatAiSementara,
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

/** Finalisasi tiruan — MENCATAT panggilan dan bisa disuruh melempar/menggantung. */
class PenyelesaiUji implements PenyelesaiJobAi {
  suksesDipanggil: { jobId: string; baris: BarisJobAi; hasil: AiRunResult }[] = [];
  gagalDipanggil: { jobId: string; baris: BarisJobAi }[] = [];
  lemparSukses: (() => Error) | null = null;
  lemparGagal: (() => Error) | null = null;
  /** Audit T3: sukses yang TIDAK PERNAH selesai — janji menggantung. */
  gantungSukses = false;

  constructor(readonly kind: BarisJobAi['kind']) {}

  async sukses(jobId: string, baris: BarisJobAi, hasil: AiRunResult): Promise<void> {
    if (this.gantungSukses) return new Promise<void>(() => undefined);
    if (this.lemparSukses) throw this.lemparSukses();
    this.suksesDipanggil.push({ jobId, baris, hasil });
  }

  async gagal(jobId: string, baris: BarisJobAi): Promise<void> {
    if (this.lemparGagal) throw this.lemparGagal();
    this.gagalDipanggil.push({ jobId, baris });
  }
}

/** Menjalankan worker sungguhan sampai antreannya kosong, lalu menutupnya. */
async function jalankanWorker(
  klien: KlienUji,
  opsi: { backoffMs?: number; penyelesai?: PenyelesaiJobAi[]; batasHookMs?: number } = {},
): Promise<void> {
  const jobs = new AiJobsService(db, queue);
  const dispatch = new AiDispatchService(jobs, klien, opsi.penyelesai ?? []);
  if (opsi.batasHookMs !== undefined) dispatch.batasHookMs = opsi.batasHookMs;
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

  // ── Kode galat: #190 dan #184 ──────────────────────────────────────────

  it('#190: `code` layanan AI tersimpan di error_code, bukan cuma di dalam teks', async () => {
    if (!reachable) return;
    const klien = new KlienUji();
    klien.lempar = () =>
      new GalatAiPermanen(
        'Layanan AI menolak job (400 DOCUMENT_TOO_LONG): Dokumen melebihi 20 halaman',
        'DOCUMENT_TOO_LONG',
      );
    const id = await buatDanAntre();

    await jalankanWorker(klien);

    const r = await baris(id);
    expect(r.status).toBe('failed');
    // Kolomnya, bukan substring pesannya. Mencari kode lewat LIKE '%...%' akan
    // salah pada hari pesannya diterjemahkan atau dipotong 1.000 karakter.
    expect(r.error_code).toBe('DOCUMENT_TOO_LONG');
  }, 40_000);

  it('#184: 401 TIDAK dikubur di percobaan pertama — token salah dapat jatah penuh', async () => {
    if (!reachable) return;
    // Sebelum ini, SELURUH 4xx dihitung permanen. Akibatnya satu salah ketik
    // `AI_SERVICE_TOKEN` di dashboard menandai setiap ai_job `failed` pada
    // percobaan PERTAMA, dan membetulkan env-nya tidak menghidupkan satu pun
    // kembali — tidak ada penyapu yang mengantrekannya ulang (isu #131).
    const klien = new KlienUji();
    klien.lempar = () =>
      new GalatAiSementara(
        'Layanan AI gagal (401 UNAUTHENTICATED): Token layanan tidak sah atau tidak ada',
        'UNAUTHENTICATED',
      );
    const id = await buatDanAntre();

    await jalankanWorker(klien);

    // Jatah penuh, sama seperti 5xx — bukan satu. Kalau kredensialnya
    // diperbaiki di dalam jendela itu, job-nya selamat sendiri.
    expect(klien.panggilan).toHaveLength(OPSI_JOB_AI.attempts);
    const r = await baris(id);
    expect(r.status).toBe('failed');
    expect(r.error_code).toBe('UNAUTHENTICATED');
  }, 40_000);

  // ── Penyapu job mengendap: isu #131 ────────────────────────────────────

  it('#131: job `running` lebih tua dari ambang disapu jadi failed, bukan hilang', async () => {
    if (!reachable) return;
    const id = await buatDanAntre();
    // Umur baris dipalsukan di POSTGRES, bukan dengan `Date` Node: ambangnya
    // dibandingkan `now()` milik database, dan TZ proses tidak boleh ikut
    // menentukan hasilnya.
    await sql`
      UPDATE ai_jobs SET status = 'running',
        created_at = now() - ${sql.lit(AMBANG_MENGGANTUNG_MENIT + 5)} * interval '1 minute'
      WHERE id = ${id}
    `.execute(db);

    const jobs = new AiJobsService(db, queue);
    // Balikan ARRAY (audit T1): baris yang disapu harus bisa dibawa ke hook
    // `gagal` pemanggilnya — `{ disapu: 1 }` tidak membawa apa-apa.
    const disapu = await jobs.sapuMenggantung();
    expect(disapu).toHaveLength(1);
    expect(disapu[0]!.id).toBe(id);
    expect(disapu[0]!.userId).toBe(PENGGUNA);
    expect(disapu[0]!.kind).toBe('ats_cv');

    const r = await baris(id);
    expect(r.status).toBe('failed');
    // Terlihat DAN terhitung: `SA-03` membaca tabel ini per kode.
    expect(r.error_code).toBe('PROVIDER_UNAVAILABLE');
    expect(r.error_message).toContain('#131');
    expect(r.completed_at).not.toBeNull();
  }, 40_000);

  it('#131: job `running` yang MASIH MUDA tidak disentuh — ini penjaga arah sebaliknya', async () => {
    if (!reachable) return;
    // Tanpa test ini, ambang 0 menit pun lulus: penyapu yang menyapu segalanya
    // memuaskan test pertama dan membunuh setiap job yang sedang berjalan.
    const id = await buatDanAntre();
    await sql`
      UPDATE ai_jobs SET status = 'running',
        created_at = now() - ${sql.lit(AMBANG_MENGGANTUNG_MENIT - 5)} * interval '1 minute'
      WHERE id = ${id}
    `.execute(db);

    const jobs = new AiJobsService(db, queue);
    expect(await jobs.sapuMenggantung()).toHaveLength(0);
    expect((await baris(id)).status).toBe('running');
  }, 40_000);

  it('#131: baris `queued` tua TIDAK disapu — yang mengendap hanya `running`', async () => {
    if (!reachable) return;
    // Job yang menunggu lama di antrean belum tentu hilang: worker yang mati
    // lalu hidup lagi akan mengambilnya. Yang hilang adalah yang sudah DIMULAI
    // lalu kehilangan keadaan retry-nya.
    const id = await buatDanAntre();
    await sql`
      UPDATE ai_jobs SET created_at = now() - ${sql.lit(AMBANG_MENGGANTUNG_MENIT + 60)} * interval '1 minute'
      WHERE id = ${id}
    `.execute(db);

    const jobs = new AiJobsService(db, queue);
    expect(await jobs.sapuMenggantung()).toHaveLength(0);
    expect((await baris(id)).status).toBe('queued');
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

describe('AI-07 — finalisasi per kind (hook PENYELESAI_JOB_AI)', () => {
  it('lingkungan siap', () => {
    expect(reachable, `DATABASE_URL/REDIS_URL tidak bisa dipakai`).toBe(true);
  });

  it('hook sukses menerima jobId, baris milik pengguna, dan hasil — setelah baris done', async () => {
    if (!reachable) return;
    const klien = new KlienUji();
    const hook = new PenyelesaiUji('ats_cv');
    const id = await buatDanAntre();
    await jalankanWorker(klien, { penyelesai: [hook] });

    expect((await baris(id)).status).toBe('done');
    expect(hook.suksesDipanggil).toHaveLength(1);
    const a = hook.suksesDipanggil[0]!;
    expect(a.jobId).toBe(id);
    // `userId` wajib datang dari `mulai()` — finalisasi butuh pemiliknya
    // untuk settle hold dan menulis cv_documents.
    expect(a.baris.userId).toBe(PENGGUNA);
    expect(a.baris.kind).toBe('ats_cv');
    expect(a.baris.input).toEqual({ cv: 'isi' });
    expect(a.hasil).toEqual(klien.hasil);
    expect(hook.gagalDipanggil).toHaveLength(0);
  }, 40_000);

  it('hook sukses MELEMPAR → baris failed, hook gagal dipanggil, LLM tidak dibayar ulang', async () => {
    if (!reachable) return;
    const klien = new KlienUji();
    const hook = new PenyelesaiUji('ats_cv');
    hook.lemparSukses = () => new GalatAiPermanen('gudung objek penuh', 'INTERNAL_ERROR');
    const id = await buatDanAntre();
    await jalankanWorker(klien, { penyelesai: [hook] });

    // Baris sudah `done` (biaya tercatat) saat hook melempar — status
    // ditulis ulang `failed` supaya kegagalannya TERLIHAT, bukan selesai
    // yang bohong. Tidak ada rethrow: pengantaran ulang hanya menemukan
    // status bukan antre dan melewatinya.
    const r = await baris(id);
    expect(r.status).toBe('failed');
    expect(r.error_message).toContain('Finalisasi gagal');
    expect(r.error_code).toBe('INTERNAL_ERROR');
    expect(klien.panggilan, 'LLM dipanggil lebih dari sekali').toHaveLength(1);
    expect(hook.gagalDipanggil).toHaveLength(1);
    // Audit T2: output yang tidak pernah diserahkan DIBUANG (jsonb berisi
    // CV + pdf base64, bisa ~1 MB, menyesatkan sekaligus menimbun PII),
    // tapi kolom BIAYA dipertahankan — LLM-nya benar-benar dijalankan dan
    // dibayar; menghapusnya menghapus jejak belanja.
    expect(r.output).toBeNull();
    expect(r.model).toBe('gpt-4o-mini');
    expect(String(r.cost_usd)).toBe('0.000042');
  }, 40_000);

  it('galat permanen dari layanan → hook gagal TEPAT SEKALI, sukses tidak pernah', async () => {
    if (!reachable) return;
    const klien = new KlienUji();
    klien.lempar = () => new GalatAiPermanen('Layanan AI menolak job (422)');
    const hook = new PenyelesaiUji('ats_cv');
    const id = await buatDanAntre();
    await jalankanWorker(klien, { penyelesai: [hook] });

    expect((await baris(id)).status).toBe('failed');
    // Percobaan sisa BullMQ tetap datang, tapi `mulai()` memulangkan null —
    // hook tidak boleh ikut terpanggil untuk pengantaran yang sama.
    expect(hook.gagalDipanggil).toHaveLength(1);
    expect(hook.suksesDipanggil).toHaveLength(0);
  }, 40_000);

  it('gagal sementara lalu SEMBUH → hook gagal tidak dipanggil, sukses sekali', async () => {
    if (!reachable) return;
    const klien = new KlienUji();
    let tersendat = 0;
    klien.lempar = () => {
      tersendat += 1;
      if (tersendat >= 2) klien.lempar = null;
      return new Error('jaringan tersendat');
    };
    const hook = new PenyelesaiUji('ats_cv');
    const id = await buatDanAntre();
    await jalankanWorker(klien, { penyelesai: [hook] });

    // Hook gagal hanya untuk keadaan terminal. Percobaan pertama yang
    // gagal sementara BUKAN kegagalan — kalau hook dipanggil di situ,
    // pengguna dapat "refund" padahal job-nya berhasil di percobaan kedua.
    expect((await baris(id)).status).toBe('done');
    expect(hook.suksesDipanggil).toHaveLength(1);
    expect(hook.gagalDipanggil).toHaveLength(0);
  }, 40_000);

  it('hook kind LAIN tidak dipanggil — finalisasi berlaku per kind', async () => {
    if (!reachable) return;
    const klien = new KlienUji();
    const hookPrompt = new PenyelesaiUji('prompt_run');
    const id = await buatDanAntre(); // kind 'ats_cv'
    await jalankanWorker(klien, { penyelesai: [hookPrompt] });

    expect((await baris(id)).status).toBe('done');
    expect(hookPrompt.suksesDipanggil).toHaveLength(0);
    expect(hookPrompt.gagalDipanggil).toHaveLength(0);
  }, 40_000);

  it('hook GAGAL yang melempar tidak menjatuhkan apa pun — baris tetap failed', async () => {
    if (!reachable) return;
    const klien = new KlienUji();
    klien.lempar = () => new GalatAiPermanen('Layanan AI menolak job (422)');
    const hook = new PenyelesaiUji('ats_cv');
    hook.lemparGagal = () => new Error('kirim notifikasi gagal');
    const id = await buatDanAntre();
    await jalankanWorker(klien, { penyelesai: [hook] });

    // `jobs.gagal()` sudah menulis baris SEBELUM hook dipanggil, jadi
    // kegagalan hook tidak boleh mengubah apa pun — hanya tercatat.
    const r = await baris(id);
    expect(r.status).toBe('failed');
    expect(r.error_message).toContain('422');
    // Hook melempar sebelum mencatat — bukti panggilannya adalah baris yang
    // tetap `failed` dan worker yang tetap selesai tanpa exception.
  }, 40_000);

  // ── Audit AI-07: T1 (hold pada job tersapu) dan T3 (hook menggantung) ──

  it('T1: `sapu()` dispatcher memanggil hook gagal untuk job yang disapu — hold tidak menggantung', async () => {
    if (!reachable) return;
    // `sapuMenggantung()` sendiri hanya MENULIS `failed`. Sebelum T1, tidak ada
    // satu pun pemanggil hook untuk baris yang disapu, jadi hold koin
    // `ref_type='ai_job'` job itu menggantung PERMANEN — reaper hold KL-8 hanya
    // mengenal ref `scan`. Jalur pemanggilnya: penjadwal `ai-reaper`.
    const hook = new PenyelesaiUji('ats_cv');
    const id = await buatDanAntre();
    await sql`
      UPDATE ai_jobs SET status = 'running',
        created_at = now() - ${sql.lit(AMBANG_MENGGANTUNG_MENIT + 5)} * interval '1 minute'
      WHERE id = ${id}
    `.execute(db);

    const dispatch = new AiDispatchService(new AiJobsService(db, queue), new KlienUji(), [hook]);
    expect(await dispatch.sapu()).toBe(1);

    // Hook menerima baris MILIK PEMILIKNYA — itulah yang dipakai untuk
    // melepas hold yang benar.
    expect(hook.gagalDipanggil).toHaveLength(1);
    expect(hook.gagalDipanggil[0]!.jobId).toBe(id);
    expect(hook.gagalDipanggil[0]!.baris.userId).toBe(PENGGUNA);
    expect(hook.gagalDipanggil[0]!.baris.kind).toBe('ats_cv');
    expect(hook.suksesDipanggil).toHaveLength(0);
    expect((await baris(id)).status).toBe('failed');
  }, 40_000);

  it('T1: job yang MASIH MUDA → sapu() memulangkan 0 dan hook tidak dipanggil', async () => {
    if (!reachable) return;
    const hook = new PenyelesaiUji('ats_cv');
    const id = await buatDanAntre();
    await sql`
      UPDATE ai_jobs SET status = 'running',
        created_at = now() - ${sql.lit(AMBANG_MENGGANTUNG_MENIT - 5)} * interval '1 minute'
      WHERE id = ${id}
    `.execute(db);

    const dispatch = new AiDispatchService(new AiJobsService(db, queue), new KlienUji(), [hook]);
    expect(await dispatch.sapu()).toBe(0);
    expect(hook.gagalDipanggil).toHaveLength(0);
    expect((await baris(id)).status).toBe('running');
  }, 40_000);

  it('T3: hook sukses yang TIDAK PERNAH selesai dibatasi waktu — baris failed, slot worker kembali', async () => {
    if (!reachable) return;
    // Dua hook yang menggantung mematikan SELURUH antrean (concurrency 2)
    // tanpa satu galat pun. Bukti slot kembali: `jalankanWorker` menunggu
    // antrean kosong lalu menutup worker — kalau hook benar-benar menggantung
    // tanpa pagar, baris ini tidak pernah selesai dan test timeout.
    const klien = new KlienUji();
    const hook = new PenyelesaiUji('ats_cv');
    hook.gantungSukses = true;
    const id = await buatDanAntre();
    await jalankanWorker(klien, { penyelesai: [hook], batasHookMs: 50 });

    const r = await baris(id);
    expect(r.status).toBe('failed');
    expect(r.error_message).toContain('Finalisasi gagal');
    expect(r.error_message).toContain('tidak selesai dalam 50 ms');
    // Hook `gagal` tetap dipanggil: finalisasi yang timeout adalah kegagalan
    // sah yang harus dibersihkan (mis. lepas hold).
    expect(hook.gagalDipanggil).toHaveLength(1);
    expect(klien.panggilan, 'LLM dibayar dua kali oleh pengantaran ulang').toHaveLength(1);
  }, 40_000);
});
