import { Kysely, sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase, type DB } from '../src/infra/kysely';
import { GradingService } from '../src/modules/learning';

/**
 * Test integrasi GradingService terhadap DATABASE NYATA (L-02).
 *
 * Yang dibuktikan di sini bukan formula skornya (itu unit test di
 * `grading.service.spec.ts`), tapi JALUR yang akan dipakai L-03:
 * kartu diambil dari `lesson_cards` BESERTA kunci jawabannya di dalam
 * transaksi pemanggil, lalu dinilai. `gradeAttempt` murni + jalur DB yang
 * benar = tidak ada tempat skor client masuk.
 *
 * Tanpa database lokal, seluruh kasus dilompati (pola `reachable` dari
 * `content.integration.spec.ts`); CI `migrasi kering` menjalankannya
 * sungguhan.
 */

const URL_DEV = 'postgres://strive:strive_dev_only@localhost:55432/strive';
const url = process.env['DATABASE_URL_TEST'] ?? process.env['DATABASE_URL'] ?? URL_DEV;

let db: Kysely<DB>;
let grading: GradingService;
let reachable = false;

const TRACK = '00000000-0000-4000-8000-00000000aa01';
const MODUL = '00000000-0000-4000-8000-00000000bb01';
const LESSON = '00000000-0000-4000-8000-00000000cc01';
const KARTU_MC = '00000000-0000-4000-8000-00000000dd01';
const KARTU_SWIPE = '00000000-0000-4000-8000-00000000dd02';

beforeAll(async () => {
  db = createDatabase(url);
  grading = new GradingService();
  try {
    await db.selectFrom('tracks').select('id').limit(1).execute();
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
  await sql`TRUNCATE lesson_attempts, lesson_cards, lessons, modules, tracks RESTART IDENTITY CASCADE`.execute(
    db,
  );

  await db
    .insertInto('tracks')
    .values({
      id: TRACK,
      slug: 'grading-uji',
      title: 'Uji Grading',
      is_published: true,
      sort_order: 1,
    })
    .execute();
  await db
    .insertInto('modules')
    .values({ id: MODUL, track_id: TRACK, title: 'Modul uji', sort_order: 1 })
    .execute();
  await db
    .insertInto('lessons')
    .values({
      id: LESSON,
      module_id: MODUL,
      title: 'Lesson uji grading',
      est_seconds: 150,
      base_points: 10,
      base_coins: 20,
      sort_order: 1,
    })
    .execute();
  await db
    .insertInto('lesson_cards')
    .values([
      {
        id: KARTU_MC,
        lesson_id: LESSON,
        kind: 'multiple_choice',
        prompt: 'Mana yang benar?',
        sort_order: 1,
        content: JSON.stringify({
          options: [
            { id: 'opt_a', text: 'A', correct: true, why: 'sebab A' },
            { id: 'opt_b', text: 'B', correct: false, why: 'sebab B' },
          ],
        }),
      },
      {
        id: KARTU_SWIPE,
        lesson_id: LESSON,
        kind: 'swipe_binary',
        prompt: 'Pernyataan ini salah',
        sort_order: 2,
        content: JSON.stringify({
          options: [
            { id: 'true', text: 'Benar', correct: false, why: 'sebab true' },
            { id: 'false', text: 'Salah', correct: true, why: 'sebab false' },
          ],
        }),
      },
    ])
    .execute();
});

describe('GradingService.grade — jalur DB (integrasi)', () => {
  it('mengambil kartu beserta kunci lalu menilai dalam transaksi pemanggil', async () => {
    if (!reachable) return;
    const hasil = await db.transaction().execute(async (trx) =>
      grading.grade(trx, LESSON, [
        { card_id: KARTU_MC, answer: 'opt_a', ms: 5000 },
        { card_id: KARTU_SWIPE, answer: false, ms: 4000 },
      ]),
    );
    expect(hasil.score).toBe(100);
    expect(hasil.feedback).toEqual([
      { card_id: KARTU_MC, correct: true, why: 'sebab A' },
      { card_id: KARTU_SWIPE, correct: true, why: 'sebab false' },
    ]);
  });

  it('cardId asing ditolak 422 CARD_NOT_IN_LESSON', async () => {
    if (!reachable) return;
    const asing = '00000000-0000-4000-8000-00000000ffff';
    await expect(
      db
        .transaction()
        .execute((trx) =>
          grading.grade(trx, LESSON, [{ card_id: asing, answer: 'opt_a', ms: 1000 }]),
        ),
    ).rejects.toThrowError(
      expect.objectContaining({
        response: expect.objectContaining({
          error: expect.objectContaining({ code: 'CARD_NOT_IN_LESSON' }),
        }),
      }),
    );
  });

  it('jawaban acak dari database sungguhan → skor 0, bukan error', async () => {
    if (!reachable) return;
    const hasil = await db.transaction().execute((trx) =>
      grading.grade(trx, LESSON, [
        { card_id: KARTU_MC, answer: 'opt_b', ms: 3000 },
        { card_id: KARTU_SWIPE, answer: true, ms: 3000 },
      ]),
    );
    expect(hasil.score).toBe(0);
    expect(hasil.feedback.every((f) => !f.correct)).toBe(true);
  });

  it('jawaban kosong → semua kartu dinilai salah, skor 0', async () => {
    if (!reachable) return;
    // Skema F-08 menolak array kosong di HTTP (min(1)); ini menguji lapis
    // service yang dipanggil langsung — defensif tanpa error.
    const hasil = await db.transaction().execute((trx) => grading.grade(trx, LESSON, []));
    expect(hasil.score).toBe(0);
    expect(hasil.feedback).toHaveLength(2);
  });
});
