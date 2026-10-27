import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase, type DB } from '../src/infra/kysely';
import { MentorService } from '../src/modules/mentor';
import { CoinLedgerService } from '../src/modules/wallet';

/**
 * `PR-04` (Dev B) terhadap DATABASE NYATA — PRD §7 E11 `PR-6`/`PR-7`.
 *
 * Dua AC-nya:
 *   AC-PR-3 "mentor hanya melihat squad binaannya" (kepemilikan di SERVICE,
 *            PRD §2.5 — guard tidak bisa menjawab ini)
 *   AC-PR-4 "menyetujui review memicu entri koin untuk reviewer TEPAT SEKALI"
 *
 * Tepat sekali dijaga TIGA lapis dan ketiganya diukur di sini:
 *   1. `mentor_checked` dicek ulang SETELAH `FOR UPDATE` (race dua mentor)
 *   2. `coin_ledger_ref_uniq (user_id, ref_type, ref_id, entry_type)` —
 *      index partial unik migrasi 010 (cara Kedua penulis → PG menolak)
 *   3. `CoinLedgerService.write()` sendiri memeriksa `findExisting` dulu
 *
 * Yang TIDAK diuji di sini: lomba dua request bersamaan pada baris yang sama —
 * itu dijaga index database dan sudah diuji `coin-ledger.integration.spec.ts`
 * (Dev A). Di sini cukup sekuensial: panggil dua kali, ledger tetap satu baris.
 */

const URL_DEV = 'postgres://strive:strive_dev_only@localhost:55432/strive';
const url = process.env['DATABASE_URL_TEST'] ?? process.env['DATABASE_URL'] ?? URL_DEV;

let db: Kysely<DB>;
let mentor: MentorService;
let reachable = false;

const SEASON = '00000000-0000-4000-8000-0mt000000001'.replace('mt', 'ab');
const SQUAD_A = '00000000-0000-4000-8000-0mt000000002'.replace('mt', 'ab');
const SQUAD_B = '00000000-0000-4000-8000-0mt000000003'.replace('mt', 'ab');
const TRACK = '00000000-0000-4000-8000-0mt000000004'.replace('mt', 'ab');
const MODUL = '00000000-0000-4000-8000-0mt000000005'.replace('mt', 'ab');
const LESSON = '00000000-0000-4000-8000-0mt000000006'.replace('mt', 'ab');
const LESSON2 = '00000000-0000-4000-8000-0mt000000007'.replace('mt', 'ab');

const MENTORKU = '00000000-0000-4000-8000-0mt000000011'.replace('mt', 'ab');
const MENTOR_LAIN = '00000000-0000-4000-8000-0mt000000012'.replace('mt', 'ab');
const REVIEWER_A = '00000000-0000-4000-8000-0mt000000013'.replace('mt', 'ab');
const REVIEWER_B = '00000000-0000-4000-8000-0mt000000014'.replace('mt', 'ab');
const PENULIS = '00000000-0000-4000-8000-0mt000000015'.replace('mt', 'ab');

const RUBRIK = { kejelasan: 5, ketepatan: 4, kelengkapan: 3, sitasi: 4 }; // total 16

let attempt1: string;
let attempt2: string;
let reviewA: string; // reviewer A, berpoin (6 poin)
let reviewB: string; // reviewer B (squad mentor lain), berpoin
let reviewCapped: string; // reviewer A, weighted_points = 0 (cap PR-4)

async function buatAttempt(lessonId: string): Promise<string> {
  const baris = await db
    .insertInto('lesson_attempts')
    .values({
      user_id: PENULIS,
      lesson_id: lessonId,
      attempt_date: sql`(now() AT TIME ZONE 'Asia/Jakarta')::date`,
      card_results: sql`'[]'::jsonb`,
      score: 80,
      points: 16,
      coins: 15,
      duration_ms: 60000,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return baris.id;
}

/** attempt_date DARI BARIS attempt, bukan dibentuk di Node (aturan keras 5). */
async function attemptDateDari(attemptId: string): Promise<string> {
  const baris = await db
    .selectFrom('lesson_attempts')
    .select('attempt_date')
    .where('id', '=', attemptId)
    .executeTakeFirstOrThrow();
  return baris.attempt_date;
}

async function buatReview(
  reviewerId: string,
  attemptId: string,
  attemptDate: string,
  weightedPoints: number,
): Promise<string> {
  const baris = await db
    .insertInto('peer_reviews')
    .values({
      attempt_id: attemptId,
      attempt_date: attemptDate,
      reviewer_id: reviewerId,
      author_id: PENULIS,
      rubric_scores: sql`${JSON.stringify(RUBRIK)}::jsonb`,
      comment: 'komentar reviewer',
      weighted_points: weightedPoints,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return baris.id;
}

async function hitungLedger(userId: string): Promise<number> {
  const r = await db
    .selectFrom('coin_ledger')
    .select((eb) => eb.fn.countAll<string>().as('n'))
    .where('user_id', '=', userId)
    .executeTakeFirstOrThrow();
  return Number(r.n);
}

async function saldo(userId: string): Promise<number> {
  const r = await db
    .selectFrom('users')
    .select('coin_balance')
    .where('id', '=', userId)
    .executeTakeFirstOrThrow();
  return r.coin_balance;
}

beforeAll(async () => {
  db = createDatabase(url);
  mentor = new MentorService(db, new CoinLedgerService());
  try {
    await db.selectFrom('peer_reviews').select('id').limit(1).execute();
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
  await sql`TRUNCATE users, tracks, league_seasons, squads RESTART IDENTITY CASCADE`.execute(db);

  await db
    .insertInto('users')
    .values([
      { id: MENTORKU, email: 'mt-mentor@uji.test', display_name: 'Mentor Ku', role: 'mentor' },
      { id: MENTOR_LAIN, email: 'mt-lain@uji.test', display_name: 'Mentor Lain', role: 'mentor' },
      { id: REVIEWER_A, email: 'mt-reva@uji.test', display_name: 'Reviewer A' },
      { id: REVIEWER_B, email: 'mt-revb@uji.test', display_name: 'Reviewer B' },
      { id: PENULIS, email: 'mt-penulis@uji.test', display_name: 'Penulis' },
    ])
    .execute();

  await db
    .insertInto('league_seasons')
    .values({
      id: SEASON,
      code: '2026-M04',
      starts_at: sql`now()`,
      ends_at: sql`now() + interval '7 days'`,
    })
    .execute();

  await db
    .insertInto('squads')
    .values([
      { id: SQUAD_A, name: 'Binaan Ku', season_id: SEASON, mentor_id: MENTORKU, max_members: 8 },
      {
        id: SQUAD_B,
        name: 'Binaan Lain',
        season_id: SEASON,
        mentor_id: MENTOR_LAIN,
        max_members: 8,
      },
    ])
    .execute();

  await db
    .insertInto('squad_members')
    .values([
      { squad_id: SQUAD_A, user_id: REVIEWER_A },
      { squad_id: SQUAD_B, user_id: REVIEWER_B },
      { squad_id: SQUAD_B, user_id: PENULIS },
    ])
    .execute();

  await db.insertInto('tracks').values({ id: TRACK, slug: 'mt', title: 'Track MT' }).execute();
  await db
    .insertInto('modules')
    .values({ id: MODUL, track_id: TRACK, title: 'Modul MT' })
    .execute();
  await db
    .insertInto('lessons')
    .values([
      { id: LESSON, module_id: MODUL, title: 'Lesson Mentor' },
      // Lesson kedua: unique (user_id, lesson_id, attempt_date) menolak dua
      // attempt PENULIS pada lesson yang sama di hari yang sama.
      { id: LESSON2, module_id: MODUL, title: 'Lesson Mentor Dua' },
    ])
    .execute();

  attempt1 = await buatAttempt(LESSON);
  attempt2 = await buatAttempt(LESSON2);

  // attempt_date SELALU dibaca dari baris attempt — FK (migrasi 003) butuh
  // pasangan (id, attempt_date) yang sama, dan tanggal lokal tidak boleh
  // dibentuk di Node (aturan keras 5).
  reviewA = await buatReview(REVIEWER_A, attempt1, await attemptDateDari(attempt1), 6);
  reviewB = await buatReview(REVIEWER_B, attempt1, await attemptDateDari(attempt1), 6);
  reviewCapped = await buatReview(REVIEWER_A, attempt2, await attemptDateDari(attempt2), 0);
});

describe('PR-04 konsol mentor — validasi review (PR-6, PR-7)', () => {
  it('database terjangkau — tanpa ini seluruh berkas lulus hampa', async () => {
    expect(reachable).toBe(true);
  });

  it('antrean memuat review ANGGOTA BINAAN saja (PR-7, kepemilikan di service)', async () => {
    const q = await mentor.queueFor(MENTORKU);
    const id = q.map((x) => x.id);
    expect(id).toContain(reviewA);
    expect(id).toContain(reviewCapped);
    expect(id).not.toContain(reviewB);

    const qLain = await mentor.queueFor(MENTOR_LAIN);
    expect(qLain.map((x) => x.id)).toContain(reviewB);
    expect(qLain.map((x) => x.id)).not.toContain(reviewA);
  });

  it('antrean tidak memuat identitas PENULIS di mana pun (semangat PR-2 di konsol)', async () => {
    const q = await mentor.queueFor(MENTORKU);
    // Bukan satu field: seluruh respons. Test "author_id === undefined" lolos
    // meski identitas bocor lewat field lain — pola yang sama dengan
    // review.integration.spec.ts.
    expect(JSON.stringify(q)).not.toContain(PENULIS);
    expect(JSON.stringify(q)).not.toContain('Penulis');
    // Yang dilihat mentor justru anggotanya sendiri si reviewer.
    expect(JSON.stringify(q)).toContain('Reviewer A');
    expect(q[0]!.lesson_title).toBe('Lesson Mentor');
  });

  it('review yang sudah divalidasi keluar dari antrean', async () => {
    await mentor.validate({ mentorId: MENTORKU, reviewId: reviewA, decision: 'approve' });
    const q = await mentor.queueFor(MENTORKU);
    expect(q.map((x) => x.id)).not.toContain(reviewA);
    expect(q.map((x) => x.id)).toContain(reviewCapped);
  });

  it('approve menulis entri earn_review +15 TEPAT SEKALI, saldo ikut, audit tercatat (AC-PR-4)', async () => {
    expect(await saldo(REVIEWER_A)).toBe(0);

    const hasil = await mentor.validate({
      mentorId: MENTORKU,
      reviewId: reviewA,
      decision: 'approve',
      note: 'penilaian rapi',
    });

    expect(hasil).toMatchObject({
      review_id: reviewA,
      decision: 'approve',
      awarded: true,
      coins: 15,
      already_validated: false,
    });

    // Ledger: SATU baris, bentuknya persis kontrak CoinLedgerService.
    const baris = await db
      .selectFrom('coin_ledger')
      .select(['entry_type', 'amount', 'ref_type', 'ref_id', 'user_id'])
      .where('user_id', '=', REVIEWER_A)
      .execute();
    expect(baris).toHaveLength(1);
    expect(baris[0]!).toMatchObject({
      entry_type: 'earn_review',
      amount: 15,
      ref_type: 'review',
      ref_id: reviewA,
    });
    expect(await saldo(REVIEWER_A)).toBe(15);

    // mentor_checked tertutup.
    const pr = await db
      .selectFrom('peer_reviews')
      .select('mentor_checked')
      .where('id', '=', reviewA)
      .executeTakeFirstOrThrow();
    expect(pr.mentor_checked).toBe(true);

    // audit_log — preseden user-role.service: before/after JSON.stringify.
    const audit = await db
      .selectFrom('audit_log')
      .select(['actor_id', 'action', 'subject_type', 'subject_id', 'before', 'after'])
      .where('subject_id', '=', reviewA)
      .execute();
    expect(audit).toHaveLength(1);
    expect(audit[0]!.actor_id).toBe(MENTORKU);
    expect(audit[0]!.action).toBe('mentor.review.validate');
    expect(audit[0]!.subject_type).toBe('review');
    expect(JSON.stringify(audit[0]!.after)).toContain('approve');
  });

  it('approve KEDUA kalinya idempoten: tak melempar, ledger tetap satu, saldo tetap', async () => {
    await mentor.validate({ mentorId: MENTORKU, reviewId: reviewA, decision: 'approve' });
    const kedua = await mentor.validate({
      mentorId: MENTORKU,
      reviewId: reviewA,
      decision: 'approve',
    });

    expect(kedua.already_validated).toBe(true);
    expect(kedua.awarded).toBe(false);
    expect(await hitungLedger(REVIEWER_A)).toBe(1);
    expect(await saldo(REVIEWER_A)).toBe(15);
  });

  it('keputusan FINAL: reject setelah approve tidak mencabut koin dan tidak menulis baru', async () => {
    await mentor.validate({ mentorId: MENTORKU, reviewId: reviewA, decision: 'approve' });
    const ubah = await mentor.validate({
      mentorId: MENTORKU,
      reviewId: reviewA,
      decision: 'reject',
      note: 'berubah pikiran',
    });

    expect(ubah.already_validated).toBe(true);
    expect(await hitungLedger(REVIEWER_A)).toBe(1);
    expect(await saldo(REVIEWER_A)).toBe(15);
  });

  it('approve review CAPPED (weighted_points 0): mentor_checked tanpa entri koin', async () => {
    // §6: "Maks 5 review BERPOIN/hari" — review ke-6 sudah tidak berpoin di
    // titik submit (PR-4 dijalankan reviewer). Validasi mentor menutupnya
    // tanpa mencetak koin ke-6.
    const hasil = await mentor.validate({
      mentorId: MENTORKU,
      reviewId: reviewCapped,
      decision: 'approve',
    });

    expect(hasil).toMatchObject({ awarded: false, coins: 0, already_validated: false });
    expect(await hitungLedger(REVIEWER_A)).toBe(0);

    const pr = await db
      .selectFrom('peer_reviews')
      .select('mentor_checked')
      .where('id', '=', reviewCapped)
      .executeTakeFirstOrThrow();
    expect(pr.mentor_checked).toBe(true);
  });

  it('reject dengan catatan: mentor_checked tanpa koin, catatan masuk audit', async () => {
    const hasil = await mentor.validate({
      mentorId: MENTORKU,
      reviewId: reviewA,
      decision: 'reject',
      note: 'skor sitasi tidak sesuai jawaban',
    });

    expect(hasil).toMatchObject({ decision: 'reject', awarded: false, coins: 0 });
    expect(await hitungLedger(REVIEWER_A)).toBe(0);

    const audit = await db
      .selectFrom('audit_log')
      .select('after')
      .where('subject_id', '=', reviewA)
      .executeTakeFirstOrThrow();
    expect(JSON.stringify(audit.after)).toContain('skor sitasi');
    expect(JSON.stringify(audit.after)).toContain('"decision":"reject"');
  });

  it('reject TANPA catatan ditolak dan tidak mengubah apa pun', async () => {
    // Kode galat = kontrak (§10.2): diperiksa dari getResponse, bukan dari
    // message exception yang memang "Bad Request Exception".
    let badan: unknown;
    try {
      await mentor.validate({ mentorId: MENTORKU, reviewId: reviewA, decision: 'reject' });
      expect.unreachable('reject tanpa catatan harus melempar');
    } catch (e) {
      badan = (e as BadRequestException).getResponse();
    }
    expect(JSON.stringify(badan)).toContain('VALIDATION_ERROR');

    const pr = await db
      .selectFrom('peer_reviews')
      .select('mentor_checked')
      .where('id', '=', reviewA)
      .executeTakeFirstOrThrow();
    expect(pr.mentor_checked).toBe(false);
    expect(await hitungLedger(REVIEWER_A)).toBe(0);
  });

  it('mentor ASING terhadap review bukan binaannya → FORBIDDEN_ROLE (PR-7)', async () => {
    await expect(
      mentor.validate({ mentorId: MENTOR_LAIN, reviewId: reviewA, decision: 'approve' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(await hitungLedger(REVIEWER_A)).toBe(0);

    const pr = await db
      .selectFrom('peer_reviews')
      .select('mentor_checked')
      .where('id', '=', reviewA)
      .executeTakeFirstOrThrow();
    expect(pr.mentor_checked).toBe(false);
  });

  it('mentor tidak bisa memvalidasi review yang dia tulis SENDIRI (self-award, temuan audit PR-04)', async () => {
    // Mentor sah saja menjadi ANGGOTA squad (eligibleUsers tidak memfilter
    // peran saat formSquads), jadi keadaan ini bisa lahir: dia reviewer atas
    // attempt di squadnya, sekaligus mentor squad itu. Tanpa penjaga, approve
    // mencetak 15 koin ke sakunya sendiri.
    await db.insertInto('squad_members').values({ squad_id: SQUAD_A, user_id: MENTORKU }).execute();
    const reviewSendiri = await buatReview(MENTORKU, attempt1, await attemptDateDari(attempt1), 6);

    await expect(
      mentor.validate({ mentorId: MENTORKU, reviewId: reviewSendiri, decision: 'approve' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(await hitungLedger(MENTORKU)).toBe(0);

    const pr = await db
      .selectFrom('peer_reviews')
      .select('mentor_checked')
      .where('id', '=', reviewSendiri)
      .executeTakeFirstOrThrow();
    expect(pr.mentor_checked).toBe(false);
  });

  it('review yang tidak ada → NOT_FOUND, bukan 500 (kolom uuid menolak id karangan)', async () => {
    const idKarangan = '11111111-1111-4111-8111-111111111111';
    await expect(
      mentor.validate({ mentorId: MENTORKU, reviewId: idKarangan, decision: 'approve' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('reviewer yang sudah KELUAR dari squad binaan: keluar dari antrean dan tak bisa divalidasi', async () => {
    await db
      .updateTable('squad_members')
      .set({ left_at: sql`now()` })
      .where('squad_id', '=', SQUAD_A)
      .where('user_id', '=', REVIEWER_A)
      .execute();

    const q = await mentor.queueFor(MENTORKU);
    expect(q.map((x) => x.id)).not.toContain(reviewA);

    await expect(
      mentor.validate({ mentorId: MENTORKU, reviewId: reviewA, decision: 'approve' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(await hitungLedger(REVIEWER_A)).toBe(0);
  });
});
