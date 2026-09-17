import { ForbiddenException } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase, type DB } from '../src/infra/kysely';
import { ReviewService } from '../src/modules/review';

/**
 * `PR-01` terhadap DATABASE NYATA.
 *
 * Dua AC-nya keduanya soal BATAS YANG TIDAK BOLEH TEMBUS:
 *   PR-1 reviewer tidak pernah dari squad yang sama dengan penulis
 *   PR-2 reviewer tidak bisa melihat identitas penulis di respons API MANA PUN
 *
 * Yang kedua diuji dengan cara yang tidak biasa: bukan memeriksa satu field,
 * tapi memeriksa **seluruh isi respons** tidak memuat id penulis di mana pun.
 * Test yang hanya memeriksa `author_id === undefined` akan lolos meski
 * identitasnya bocor lewat field lain.
 */

const URL_DEV = 'postgres://strive:strive_dev_only@localhost:55432/strive';
const url = process.env['DATABASE_URL_TEST'] ?? process.env['DATABASE_URL'] ?? URL_DEV;

let db: Kysely<DB>;
let reviews: ReviewService;
let reachable = false;

const SEASON = '00000000-0000-4000-8000-0000000pr001'.replace(/pr/, 'ab');
const SQUAD_A = '00000000-0000-4000-8000-0000000pr002'.replace(/pr/, 'ab');
const SQUAD_B = '00000000-0000-4000-8000-0000000pr003'.replace(/pr/, 'ab');
const TRACK = '00000000-0000-4000-8000-0000000pr004'.replace(/pr/, 'ab');
const MODUL = '00000000-0000-4000-8000-0000000pr005'.replace(/pr/, 'ab');
const LESSON = '00000000-0000-4000-8000-0000000pr006'.replace(/pr/, 'ab');

const PENULIS = '00000000-0000-4000-8000-0000000cd001'.replace(/cd/, 'ba');
const SESQUAD = '00000000-0000-4000-8000-0000000cd002'.replace(/cd/, 'ba');
const LAIN1 = '00000000-0000-4000-8000-0000000cd003'.replace(/cd/, 'ba');
const LAIN2 = '00000000-0000-4000-8000-0000000cd004'.replace(/cd/, 'ba');

let attemptId: string;

beforeAll(async () => {
  db = createDatabase(url);
  reviews = new ReviewService(db);
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
    .values(
      [PENULIS, SESQUAD, LAIN1, LAIN2].map((id, i) => ({
        id,
        email: `pr${i}@uji.test`,
        password_hash: 'x',
        display_name: `Orang ${i}`,
      })),
    )
    .execute();

  await db
    .insertInto('league_seasons')
    .values({
      id: SEASON,
      code: '2026-W43',
      starts_at: sql`now()`,
      ends_at: sql`now() + interval '7 days'`,
    })
    .execute();
  await db
    .insertInto('squads')
    .values([
      { id: SQUAD_A, name: 'A', season_id: SEASON, max_members: 8 },
      { id: SQUAD_B, name: 'B', season_id: SEASON, max_members: 8 },
    ])
    .execute();
  await db
    .insertInto('squad_members')
    .values([
      { squad_id: SQUAD_A, user_id: PENULIS },
      { squad_id: SQUAD_A, user_id: SESQUAD },
      { squad_id: SQUAD_B, user_id: LAIN1 },
      { squad_id: SQUAD_B, user_id: LAIN2 },
    ])
    .execute();

  await db.insertInto('tracks').values({ id: TRACK, slug: 'pr', title: 'T' }).execute();
  await db.insertInto('modules').values({ id: MODUL, track_id: TRACK, title: 'M' }).execute();
  await db
    .insertInto('lessons')
    .values({ id: LESSON, module_id: MODUL, title: 'Lesson PR' })
    .execute();

  const a = await db
    .insertInto('lesson_attempts')
    .values({
      user_id: PENULIS,
      lesson_id: LESSON,
      attempt_date: sql`(now() AT TIME ZONE 'Asia/Jakarta')::date`,
      card_results: JSON.stringify([{ card: 1, answer: 'b' }]),
      score: 80,
      points: 8,
      coins: 2,
      duration_ms: 1000,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  attemptId = a.id;
});

const nilai = { kejelasan: 4, ketepatan: 5 };

describe('ReviewService (database nyata)', () => {
  it('database siap dipakai', () => {
    expect(reachable, `DATABASE_URL tidak bisa dipakai (${url})`).toBe(true);
  });

  // ── PR-1 ────────────────────────────────────────────────────────────────
  it('PR-1: attempt TIDAK muncul di antrean anggota squad yang sama', async () => {
    if (!reachable) return;
    const antreanSeSquad = await reviews.queueFor(SESQUAD);
    const antreanLain = await reviews.queueFor(LAIN1);

    expect(antreanSeSquad.map((x) => x.attempt_id)).not.toContain(attemptId);
    expect(antreanLain.map((x) => x.attempt_id)).toContain(attemptId);
  });

  it('PR-1: menembus antrean pun ditolak di jalur TULIS', async () => {
    if (!reachable) return;
    // Antrean adalah tampilan; ia bisa basi, dan klien bisa mengirim
    // attempt_id apa pun. Yang menentukan adalah pemeriksaan saat menulis.
    await expect(
      reviews.submit({ reviewerId: SESQUAD, attemptId, rubricScores: nilai }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(await db.selectFrom('peer_reviews').selectAll().execute()).toHaveLength(0);
  });

  // ── PR-2 ────────────────────────────────────────────────────────────────
  it('PR-2: identitas penulis tidak ada DI MANA PUN dalam respons antrean', async () => {
    if (!reachable) return;
    const antrean = await reviews.queueFor(LAIN1);
    const item = antrean.find((x) => x.attempt_id === attemptId);
    expect(item).toBeDefined();

    // Bukan memeriksa satu field. Seluruh isi respons diperiksa: id penulis
    // tidak boleh muncul di mana pun, lewat field mana pun, termasuk yang
    // belum ada saat test ini ditulis.
    const utuh = JSON.stringify(item);
    expect(utuh, 'id penulis bocor ke antrean review').not.toContain(PENULIS);
    expect(utuh).not.toContain('Orang 0');
    expect(Object.keys(item!)).not.toContain('author_id');
  });

  // ── PR-3 ────────────────────────────────────────────────────────────────
  it('PR-3: menilai karya sendiri ditolak service', async () => {
    if (!reachable) return;
    await expect(
      reviews.submit({ reviewerId: PENULIS, attemptId, rubricScores: nilai }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('PR-3: dijamin CHECK no_self_review juga, bukan cuma service', async () => {
    if (!reachable) return;
    await expect(
      db
        .insertInto('peer_reviews')
        .values({
          attempt_id: attemptId,
          attempt_date: sql`(now() AT TIME ZONE 'Asia/Jakarta')::date`,
          reviewer_id: PENULIS,
          author_id: PENULIS,
          rubric_scores: JSON.stringify(nilai),
        })
        .execute(),
    ).rejects.toThrow(/no_self_review/);
  });

  // ── alur normal & batas ─────────────────────────────────────────────────
  it('dua reviewer lintas squad bisa menilai, yang ketiga ditolak (PR-1)', async () => {
    if (!reachable) return;
    await reviews.submit({ reviewerId: LAIN1, attemptId, rubricScores: nilai });
    await reviews.submit({ reviewerId: LAIN2, attemptId, rubricScores: nilai });

    const rows = await db.selectFrom('peer_reviews').selectAll().execute();
    expect(rows).toHaveLength(2);
    // author_id TETAP disimpan di database — ia dibutuhkan untuk menghitung
    // poin. Yang dilarang PR-2 adalah mengirimkannya ke reviewer.
    expect(rows.every((r) => r.author_id === PENULIS)).toBe(true);

    // Reviewer ketiga: attempt sudah penuh.
    const LAIN3 = '00000000-0000-4000-8000-0000000ba005';
    await db
      .insertInto('users')
      .values({ id: LAIN3, email: 'pr9@uji.test', password_hash: 'x', display_name: 'O9' })
      .execute();
    await expect(
      reviews.submit({ reviewerId: LAIN3, attemptId, rubricScores: nilai }),
    ).rejects.toBeTruthy();
  });

  it('attempt yang sudah penuh hilang dari antrean', async () => {
    if (!reachable) return;
    await reviews.submit({ reviewerId: LAIN1, attemptId, rubricScores: nilai });
    await reviews.submit({ reviewerId: LAIN2, attemptId, rubricScores: nilai });

    const LAIN3 = '00000000-0000-4000-8000-0000000ba006';
    await db
      .insertInto('users')
      .values({ id: LAIN3, email: 'pr8@uji.test', password_hash: 'x', display_name: 'O8' })
      .execute();
    expect((await reviews.queueFor(LAIN3)).map((x) => x.attempt_id)).not.toContain(attemptId);
  });

  it('reviewer yang sudah menilai tidak melihatnya lagi di antrean', async () => {
    if (!reachable) return;
    await reviews.submit({ reviewerId: LAIN1, attemptId, rubricScores: nilai });
    expect((await reviews.queueFor(LAIN1)).map((x) => x.attempt_id)).not.toContain(attemptId);
    // Tapi reviewer kedua masih melihatnya — baru satu dari dua.
    expect((await reviews.queueFor(LAIN2)).map((x) => x.attempt_id)).toContain(attemptId);
  });

  it('review menyimpan attempt_date dari BARIS attempt, bukan dari jam Node', async () => {
    if (!reachable) return;
    await reviews.submit({ reviewerId: LAIN1, attemptId, rubricScores: nilai });

    const cocok = await sql<{ sama: boolean }>`
      SELECT (pr.attempt_date = a.attempt_date) AS sama
      FROM peer_reviews pr JOIN lesson_attempts a ON a.id = pr.attempt_id
      WHERE pr.attempt_id = ${attemptId}
    `.execute(db);
    // Kalau tanggalnya dibentuk di Node, ia akan meleset untuk pengguna yang
    // zona waktunya berbeda — dan FK majemuk (isu #15) akan menolaknya dengan
    // pesan yang tidak menunjuk ke sebabnya.
    expect(cocok.rows[0]?.sama).toBe(true);
  });
});
