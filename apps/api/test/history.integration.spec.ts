import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { encodeCursor, HISTORY_LIMIT_MAX } from '../src/common/cursor';
import { createDatabase, type DB } from '../src/infra/kysely';
import { CareerReadService } from '../src/modules/career';
import { AttemptHistoryService } from '../src/modules/learning';
import { MasteryService } from '../src/modules/mastery';
import { OrderReadService } from '../src/modules/payment';
import { ReviewHistoryService } from '../src/modules/review';
import { ScanHistoryService } from '../src/modules/scan';
import { StorageService } from '../src/infra/storage';

/**
 * `F-14` terhadap DATABASE NYATA — PRD §10.3, isu #88.
 *
 * Acceptance criteria-nya menuntut satu hal secara harfiah: kepemilikan
 * dibuktikan **"di setiap rute, bukan di satu rute contoh"**. Jadi ketujuh
 * rute dijalankan lewat satu daftar yang sama di bawah — kalau ada rute baru
 * yang lupa ditambahkan ke daftar itu, ia juga tidak akan punya test.
 */

const URL_DEV = 'postgres://strive:strive_dev_only@localhost:55432/strive';
const url = process.env['DATABASE_URL_TEST'] ?? process.env['DATABASE_URL'] ?? URL_DEV;

const AKU = '00000000-0000-4000-8000-0000000f1401';
const LAIN = '00000000-0000-4000-8000-0000000f1402';
const ADMIN = '00000000-0000-4000-8000-0000000f1403';
const TRACK = '00000000-0000-4000-8000-0000000f1410';
const MODUL = '00000000-0000-4000-8000-0000000f1411';
const LESSON = '00000000-0000-4000-8000-0000000f1412';
// Lesson KEDUA khusus attempt milik review: `lesson_attempts_daily_uniq`
// (user_id, lesson_id, attempt_date) membuat dua attempt di lesson & tanggal
// yang sama mustahil, dan `semaiReview` membuat attempt-nya sendiri.
const LESSON2 = '00000000-0000-4000-8000-0000000f1413';
const HANTU = '00000000-0000-4000-8000-0000000f14ff';

let db: Kysely<DB>;
let attempts: AttemptHistoryService;
let scans: ScanHistoryService;
let reviews: ReviewHistoryService;
let orders: OrderReadService;
let karir: CareerReadService;
let mastery: MasteryService;
let reachable = false;

/** Storage tiruan: rute `cv/:id` hanya perlu URL, bukan MinIO yang hidup. */
class StoragePalsu {
  signed: string[] = [];
  async signedDownloadUrl(bucket: string, key: string): Promise<string> {
    this.signed.push(key);
    return `https://palsu.test/${bucket}/${key}?sig=x`;
  }
}
let storage: StoragePalsu;

// ── Ketujuh rute, satu daftar ────────────────────────────────────────────
//
// `daftar` = rute cursor-paginated. `satu` = rute baris tunggal by id.

interface RuteDaftar {
  nama: string;
  prefix: string;
  panggil: (
    userId: string,
    opts?: { cursor?: string; limit?: unknown },
  ) => Promise<{
    data: { id: string }[];
    next_cursor: string | null;
  }>;
  /** Membuat satu baris milik `userId`, mengembalikan idnya. */
  semai: (userId: string, ke: number) => Promise<string>;
}

interface RuteSatu {
  nama: string;
  panggil: (userId: string, id: string) => Promise<{ id: string }>;
  semai: (userId: string) => Promise<string>;
}

let RUTE_DAFTAR: RuteDaftar[];
let RUTE_SATU: RuteSatu[];

/**
 * Satu attempt, `ke` hari lalu.
 *
 * Tanggalnya digeser per `ke` karena `lesson_attempts_daily_uniq`
 * (user_id, lesson_id, attempt_date) melarang dua attempt di lesson dan hari
 * yang sama — dan seluruh riwayat butuh lebih dari satu baris.
 *
 * `- ${sql.lit(n)}::int` dengan cast EKSPLISIT: tanpa itu PostgreSQL memilih
 * `date - date → int` dan menolak hasilnya (jebakan yang sudah tercatat di
 * CLAUDE.md).
 */
async function semaiAttemptRow(
  userId: string,
  ke: number,
  lessonId = LESSON,
): Promise<{ id: string; attempt_date: string }> {
  return db
    .insertInto('lesson_attempts')
    .values({
      user_id: userId,
      lesson_id: lessonId,
      attempt_date: sql`(now() AT TIME ZONE 'Asia/Jakarta')::date - ${sql.lit(ke)}::int`,
      card_results: JSON.stringify([{ card: 1, answer: 'b' }]),
      score: 80,
      points: 8,
      coins: 2,
      duration_ms: 1000,
      completed_at: sql`now() - (${sql.lit(ke)} || ' minutes')::interval`,
    })
    .returning(['id', 'attempt_date'])
    .executeTakeFirstOrThrow();
}

async function semaiAttempt(userId: string, ke: number): Promise<string> {
  return (await semaiAttemptRow(userId, ke)).id;
}

async function semaiScan(userId: string, ke: number): Promise<string> {
  const r = await db
    .insertInto('plagiarism_scans')
    .values({
      user_id: userId,
      document_sha256: String(ke).padStart(64, 'a'),
      document_key: `rahasia/${userId}/${ke}.pdf`,
      filename: `berkas-${ke}.pdf`,
      report_key: `laporan/${ke}.json`,
      cost_coins: 2400,
      created_at: sql`now() - (${sql.lit(ke)} || ' minutes')::interval`,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return r.id;
}

async function semaiReview(userId: string, ke: number): Promise<string> {
  // `author_id` = pemilik riwayat: `/reviews/mine` adalah review yang DITERIMA.
  const penilai = userId === AKU ? LAIN : AKU;
  // Lesson lain supaya tidak bertabrakan dengan attempt yang disemai
  // `semaiAttempt` di test yang sama.
  const attempt = await semaiAttemptRow(userId, ke, LESSON2);
  const r = await db
    .insertInto('peer_reviews')
    .values({
      attempt_id: attempt.id,
      // WAJIB diambil dari baris attempt-nya, tidak pernah dibentuk di Node:
      // itu tanggal LOKAL pengguna, dan FK (attempt_id, attempt_date) akan
      // menolak dengan pesan yang tidak menunjuk ke penyebabnya.
      attempt_date: attempt.attempt_date,
      reviewer_id: penilai,
      author_id: userId,
      rubric_scores: JSON.stringify({ kejelasan: 4 }),
      comment: 'bagus',
      weighted_points: 4,
      created_at: sql`now() - (${sql.lit(ke)} || ' minutes')::interval`,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return r.id;
}

async function semaiOrder(userId: string, ke = 0): Promise<string> {
  const r = await db
    .insertInto('orders')
    .values({
      user_id: userId,
      pricing_version: 1,
      coins: 1000,
      amount_idr: 25000,
      idempotency_key: `f14-${userId}-${ke}`,
      created_at: sql`now() - (${sql.lit(ke)} || ' minutes')::interval`,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return r.id;
}

async function semaiCv(userId: string, ke = 0): Promise<string> {
  const r = await db
    .insertInto('cv_documents')
    .values({
      user_id: userId,
      structured: JSON.stringify({ nama: 'x' }),
      ats_score: 70,
      pdf_key: `cv/${userId}/${ke}.pdf`,
      created_at: sql`now() - (${sql.lit(ke)} || ' minutes')::interval`,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return r.id;
}

async function semaiPrompt(userId: string, ke: number): Promise<string> {
  const r = await db
    .insertInto('prompt_runs')
    .values({
      user_id: userId,
      structure: JSON.stringify({ task: 'x' }),
      output: 'keluaran',
      created_at: sql`now() - (${sql.lit(ke)} || ' minutes')::interval`,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return r.id;
}

async function semaiMastery(userId: string, ke: number): Promise<string> {
  const r = await db
    .insertInto('mastery_sessions')
    .values({
      user_id: userId,
      kind: 'interview',
      turns: JSON.stringify([{ role: 'question', text: 'q', at: '2026-01-01T00:00:00Z' }]),
      created_at: sql`now() - (${sql.lit(ke)} || ' minutes')::interval`,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return r.id;
}

beforeAll(async () => {
  db = createDatabase(url);
  storage = new StoragePalsu();
  attempts = new AttemptHistoryService(db);
  scans = new ScanHistoryService(db);
  reviews = new ReviewHistoryService(db);
  orders = new OrderReadService(db);
  karir = new CareerReadService(db, storage as unknown as StorageService);
  mastery = new MasteryService(db);

  RUTE_DAFTAR = [
    {
      nama: 'GET /attempts',
      prefix: 'at',
      panggil: (u, o) => attempts.historyFor(u, o),
      semai: semaiAttempt,
    },
    {
      nama: 'GET /scans',
      prefix: 'sc',
      panggil: (u, o) => scans.historyFor(u, o),
      semai: semaiScan,
    },
    {
      nama: 'GET /reviews/mine',
      prefix: 'rv',
      panggil: (u, o) => reviews.receivedBy(u, o),
      semai: semaiReview,
    },
    {
      nama: 'GET /career/prompt-lab/history',
      prefix: 'pl',
      panggil: (u, o) => karir.promptHistory(u, o),
      semai: semaiPrompt,
    },
    {
      nama: 'GET /mastery/sessions',
      prefix: 'ms',
      panggil: (u, o) => mastery.historyFor(u, o),
      semai: semaiMastery,
    },
  ];

  RUTE_SATU = [
    {
      nama: 'GET /payments/orders/:id',
      panggil: (u, i) => orders.byId(u, i),
      semai: (u) => semaiOrder(u),
    },
    { nama: 'GET /career/cv/:id', panggil: (u, i) => karir.cvById(u, i), semai: (u) => semaiCv(u) },
  ];

  try {
    await db.selectFrom('users').select('id').limit(1).execute();
    reachable = true;
  } catch {
    reachable = false;
  }
});

afterAll(async () => {
  if (db) await db.destroy();
});

beforeEach(async () => {
  if (!reachable) return;
  await sql`TRUNCATE users, tracks, pricing_config RESTART IDENTITY CASCADE`.execute(db);
  await db
    .insertInto('users')
    .values([
      {
        id: ADMIN,
        email: 'f14a@uji.test',
        display_name: 'A',
        role: 'superadmin',
      },
      { id: AKU, email: 'f14aku@uji.test', display_name: 'Aku' },
      { id: LAIN, email: 'f14lain@uji.test', display_name: 'Lain' },
    ])
    .execute();
  await db.insertInto('tracks').values({ id: TRACK, slug: 'f14', title: 'T' }).execute();
  await db.insertInto('modules').values({ id: MODUL, track_id: TRACK, title: 'M' }).execute();
  await db
    .insertInto('lessons')
    .values([
      { id: LESSON, module_id: MODUL, title: 'L' },
      { id: LESSON2, module_id: MODUL, title: 'L2' },
    ])
    .execute();
  await db
    .insertInto('pricing_config')
    .values({
      version: 1,
      coin_price_idr: 25,
      scan_cost_coins: 2400,
      scan_cached_cost_coins: 240,
      lesson_reward_coins: 20,
      cv_cost_coins: 400,
      interview_cost_coins: 300,
      statement_cost_coins: 500,
      prompt_run_cost_coins: 20,
      freeze_cost_coins: 200,
      packages: JSON.stringify([{ id: 's', name: 'S', coins: 1000, price_idr: 25000 }]),
      created_by: ADMIN,
    })
    .execute();
  storage.signed = [];
});

describe('F-14 — riwayat milik sendiri (database nyata)', () => {
  it('database siap dipakai', () => {
    expect(reachable, `DATABASE_URL tidak bisa dipakai (${url})`).toBe(true);
  });

  it('ketujuh rute terdaftar di test ini — kalau ada yang hilang, ia tidak diuji', () => {
    expect(RUTE_DAFTAR.length + RUTE_SATU.length).toBe(7);
  });

  // ── AC: kepemilikan, DI SETIAP RUTE ────────────────────────────────────

  it('AC: daftar hanya memuat baris milik pemanggil — kelima rute daftar', async () => {
    if (!reachable) return;
    for (const r of RUTE_DAFTAR) {
      const milikku = await r.semai(AKU, 1);
      await r.semai(LAIN, 2);
      await r.semai(LAIN, 3);

      const hal = await r.panggil(AKU);
      expect(
        hal.data.map((x) => x.id),
        `${r.nama} membocorkan baris orang lain`,
      ).toEqual([milikku]);
    }
  });

  it('AC: `:id` milik orang lain menjawab SAMA dengan id yang tidak ada', async () => {
    if (!reachable) return;
    for (const r of RUTE_SATU) {
      const milikOrangLain = await r.semai(LAIN);

      // Dua penolakan ini WAJIB tidak bisa dibedakan. Kalau yang satu 403 dan
      // yang lain 404, penebak id belajar mana yang nyata.
      const a = await r.panggil(AKU, milikOrangLain).catch((e) => e);
      const b = await r.panggil(AKU, HANTU).catch((e) => e);

      expect(a, `${r.nama} membocorkan milik orang lain`).toBeInstanceOf(NotFoundException);
      expect(b).toBeInstanceOf(NotFoundException);
      expect(a.getStatus()).toBe(b.getStatus());
      expect(a.getResponse().error.code).toBe(b.getResponse().error.code);
    }
  });

  it('`:id` milik sendiri TETAP bisa dibaca — penjaga terhadap WHERE yang kelewat ketat', async () => {
    if (!reachable) return;
    for (const r of RUTE_SATU) {
      const milikku = await r.semai(AKU);
      expect((await r.panggil(AKU, milikku)).id, r.nama).toBe(milikku);
    }
  });

  // ── AC: cursor ─────────────────────────────────────────────────────────

  it('AC: cursor rusak menjawab INVALID_CURSOR, BUKAN 500', async () => {
    if (!reachable) return;
    const rusak = ['bukan-base64!!', 'Zm9v', '', Buffer.from('at:x|y').toString('base64url')];
    for (const r of RUTE_DAFTAR) {
      for (const c of rusak.filter(Boolean)) {
        const e = await r.panggil(AKU, { cursor: c }).catch((x) => x);
        expect(e, `${r.nama} + cursor "${c}"`).toBeInstanceOf(BadRequestException);
        expect(e.getResponse().error.code).toBe('INVALID_CURSOR');
      }
    }
  });

  it('cursor dari rute LAIN ditolak, bukan dipakai diam-diam', async () => {
    if (!reachable) return;
    // Tanpa prefiks, cursor ini akan didekode dengan sukses dan mengembalikan
    // halaman yang salah TANPA error — kegagalan yang paling mahal.
    const asing = encodeCursor('cl', { ts: '2026-01-01T00:00:00.000000Z', id: HANTU });
    for (const r of RUTE_DAFTAR) {
      const e = await r.panggil(AKU, { cursor: asing }).catch((x) => x);
      expect(e, r.nama).toBeInstanceOf(BadRequestException);
      expect(e.getResponse().error.code).toBe('INVALID_CURSOR');
    }
  });

  it('menelusuri SELURUH riwayat satu per satu: tanpa baris hilang, tanpa yang ganda', async () => {
    if (!reachable) return;
    for (const r of RUTE_DAFTAR) {
      const dibuat: string[] = [];
      for (let i = 1; i <= 7; i++) dibuat.push(await r.semai(AKU, i));

      const terkumpul: string[] = [];
      let cursor: string | null = null;
      for (let putaran = 0; putaran < 20; putaran++) {
        const hal: { data: { id: string }[]; next_cursor: string | null } = await r.panggil(AKU, {
          ...(cursor ? { cursor } : {}),
          limit: 2,
        });
        terkumpul.push(...hal.data.map((x) => x.id));
        cursor = hal.next_cursor;
        if (!cursor) break;
      }

      expect(terkumpul, `${r.nama}: ada yang GANDA`).toHaveLength(new Set(terkumpul).size);
      // Terbaru dulu: yang disemai dengan offset 1 menit adalah yang terbaru.
      expect(terkumpul, `${r.nama}: baris hilang atau urutannya salah`).toEqual(dibuat);
    }
  });

  it('dua baris dalam MILIDETIK yang sama tetap utuh — presisi mikrodetik', async () => {
    if (!reachable) return;
    // `Date` JavaScript hanya milidetik. Cursor yang dibentuk dari
    // `row.created_at.toISOString()` memotong tiga digit terakhir, dan kedua
    // baris ini jadi tidak terbedakan — salah satunya hilang atau terkirim
    // dua kali.
    const dasar = '2026-09-20 10:00:00';
    const ids: string[] = [];
    for (const us of ['.000003', '.000002', '.000001']) {
      const r = await db
        .insertInto('prompt_runs')
        .values({
          user_id: AKU,
          structure: JSON.stringify({ us }),
          created_at: sql`${`${dasar}${us}+00`}::timestamptz`,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      ids.push(r.id);
    }

    const terkumpul: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 6; i++) {
      const hal = await karir.promptHistory(AKU, { ...(cursor ? { cursor } : {}), limit: 1 });
      terkumpul.push(...hal.data.map((x) => x.id));
      cursor = hal.next_cursor;
      if (!cursor) break;
    }

    expect(terkumpul, 'presisi cursor terpotong ke milidetik').toEqual(ids);
  });

  it('`limit` dijepit, bukan ditolak', async () => {
    if (!reachable) return;
    for (let i = 1; i <= 3; i++) await semaiPrompt(AKU, i);

    for (const nakal of [0, -5, 'abc', null, undefined, 9999, 2.7]) {
      const hal = await karir.promptHistory(AKU, { limit: nakal });
      expect(hal.data.length, `limit=${String(nakal)}`).toBeGreaterThanOrEqual(1);
      expect(hal.data.length).toBeLessThanOrEqual(HISTORY_LIMIT_MAX);
    }
    expect((await karir.promptHistory(AKU, { limit: 2 })).data).toHaveLength(2);
  });

  it('riwayat kosong: halaman kosong, bukan galat', async () => {
    if (!reachable) return;
    for (const r of RUTE_DAFTAR) {
      const hal = await r.panggil(AKU);
      expect(hal.data, r.nama).toEqual([]);
      expect(hal.next_cursor, r.nama).toBeNull();
    }
  });

  it('halaman terakhir TIDAK memberi next_cursor', async () => {
    if (!reachable) return;
    await semaiPrompt(AKU, 1);
    await semaiPrompt(AKU, 2);
    const hal = await karir.promptHistory(AKU, { limit: 5 });
    expect(hal.data).toHaveLength(2);
    expect(hal.next_cursor, 'next_cursor diberikan padahal sudah habis').toBeNull();
  });

  // ── Yang tidak boleh ikut keluar ───────────────────────────────────────

  it('riwayat scan tidak membawa kunci storage maupun sidik dokumen', async () => {
    if (!reachable) return;
    await semaiScan(AKU, 1);
    const [baris] = (await scans.historyFor(AKU)).data;

    for (const bocor of ['document_key', 'report_key', 'document_sha256', 'hold_ledger_id']) {
      expect(baris, `${bocor} ikut terkirim`).not.toHaveProperty(bocor);
    }
    // `cached_from` menunjuk scan MILIK SIAPA PUN yang dokumennya identik.
    expect(baris).not.toHaveProperty('cached_from');
    expect(baris).toHaveProperty('from_cache', false);
  });

  it('review yang kuterima tidak menyebut siapa penilainya', async () => {
    if (!reachable) return;
    await semaiReview(AKU, 1);
    const [baris] = (await reviews.receivedBy(AKU)).data;

    expect(baris, 'identitas reviewer bocor — kolusi antar-teman').not.toHaveProperty(
      'reviewer_id',
    );
    expect(JSON.stringify(baris)).not.toContain(LAIN);
  });

  it('status order tidak membawa idempotency_key maupun ref vendor', async () => {
    if (!reachable) return;
    const id = await semaiOrder(AKU);
    const o = await orders.byId(AKU, id);

    // Kunci idempotensi yang bocor membuat request orang lain dianggap
    // pengulangan request ini.
    expect(o).not.toHaveProperty('idempotency_key');
    expect(o).not.toHaveProperty('provider_ref');
    expect(o).toMatchObject({ coins: 1000, amount_idr: 25000, status: 'pending' });
  });

  it('riwayat mastery tidak membawa `turns`', async () => {
    if (!reachable) return;
    await semaiMastery(AKU, 1);
    const [baris] = (await mastery.historyFor(AKU)).data;
    expect(baris).not.toHaveProperty('turns');
    expect(baris).toMatchObject({ kind: 'interview', feedback: null });
  });

  it('URL PDF ditandatangani SETELAH kepemilikan terbukti, tidak pernah sebelum', async () => {
    if (!reachable) return;
    const punyaOrangLain = await semaiCv(LAIN);

    await expect(karir.cvById(AKU, punyaOrangLain)).rejects.toBeInstanceOf(NotFoundException);
    // URL bertanda tangan berlaku 15 menit — menandatanganinya dulu lalu
    // menjawab 404 tetap menyerahkan berkasnya kalau URL-nya pernah terekam.
    expect(storage.signed, 'berkas orang lain ikut ditandatangani').toEqual([]);

    const punyaku = await semaiCv(AKU);
    const cv = await karir.cvById(AKU, punyaku);
    expect(cv.pdf_url).toContain('sig=');
    expect(storage.signed).toHaveLength(1);
  });

  it('CV tanpa PDF menjawab `pdf_url: null`, bukan URL yang menunjuk ke ketiadaan', async () => {
    if (!reachable) return;
    const r = await db
      .insertInto('cv_documents')
      .values({ user_id: AKU, structured: JSON.stringify({}) })
      .returning('id')
      .executeTakeFirstOrThrow();

    expect((await karir.cvById(AKU, r.id)).pdf_url).toBeNull();
    expect(storage.signed).toEqual([]);
  });
});
