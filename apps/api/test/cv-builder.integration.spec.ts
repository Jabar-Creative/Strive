import { NotFoundException, type INestApplication } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import type { Queue } from 'bullmq';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import type { NestApplication } from '@nestjs/core';

import { createDatabase, type DB } from '../src/infra/kysely';
import { KyselyModule } from '../src/infra/kysely';
import { BullmqModule } from '../src/infra/bullmq';
import { type AiRunResult, AiJobsService } from '../src/modules/ai';
import { PricingConfigService } from '../src/modules/payment';
import { StorageService } from '../src/infra/storage';
import { CoinLedgerService } from '../src/modules/wallet';
import {
  CareerModule,
  CareerReadService,
  CvBuilderService,
  CvFinalizeService,
  type CvGenerateInput,
} from '../src/modules/career';

/**
 * `AI-07` sisi Node terhadap DATABASE NYATA + antrean/storage PALSU (pola
 * SnapClient / klien AI palsu PL-01). Uang, kuota gabungan, idempotensi, dan
 * urutan commit↔enqueue tidak bisa dibuktikan dari mock satuan.
 *
 * AC (PRD §7 E8, §13.2):
 *   AC-CV-2:  202 {job_id}; hold ref ai_job SETELAH baris job dalam SATU
 *             transaksi; enqueue SETELAH commit (aturan keras 10).
 *   CV-9:     kuota 10 run AI/hari GABUNGAN → DAILY_AI_QUOTA_EXCEEDED.
 *   ⚡:       replay kunci menunjuk job hidup → job_id sama, tanpa biaya baru.
 *             Percobaan ulang setelah job gagal = percobaan BARU (kunci baru),
 *             kunci lama tetap memegang holdnya → KEY_CONFLICT (keputusan
 *             #245, sama dengan PL-01).
 *   #197:     failure.code hanya kode §10.2; kode vendor dipetakan
 *             INTERNAL_ERROR, error_message mentah tidak pernah dikirim.
 *
 * Lapisan HTTP mengulangi pelajaran isu #233: service benar tetapi rutenya
 * 404 pernah lewat semua gerbang — rute wajib dibuktikan lewat HTTP sungguhan.
 */

const URL_DEV = 'postgres://strive:strive_dev_only@localhost:55432/strive';
const url = process.env['DATABASE_URL_TEST'] ?? process.env['DATABASE_URL'] ?? URL_DEV;

const uuid = (n: number) => `00000000-0000-4000-8000-07${String(n).padStart(10, '0')}`;
const AKU = uuid(1); // student, 1000 koin
const LAIN = uuid(2); // student, 0 koin
const ADMIN = uuid(3); // superadmin — DITOLAK di rute career (§2.4)

const token = (id: string) => `ai07-${id.slice(-6)}`;

const ZONA = 'Asia/Jakarta';

const INPUT_PROFIL: CvGenerateInput = {
  target_role: 'Data Analyst',
  language: 'id',
  source: 'profile',
  profile: {
    nama: 'Rina Melati',
    headline: 'Mahasiswa statistika semester akhir',
    kontak: { email: 'rina-ai07@yopmail.com' },
    pengalaman: [{ judul: 'Intern Data', perusahaan: 'PT Contoh', mulai: '2024-01' }],
    keterampilan: ['SQL', 'Python'],
  },
};

/** PDF kecil yang sah untuk jalur upload (`%PDF-` — `detectType`). */
const PDF_KECIL = Buffer.from('%PDF-1.4\n%hasil-uji-ai07\n', 'binary').toString('base64');

let db: Kysely<DB>;
let app: INestApplication;
let base: string;
let reachable = false;

// ── Palsu: antrean BullMQ, storage S3 ──

let pekerjaanTerlihatSaatEnqueue = false;
let payloadJobSaatEnqueue: string | null = null;

function antreanPalsu() {
  const add = vi.fn(async (_nama: string, data: { jobId: string }) => {
    // Dijalankan SAAT enqueue — baris harus SUDAH ter-commit dan terlihat dari
    // koneksi di luar transaksi. Ini assert hidup aturan keras 10.
    const r = await db.selectFrom('ai_jobs').select('id').where('id', '=', data.jobId).execute();
    pekerjaanTerlihatSaatEnqueue = r.length === 1;
    payloadJobSaatEnqueue = data.jobId;
    return { id: data.jobId } as never;
  });
  const getJob = vi.fn(async () => null);
  const antre = { getJob, add } as unknown as Queue;
  return { antre, add };
}

function storagePalsu() {
  const unggah = vi.fn(async () => undefined);
  const tanda = vi.fn(async (_bucket: string, kunci: string) => `https://palsu.local/${kunci}`);
  const svc = { put: unggah, signedDownloadUrl: tanda } as unknown as StorageService;
  return { svc, unggah, tanda };
}

let koin: CoinLedgerService;
let simpan: ReturnType<typeof storagePalsu>;

/** Satu set service terhubung db nyata + palsuan antrean/storage. */
function rakit() {
  const antre = antreanPalsu();
  const builder = new CvBuilderService(
    db,
    koin,
    new PricingConfigService(db),
    new AiJobsService(db, antre.antre),
  );
  const finalize = new CvFinalizeService(db, koin, simpan.svc);
  const baca = new CareerReadService(db, simpan.svc);
  return { antre, builder, finalize, baca };
}

async function saldo(userId: string): Promise<number> {
  const r = await db
    .selectFrom('users')
    .select('coin_balance')
    .where('id', '=', userId)
    .executeTakeFirstOrThrow();
  return r.coin_balance;
}

async function tipeLedger(userId: string): Promise<string[]> {
  const r = await db
    .selectFrom('coin_ledger')
    .select('entry_type')
    .where('user_id', '=', userId)
    .orderBy('created_at')
    .execute();
  return r.map((x) => x.entry_type);
}

async function semaiUser(userId: string, koinAwal: number, peran: 'student' | 'superadmin') {
  await db
    .insertInto('users')
    .values({
      id: userId,
      email: `ai07-${userId.slice(-4)}@yopmail.com`,
      display_name: userId.slice(-4),
      role: peran,
      coin_balance: koinAwal,
    })
    .execute();
  if (koinAwal > 0) {
    await db
      .insertInto('coin_ledger')
      .values({ user_id: userId, entry_type: 'adjust', amount: koinAwal, balance_after: koinAwal })
      .execute();
  }
  // streaks.timezone = sumber tanggal LOKAL untuk kuota (pelajaran #193).
  await db.updateTable('streaks').set({ timezone: ZONA }).where('user_id', '=', userId).execute();
}

async function post(path: string, sebagai?: string, body?: unknown, idem?: string) {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(sebagai ? { authorization: `Bearer ${token(sebagai)}` } : {}),
      ...(idem ? { 'idempotency-key': idem } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
}

async function get(path: string, sebagai?: string) {
  return fetch(`${base}${path}`, {
    headers: sebagai ? { authorization: `Bearer ${token(sebagai)}` } : {},
  });
}

beforeAll(async () => {
  db = createDatabase(url);
  try {
    await db.selectFrom('ai_jobs').select('id').limit(1).execute();
    reachable = true;
  } catch {
    reachable = false;
    return;
  }

  process.env['DATABASE_URL'] = url;
  const moduleRef = await Test.createTestingModule({
    imports: [KyselyModule, BullmqModule, CareerModule],
  }).compile();
  // Parser dipasang PERSIS seperti main.ts (AI-07): parser bawaan dilepas,
  // json 11 mb dipasang ulang — test body >100 kb bergantung pada ini.
  // (`useBodyParser` ada di antarmuka `NestApplication`, bukan
  // `INestApplication` umum — sama seperti di main.ts.)
  const nestApp = moduleRef.createNestApplication({
    rawBody: true,
    bodyParser: false,
  }) as NestApplication;
  nestApp.useBodyParser('json', { limit: '11mb' });
  nestApp.useBodyParser('urlencoded', { limit: '11mb', extended: true });
  nestApp.setGlobalPrefix('api/v1', { exclude: ['health'] });
  const server = await nestApp.listen(0);
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('tidak mendapat port listen');
  base = `http://127.0.0.1:${addr.port}`;
  app = nestApp;

  koin = new CoinLedgerService();
  simpan = storagePalsu();
});

afterAll(async () => {
  if (app) await app.close();
  if (db) await db.destroy();
});

beforeEach(async () => {
  if (!reachable) return;
  // `simpan` dibuat SEKALI di beforeAll (dipakai semua rakit()) — hitungan
  // spy-nya harus disetel nol per test, bukan per suite.
  simpan.unggah.mockClear();
  simpan.tanda.mockClear();
  await sql`TRUNCATE users, sessions, ai_jobs, cv_documents, prompt_runs, mastery_sessions, coin_ledger, audit_log, pricing_config RESTART IDENTITY CASCADE`.execute(
    db,
  );
  await db
    .insertInto('pricing_config')
    .values({
      version: 1,
      coin_price_idr: 25,
      scan_cost_coins: 2400,
      scan_cached_cost_coins: 1200,
      lesson_reward_coins: 14,
      cv_cost_coins: 40, // kecil supaya 10 percobaan kuota muat di 1000 koin
      interview_cost_coins: 2000,
      statement_cost_coins: 2000,
      prompt_run_cost_coins: 20,
      freeze_cost_coins: 400,
      packages: JSON.stringify([{ id: 'starter', name: 'Starter', coins: 1000, price_idr: 25000 }]),
      active_from: new Date(Date.now() - 60_000),
      created_by: null,
    })
    .execute();

  await semaiUser(AKU, 1000, 'student');
  await semaiUser(LAIN, 0, 'student');
  await semaiUser(ADMIN, 0, 'superadmin');

  await db
    .insertInto('sessions')
    .values(
      [AKU, LAIN, ADMIN].map((u) => ({
        user_id: u,
        token: token(u),
        expires_at: sql`now() + interval '1 day'`,
      })),
    )
    .execute();
});

describe('POST /career/cv — service (AI-07 Node)', () => {
  it('database siap dipakai', () => {
    expect(reachable, `DATABASE_URL tidak bisa dipakai (${url})`).toBe(true);
  });

  it('AC-CV-2: 202 → baris ai_jobs kind ats_cv + hold ai_job SATU transaksi, enqueue SETELAH commit', async () => {
    if (!reachable) return;
    const { antre, builder } = rakit();

    const jobId = await builder.buat(AKU, INPUT_PROFIL, 'kunci-1');

    const job = await db
      .selectFrom('ai_jobs')
      .selectAll()
      .where('id', '=', jobId)
      .executeTakeFirstOrThrow();
    expect(job.kind).toBe('ats_cv');
    expect(job.status).toBe('queued');
    expect((job.input as { source?: string })['source']).toBe('profile');

    const hold = await db
      .selectFrom('coin_ledger')
      .selectAll()
      .where('idempotency_key', '=', 'kunci-1')
      .executeTakeFirstOrThrow();
    expect(hold.entry_type).toBe('hold');
    expect(hold.ref_type).toBe('ai_job');
    expect(hold.ref_id).toBe(jobId);
    // Konvensi ledger: hold() menerima positif dan MENYIMPAN negatif.
    expect(hold.amount).toBe(-40);

    // Aturan keras 10: saat enqueue berjalan, baris SUDAH ter-commit dan
    // terlihat dari koneksi luar transaksi.
    expect(antre.add).toHaveBeenCalledTimes(1);
    expect(payloadJobSaatEnqueue).toBe(jobId);
    expect(pekerjaanTerlihatSaatEnqueue, 'enqueue boleh hanya SETELAH commit').toBe(true);
  });

  it('transaksi gagal → TIDAK ada baris job, TIDAK ada enqueue (rollback membawa semuanya)', async () => {
    if (!reachable) return;
    const { antre, builder } = rakit();

    await expect(builder.buat(LAIN, INPUT_PROFIL, 'kunci-miskin')).rejects.toMatchObject({
      status: 402, // konvensi repo: INSUFFICIENT_COINS = 402
      response: { error: { code: 'INSUFFICIENT_COINS' } },
    });
    expect(
      await db.selectFrom('ai_jobs').where('user_id', '=', LAIN).selectAll().execute(),
    ).toHaveLength(0);
    expect(antre.add).not.toHaveBeenCalled();
  });

  it('⚡ replay kunci menunjuk job HIDUP → job_id sama, hold tetap satu, enqueue tidak diulang', async () => {
    if (!reachable) return;
    const { antre, builder } = rakit();

    const pertama = await builder.buat(AKU, INPUT_PROFIL, 'kunci-replay');
    const kedua = await builder.buat(AKU, INPUT_PROFIL, 'kunci-replay');

    expect(kedua).toBe(pertama);
    expect(antre.add).toHaveBeenCalledTimes(1);
    const hold = await db
      .selectFrom('coin_ledger')
      .where('idempotency_key', '=', 'kunci-replay')
      .selectAll()
      .execute();
    expect(hold).toHaveLength(1);
  });

  it('⚡ percobaan kedua SETELAH job gagal → KEY_CONFLICT 409 — kunci milik PERCOBAAN (keputusan #245)', async () => {
    if (!reachable) return;
    const { builder } = rakit();

    const jobId = await builder.buat(AKU, INPUT_PROFIL, 'kunci-gagal-replay');
    await db
      .updateTable('ai_jobs')
      .set({ status: 'failed', error_code: 'PROVIDER_UNAVAILABLE', completed_at: sql`now()` })
      .where('id', '=', jobId)
      .execute();

    await expect(builder.buat(AKU, INPUT_PROFIL, 'kunci-gagal-replay')).rejects.toMatchObject({
      status: 409,
      response: { error: { code: 'KEY_CONFLICT' } },
    });
    // Tidak ada job kedua: percobaan ulang jalan dengan kunci BARU.
    expect(
      await db.selectFrom('ai_jobs').where('user_id', '=', AKU).selectAll().execute(),
    ).toHaveLength(1);
  });

  it('⚡ dua percobaan satu kunci (tumpang tindih ATAU menyusul) → SATU job, SATU hold — tidak pernah dua', async () => {
    if (!reachable) return;
    const { antre, builder } = rakit();

    const hasil = await Promise.allSettled([
      builder.buat(AKU, INPUT_PROFIL, 'kunci-paralel'),
      builder.buat(AKU, INPUT_PROFIL, 'kunci-paralel'),
    ]);
    const sukses = hasil.flatMap((h) => (h.status === 'fulfilled' ? [h.value] : []));
    const galat = hasil.flatMap((h) => (h.status === 'rejected' ? [h.reason] : []));

    // Dua akhir yang SAH, tergantung siapa yang commit lebih dulu:
    // (a) tumpang tindih sungguhan → yang kalah 409 KEY_CONFLICT (pemeriksaan
    //     ulang idempotensi SETELAH kunci users di `write()`);
    // (b) yang kedua mulai SETELAH commit → jalur replay, job_id sama.
    // Jadwal event loop menentukan yang mana — yang TIDAK boleh terjadi:
    // dua job, dua hold, atau koin terpotong dua kali.
    if (galat.length === 1) {
      expect(sukses).toHaveLength(1);
      expect(galat[0]).toMatchObject({
        status: 409,
        response: { error: { code: 'KEY_CONFLICT' } },
      });
    } else {
      expect(sukses).toHaveLength(2);
      expect(sukses[1]).toBe(sukses[0]); // replay mengembalikan job yang sama
    }

    expect(
      await db.selectFrom('ai_jobs').where('user_id', '=', AKU).selectAll().execute(),
    ).toHaveLength(1);
    const hold = await db
      .selectFrom('coin_ledger')
      .selectAll()
      .where('idempotency_key', '=', 'kunci-paralel')
      .execute();
    expect(hold).toHaveLength(1);
    expect(hold[0].amount).toBe(-40); // koin terpotong TEPAT SEKALI
    expect(antre.add).toHaveBeenCalledTimes(1); // replay/conflict tidak enqueue ulang
  });

  it('CV-9: percobaan ke-11 hari ini → 429 DAILY_AI_QUOTA_EXCEEDED, LLM tidak di-enqueue', async () => {
    if (!reachable) return;
    const { antre, builder } = rakit();

    for (let i = 1; i <= 10; i++) {
      await builder.buat(AKU, INPUT_PROFIL, `kunci-kuota-${i}`);
    }
    await expect(builder.buat(AKU, INPUT_PROFIL, 'kunci-kuota-11')).rejects.toMatchObject({
      status: 429,
      response: { error: { code: 'DAILY_AI_QUOTA_EXCEEDED' } },
    });
    expect(antre.add).toHaveBeenCalledTimes(10); // ke-11 tidak pernah dijalankan
  });

  it('harga belum diterbitkan → 503 PRICING_NOT_CONFIGURED tanpa baris job', async () => {
    if (!reachable) return;
    await db.deleteFrom('pricing_config').execute();
    const { builder } = rakit();

    await expect(builder.buat(AKU, INPUT_PROFIL, 'kunci-tanpa-harga')).rejects.toMatchObject({
      status: 503,
      response: { error: { code: 'PRICING_NOT_CONFIGURED' } },
    });
    expect(
      await db.selectFrom('ai_jobs').where('user_id', '=', AKU).selectAll().execute(),
    ).toHaveLength(0);
  });

  it('validasi: upload bukan base64 → VALIDATION_ERROR; bukan PDF/DOCX → UNSUPPORTED_FILE_TYPE; >8 MB → FILE_TOO_LARGE', async () => {
    if (!reachable) return;
    const { builder } = rakit();

    const dasar = {
      target_role: 'Data Analyst',
      language: 'id' as const,
      source: 'upload' as const,
    };
    await expect(
      builder.buat(AKU, { ...dasar, document_base64: '@@@bukan-base64@@@' }, 'v-1'),
    ).rejects.toMatchObject({ response: { error: { code: 'VALIDATION_ERROR' } } });

    await expect(
      builder.buat(
        AKU,
        { ...dasar, document_base64: Buffer.from('hello', 'binary').toString('base64') },
        'v-2',
      ),
    ).rejects.toMatchObject({
      status: 400,
      response: { error: { code: 'UNSUPPORTED_FILE_TYPE' } },
    });

    const raksasa = Buffer.alloc(8 * 1024 * 1024 + 1024).toString('base64');
    await expect(
      builder.buat(AKU, { ...dasar, document_base64: raksasa }, 'v-3'),
    ).rejects.toMatchObject({
      status: 400,
      response: { error: { code: 'FILE_TOO_LARGE' } },
    });

    expect(
      await db.selectFrom('ai_jobs').where('user_id', '=', AKU).selectAll().execute(),
    ).toHaveLength(0);
  });

  it('validasi: PDF sah dari ISI berkas (bukan nama) diterima sebagai job upload', async () => {
    if (!reachable) return;
    const { builder } = rakit();

    const jobId = await builder.buat(
      AKU,
      {
        target_role: 'Backend Engineer',
        language: 'en',
        source: 'upload',
        document_base64: PDF_KECIL,
      },
      'v-pdf',
    );
    const job = await db
      .selectFrom('ai_jobs')
      .selectAll()
      .where('id', '=', jobId)
      .executeTakeFirstOrThrow();
    expect((job.input as { source?: string })['source']).toBe('upload');
  });

  it('validasi: profile tanpa nama → VALIDATION_ERROR menunjuk bagian penyebab', async () => {
    if (!reachable) return;
    const { builder } = rakit();
    await expect(
      builder.buat(AKU, { ...INPUT_PROFIL, profile: { nama: '' } }, 'v-profil'),
    ).rejects.toMatchObject({
      response: { error: { code: 'VALIDATION_ERROR', details: { bagian: 'profile.nama' } } },
    });
  });
});

describe('CvFinalizeService — hook PENYELESAI_JOB_AI kind ats_cv', () => {
  it('sukses: PDF ke storage DULU, lalu cv_documents + settle dalam satu transaksi', async () => {
    if (!reachable) return;
    const { builder, finalize } = rakit();

    const jobId = await builder.buat(AKU, INPUT_PROFIL, 'f-1');
    const baris = await db
      .selectFrom('ai_jobs')
      .select(['id', 'user_id', 'kind', 'input'])
      .where('id', '=', jobId)
      .executeTakeFirstOrThrow();
    await finalize.sukses(
      jobId,
      { id: baris.id, userId: baris.user_id, kind: baris.kind, input: baris.input },
      hasilCv(87),
    );

    const dok = await db
      .selectFrom('cv_documents')
      .selectAll()
      .where('job_id', '=', jobId)
      .executeTakeFirstOrThrow();
    expect(dok.ats_score).toBe(87);
    expect(dok.pdf_key).toBe(`cvs/${jobId}.pdf`);
    // Settle TIDAK menulis baris ledger baru — hold sudah memotong saldo saat
    // ditulis; jejak permanensinya di audit_log (CO-8). Pola yang sama dengan
    // AC-PL-1 yang meng-expect ['adjust','hold'].
    expect(await tipeLedger(AKU)).toEqual(['adjust', 'hold']);
    const audit = await db
      .selectFrom('audit_log')
      .selectAll()
      .where('action', '=', 'coin.settle')
      .where('subject_type', '=', 'ai_job')
      .where('subject_id', '=', jobId)
      .execute();
    expect(audit).toHaveLength(1);
    expect(await saldo(AKU)).toBe(960); // 1000 - 40, terpotong saat hold
    expect(simpan.unggah).toHaveBeenCalledTimes(1);
  });

  it('sukses DUA KALI (pengantaran ulang BullMQ) → tetap satu baris, satu settle', async () => {
    if (!reachable) return;
    const { builder, finalize } = rakit();

    const jobId = await builder.buat(AKU, INPUT_PROFIL, 'f-2');
    const baris = await db
      .selectFrom('ai_jobs')
      .select(['id', 'user_id', 'kind', 'input'])
      .where('id', '=', jobId)
      .executeTakeFirstOrThrow();
    const b = { id: baris.id, userId: baris.user_id, kind: baris.kind, input: baris.input };

    await finalize.sukses(jobId, b, hasilCv(72));
    await finalize.sukses(jobId, b, hasilCv(72));

    expect(
      await db.selectFrom('cv_documents').where('job_id', '=', jobId).selectAll().execute(),
    ).toHaveLength(1);
    // Settle kedua no-op: tetap satu hold, satu baris audit coin.settle.
    expect(await tipeLedger(AKU)).toEqual(['adjust', 'hold']);
    expect(
      await db
        .selectFrom('audit_log')
        .selectAll()
        .where('action', '=', 'coin.settle')
        .where('subject_id', '=', jobId)
        .execute(),
    ).toHaveLength(1);
    expect(simpan.unggah).toHaveBeenCalledTimes(1);
  });

  it('gagal TANPA sukses pernah berjalan: hold dilepas, koin utuh, aman', async () => {
    if (!reachable) return;
    const { builder, finalize } = rakit();

    const jobId = await builder.buat(AKU, INPUT_PROFIL, 'f-3');
    const baris = await db
      .selectFrom('ai_jobs')
      .select(['id', 'user_id', 'kind', 'input'])
      .where('id', '=', jobId)
      .executeTakeFirstOrThrow();

    await finalize.gagal(jobId, {
      id: baris.id,
      userId: baris.user_id,
      kind: baris.kind,
      input: baris.input,
    });

    expect(await tipeLedger(AKU)).toEqual(['adjust', 'hold', 'release']);
    expect(await saldo(AKU)).toBe(1000);
    expect(await db.selectFrom('cv_documents').selectAll().execute()).toHaveLength(0);
  });

  it('output vendor rusak (ats_score liar) → sukses melempar, TIDAK ada baris; gagal menyusul → koin kembali', async () => {
    if (!reachable) return;
    const { builder, finalize } = rakit();

    const jobId = await builder.buat(AKU, INPUT_PROFIL, 'f-4');
    const baris = await db
      .selectFrom('ai_jobs')
      .select(['id', 'user_id', 'kind', 'input'])
      .where('id', '=', jobId)
      .executeTakeFirstOrThrow();
    const b = { id: baris.id, userId: baris.user_id, kind: baris.kind, input: baris.input };

    await expect(finalize.sukses(jobId, b, hasilCv(150))).rejects.toBeInstanceOf(Error);
    expect(await db.selectFrom('cv_documents').selectAll().execute()).toHaveLength(0);

    await finalize.gagal(jobId, b);
    expect(await tipeLedger(AKU)).toEqual(['adjust', 'hold', 'release']);
    expect(await saldo(AKU)).toBe(1000);
  });
});

describe('GET /career/cv/jobs/:jobId — CareerReadService (isu #197)', () => {
  it('done → cv terisi dengan skor + temuan + pdf_url bertanda tangan, failure null', async () => {
    if (!reachable) return;
    const { builder, finalize, baca } = rakit();

    const jobId = await builder.buat(AKU, INPUT_PROFIL, 's-1');
    const baris = await db
      .selectFrom('ai_jobs')
      .select(['id', 'user_id', 'kind', 'input'])
      .where('id', '=', jobId)
      .executeTakeFirstOrThrow();
    await finalize.sukses(
      jobId,
      { id: baris.id, userId: baris.user_id, kind: baris.kind, input: baris.input },
      hasilCv(87),
    );
    await db
      .updateTable('ai_jobs')
      .set({ status: 'done', completed_at: sql`now()` })
      .where('id', '=', jobId)
      .execute();

    const res = await baca.jobStatus(AKU, jobId);
    expect(res.status).toBe('done');
    expect(res.failure).toBeNull();
    expect(res.cv?.ats_score).toBe(87);
    expect(res.cv?.pdf_url).toBe(`https://palsu.local/cvs/${jobId}.pdf`);
  });

  it('failed + kode §10.2 → diteruskan apa adanya (PROVIDER_UNAVAILABLE)', async () => {
    if (!reachable) return;
    const { builder, baca } = rakit();
    const jobId = await builder.buat(AKU, INPUT_PROFIL, 's-2');
    await db
      .updateTable('ai_jobs')
      .set({ status: 'failed', error_code: 'PROVIDER_UNAVAILABLE', completed_at: sql`now()` })
      .where('id', '=', jobId)
      .execute();

    expect((await baca.jobStatus(AKU, jobId)).failure).toEqual({ code: 'PROVIDER_UNAVAILABLE' });
  });

  it('failed + kode vendor di luar §10.2 → INTERNAL_ERROR; error_message mentah TIDAK PERNAH dikirim', async () => {
    if (!reachable) return;
    const { builder, baca } = rakit();
    const jobId = await builder.buat(AKU, INPUT_PROFIL, 's-3');
    await db
      .updateTable('ai_jobs')
      .set({
        status: 'failed',
        error_code: 'EAI_VENDOR_BOOM_4999',
        // Bisa memuat gema input pengguna (audit AI-07 T5) — tidak boleh bocor.
        error_message: 'RAHASIA-VENDOR: echo dari input Rina Melati',
        completed_at: sql`now()`,
      })
      .where('id', '=', jobId)
      .execute();

    const res = await baca.jobStatus(AKU, jobId);
    expect(res.failure).toEqual({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(res)).not.toContain('RAHASIA-VENDOR');
    expect(JSON.stringify(res)).not.toContain('Rina Melati');
  });

  it('job orang lain dan job yang tidak ada menjawab IDENTIK (404 NOT_FOUND)', async () => {
    if (!reachable) return;
    const { builder, baca } = rakit();
    const jobId = await builder.buat(AKU, INPUT_PROFIL, 's-4');

    const milikOrang = await baca.jobStatus(LAIN, jobId).catch((e: NotFoundException) => e);
    const tidakAda = await baca.jobStatus(LAIN, uuid(99)).catch((e: NotFoundException) => e);
    expect(milikOrang).toBeInstanceOf(NotFoundException);
    expect(tidakAda).toBeInstanceOf(NotFoundException);
    const a = (milikOrang as NotFoundException).getResponse() as {
      error: { code: string; message: string };
    };
    const b = (tidakAda as NotFoundException).getResponse() as {
      error: { code: string; message: string };
    };
    expect(a.error.code).toBe('NOT_FOUND');
    expect(a.error.code).toBe(b.error.code);
    expect(a.error.message).toBe(b.error.message);
  });
});

describe('POST/GET /career/cv — rute HTTP (pelajaran isu #233)', () => {
  it('202 {job_id} dari jalur HTTP; baris ai_jobs + hold tertulis sungguhan', async () => {
    if (!reachable) return;
    const res = await post('/api/v1/career/cv', AKU, INPUT_PROFIL, 'k-rute-1');
    expect(res.status).toBe(202);
    const isi = (await res.json()) as { job_id: string };
    expect(isi.job_id).toMatch(/^[0-9a-f-]{36}$/);

    const job = await db
      .selectFrom('ai_jobs')
      .selectAll()
      .where('id', '=', isi.job_id)
      .executeTakeFirstOrThrow();
    expect(job.kind).toBe('ats_cv');
    const hold = await db
      .selectFrom('coin_ledger')
      .selectAll()
      .where('idempotency_key', '=', 'k-rute-1')
      .executeTakeFirstOrThrow();
    expect(hold.ref_id).toBe(isi.job_id);
  });

  it('⚡ replay kunci sama lewat HTTP → job_id sama, hold tetap satu', async () => {
    if (!reachable) return;
    const a = await post('/api/v1/career/cv', AKU, INPUT_PROFIL, 'k-rute-2');
    const b = await post('/api/v1/career/cv', AKU, INPUT_PROFIL, 'k-rute-2');
    expect(a.status).toBe(202);
    expect(b.status).toBe(202);
    const ja = (await a.json()) as { job_id: string };
    const jb = (await b.json()) as { job_id: string };
    expect(jb.job_id).toBe(ja.job_id);
    expect(
      await db
        .selectFrom('coin_ledger')
        .where('idempotency_key', '=', 'k-rute-2')
        .selectAll()
        .execute(),
    ).toHaveLength(1);
  });

  it('tanpa Idempotency-Key → 400 VALIDATION_ERROR, NOL job tertulis', async () => {
    if (!reachable) return;
    const res = await post('/api/v1/career/cv', AKU, INPUT_PROFIL);
    expect(res.status).toBe(400);
    const isi = (await res.json()) as { error?: { code?: string } };
    expect(isi.error?.code).toBe('VALIDATION_ERROR');
    expect(await db.selectFrom('ai_jobs').selectAll().execute()).toHaveLength(0);
  });

  it('body 200 KB (base64) DITERIMA parser 11 mb → ditolak validasi, BUKAN 413', async () => {
    if (!reachable) return;
    const dokumen = Buffer.alloc(150_000).toString('base64'); // ~200 kb JSON
    const res = await post(
      '/api/v1/career/cv',
      AKU,
      { target_role: 'Data Analyst', language: 'id', source: 'upload', document_base64: dokumen },
      'k-rute-besar',
    );
    expect(res.status).toBe(400); // bukan 413 PayloadTooLarge
    const isi = (await res.json()) as { error?: { code?: string } };
    expect(isi.error?.code).toBe('UNSUPPORTED_FILE_TYPE');
  });

  it('tanpa sesi → 401; superadmin → 403 (career milik BELAJAR, §2.4)', async () => {
    if (!reachable) return;
    const tamu = await post('/api/v1/career/cv', undefined, INPUT_PROFIL, 'k-tamu');
    expect(tamu.status).toBe(401);
    const admin = await post('/api/v1/career/cv', ADMIN, INPUT_PROFIL, 'k-admin');
    expect(admin.status).toBe(403);
  });

  it('GET /career/cv/jobs/:jobId: pemilik 200, orang lain 404, tanpa sesi 401', async () => {
    if (!reachable) return;
    const buat = await post('/api/v1/career/cv', AKU, INPUT_PROFIL, 'k-rute-status');
    const { job_id: jobId } = (await buat.json()) as { job_id: string };

    const pemilik = await get(`/api/v1/career/cv/jobs/${jobId}`, AKU);
    expect(pemilik.status).toBe(200);
    expect(((await pemilik.json()) as { status?: string }).status).toBe('queued');

    const orangLain = await get(`/api/v1/career/cv/jobs/${jobId}`, LAIN);
    expect(orangLain.status).toBe(404);
    expect(((await orangLain.json()) as { error?: { code?: string } }).error?.code).toBe(
      'NOT_FOUND',
    );

    const tamu = await get(`/api/v1/career/cv/jobs/${jobId}`);
    expect(tamu.status).toBe(401);
  });
});

/** Hasil `/v1/cv` palsu — bentuk output layanan AI (services/ai cv.py). */
function hasilCv(skor: number): AiRunResult {
  return {
    output: {
      structured: { nama: 'Rina Melati' },
      ats_score: skor,
      ats_findings: [
        { severity: 'warning', pesan: 'Kontak telepon kosong', aturan: 'ATS-KONTAK', penalti: 5 },
      ],
      pdf_base64: PDF_KECIL,
    },
    model: 'cv-palsu',
    promptVersion: 'ats-cv/2026-11-05',
    inputTokens: 100,
    outputTokens: 200,
    costUsd: 0.002,
  };
}
