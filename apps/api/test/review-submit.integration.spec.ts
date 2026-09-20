import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase, type DB } from '../src/infra/kysely';
import { DAILY_SCORED_CAP, RUBRIC_MAX_SCORE, ReviewService } from '../src/modules/review';

/**
 * `PR-02` terhadap DATABASE NYATA.
 *
 * AC-nya dua kalimat, dan keduanya menolak dibuktikan dengan membaca kode:
 *
 *   "Menilai karya sendiri ditolak di service DAN di CHECK constraint"
 *   "Maksimal 5 review berpoin per hari per reviewer"
 *
 * Yang pertama butuh **menembus service** — kalau CHECK-nya hanya diuji lewat
 * service, yang terbukti cuma service-nya, dan komentar "lapis kedua ada di
 * CHECK" tetap jadi klaim.
 *
 * Yang kedua butuh zona waktu SUNGGUHAN. "Per hari" di repo ini berarti hari
 * lokal pengguna (aturan keras 5), dan implementasi yang memakai `::date`
 * atas UTC lulus setiap test yang berjalan di zona waktu server.
 */

const URL_DEV = 'postgres://strive:strive_dev_only@localhost:55432/strive';
const url = process.env['DATABASE_URL_TEST'] ?? process.env['DATABASE_URL'] ?? URL_DEV;

/** UTC+9, tanpa DST. Tengah malam lokalnya 15.00 UTC hari sebelumnya. */
const TZ_REVIEWER = 'Asia/Jayapura';

let db: Kysely<DB>;
let reviews: ReviewService;
let reachable = false;

const SEASON = '00000000-0000-4000-8000-0000000p2001'.replace(/p2/, 'ca');
const SQUAD_A = '00000000-0000-4000-8000-0000000p2002'.replace(/p2/, 'ca');
const SQUAD_B = '00000000-0000-4000-8000-0000000p2003'.replace(/p2/, 'ca');
const TRACK = '00000000-0000-4000-8000-0000000p2004'.replace(/p2/, 'ca');
const MODUL = '00000000-0000-4000-8000-0000000p2005'.replace(/p2/, 'ca');

const PENULIS = '00000000-0000-4000-8000-0000000p3001'.replace(/p3/, 'cb');
const REVIEWER = '00000000-0000-4000-8000-0000000p3002'.replace(/p3/, 'cb');

/** Satu lesson per attempt: UNIQUE (user_id, lesson_id, attempt_date). */
const LESSONS = Array.from({ length: 8 }, (_, i) =>
  `00000000-0000-4000-8000-0000000p4${String(i).padStart(3, '0')}`.replace(/p4/, 'cc'),
);
let attempts: string[] = [];

const nilai = { kejelasan: 4, ketepatan: 5 }; // total 9

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
    .values([
      {
        id: PENULIS,
        email: 'p2a@uji.test',
        password_hash: 'x',
        display_name: 'Penulis',
        timezone: 'Asia/Jakarta',
      },
      {
        id: REVIEWER,
        email: 'p2b@uji.test',
        password_hash: 'x',
        display_name: 'Reviewer',
        timezone: TZ_REVIEWER,
      },
    ])
    .execute();

  await db
    .insertInto('league_seasons')
    .values({
      id: SEASON,
      code: '2026-W99',
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
      { squad_id: SQUAD_B, user_id: REVIEWER },
    ])
    .execute();

  await db.insertInto('tracks').values({ id: TRACK, slug: 'p2', title: 'T' }).execute();
  await db.insertInto('modules').values({ id: MODUL, track_id: TRACK, title: 'M' }).execute();
  await db
    .insertInto('lessons')
    .values(LESSONS.map((id, i) => ({ id, module_id: MODUL, title: `Lesson ${i}` })))
    .execute();

  const r = await db
    .insertInto('lesson_attempts')
    .values(
      LESSONS.map((lesson) => ({
        user_id: PENULIS,
        lesson_id: lesson,
        attempt_date: sql<string>`(now() AT TIME ZONE 'Asia/Jakarta')::date`,
        card_results: JSON.stringify([{ card: 1, answer: 'b' }]),
        score: 80,
        points: 8,
        coins: 2,
        duration_ms: 1000,
      })),
    )
    .returning('id')
    .execute();
  attempts = r.rows?.map((x) => x.id) ?? r.map((x) => x.id);
});

/**
 * Menanam `n` review BERPOIN milik REVIEWER, dengan `created_at` relatif
 * terhadap TENGAH MALAM LOKAL reviewer.
 *
 * Offsetnya dihitung Postgres dari `users.timezone`, bukan dibentuk di Node:
 * kalau test ini membentuk tanggalnya sendiri, ia menguji aritmetika Node,
 * bukan aturan keras 5.
 */
async function tanamReviewBerpoin(n: number, offset: string) {
  for (let i = 0; i < n; i++) {
    await sql`
      INSERT INTO peer_reviews
        (attempt_id, attempt_date, reviewer_id, author_id, rubric_scores, weighted_points, created_at)
      SELECT ${attempts[i]}::uuid, a.attempt_date, ${REVIEWER}::uuid, ${PENULIS}::uuid,
             '{"x":1}'::jsonb, 9,
             (((now() AT TIME ZONE u.timezone)::date)::timestamp AT TIME ZONE u.timezone)
               + ${sql.raw(`interval '${offset}'`)}
      FROM lesson_attempts a, users u
      WHERE a.id = ${attempts[i]}::uuid AND u.id = ${REVIEWER}::uuid
    `.execute(db);
  }
}

describe('PR-02 — submit review, poin berbobot, cap harian (database nyata)', () => {
  it('database siap dipakai', () => {
    expect(reachable, `DATABASE_URL tidak bisa dipakai (${url})`).toBe(true);
  });

  // ── AC 1: self-review ditolak DI DUA LAPIS ──────────────────────────────

  it('AC: menilai karya sendiri ditolak di SERVICE', async () => {
    if (!reachable) return;
    await expect(
      reviews.submit({ reviewerId: PENULIS, attemptId: attempts[0]!, rubricScores: nilai }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('AC: menilai karya sendiri ditolak CHECK constraint kalau service DITEMBUS', async () => {
    if (!reachable) return;
    // Menembus service sepenuhnya — INSERT langsung, persis yang akan dilakukan
    // skrip perbaikan data, Retool, atau psql manual. Kalau hanya service yang
    // menjaganya, "dicek di service DAN di CHECK constraint" cuma separuh benar.
    await expect(
      sql`
        INSERT INTO peer_reviews
          (attempt_id, attempt_date, reviewer_id, author_id, rubric_scores, weighted_points)
        SELECT a.id, a.attempt_date, ${PENULIS}::uuid, ${PENULIS}::uuid, '{"x":1}'::jsonb, 9
        FROM lesson_attempts a WHERE a.id = ${attempts[0]}::uuid
      `.execute(db),
    ).rejects.toThrow(/no_self_review/);
  });

  // ── AC 2: cap harian ────────────────────────────────────────────────────

  it('AC-PR-3: review ke-6 TERSIMPAN, tapi weighted_points = 0', async () => {
    if (!reachable) return;
    await tanamReviewBerpoin(DAILY_SCORED_CAP, '1 second');

    const r = await reviews.submit({
      reviewerId: REVIEWER,
      attemptId: attempts[DAILY_SCORED_CAP]!,
      rubricScores: nilai,
    });

    // Bukan ditolak. Menolaknya menghukum reviewer yang rajin, dan penulis
    // yang karyanya kebetulan nomor 6 tidak pernah dapat review kedua.
    expect(r.capped).toBe(true);
    expect(r.weighted_points).toBe(0);

    const baris = await db
      .selectFrom('peer_reviews')
      .select(['id', 'weighted_points'])
      .where('id', '=', r.id)
      .executeTakeFirstOrThrow();
    expect(baris.weighted_points).toBe(0);
  });

  it('review ke-5 masih BERPOIN — capnya 5, bukan 4', async () => {
    if (!reachable) return;
    await tanamReviewBerpoin(DAILY_SCORED_CAP - 1, '1 second');

    const r = await reviews.submit({
      reviewerId: REVIEWER,
      attemptId: attempts[DAILY_SCORED_CAP - 1]!,
      rubricScores: nilai,
    });
    expect(r.capped).toBe(false);
    expect(r.weighted_points).toBe(9);
    expect(r.scored_today).toBe(DAILY_SCORED_CAP);
  });

  // ── ATURAN KERAS 5: batasnya tengah malam LOKAL, bukan UTC ──────────────

  it('tengah malam lokal reviewer BUKAN tengah malam UTC — prasyarat test di bawah', async () => {
    if (!reachable) return;
    // Kalau keduanya kebetulan sama, dua test berikutnya tidak membuktikan apa
    // pun. Dijadikan assert supaya kegagalannya menunjuk ke sini, bukan ke
    // logika cap yang sebenarnya benar.
    const r = await sql<{ beda: boolean }>`
      SELECT (((now() AT TIME ZONE ${TZ_REVIEWER})::date)::timestamp AT TIME ZONE ${TZ_REVIEWER})
             <> date_trunc('day', now()) AS beda
    `.execute(db);
    expect(r.rows[0]?.beda, `${TZ_REVIEWER} ternyata sejajar UTC — ganti zona waktunya`).toBe(true);
  });

  it('ATURAN 5: review TEPAT SEBELUM tengah malam lokal TIDAK dihitung', async () => {
    if (!reachable) return;
    // Satu detik sebelum tengah malam lokal reviewer = HARI KEMARIN baginya,
    // meski bisa jadi masih hari yang sama dalam UTC. Implementasi yang
    // memakai `created_at::date = current_date` akan menghitungnya, lalu
    // meng-cap reviewer ini secara salah.
    await tanamReviewBerpoin(DAILY_SCORED_CAP, '-1 second');

    const r = await reviews.submit({
      reviewerId: REVIEWER,
      attemptId: attempts[DAILY_SCORED_CAP]!,
      rubricScores: nilai,
    });
    expect(r.capped, 'review kemarin (lokal) ikut dihitung — cap memakai UTC').toBe(false);
    expect(r.weighted_points).toBe(9);
    expect(r.scored_today).toBe(1);
  });

  it('ATURAN 5: review TEPAT SESUDAH tengah malam lokal dihitung', async () => {
    if (!reachable) return;
    await tanamReviewBerpoin(DAILY_SCORED_CAP, '1 second');
    const r = await reviews.submit({
      reviewerId: REVIEWER,
      attemptId: attempts[DAILY_SCORED_CAP]!,
      rubricScores: nilai,
    });
    expect(r.capped).toBe(true);
  });

  it('review TIDAK berpoin tidak ikut memakan cap', async () => {
    if (!reachable) return;
    // Yang dibatasi "5 review BERPOIN", bukan 5 review. Kalau yang ke-6 (poin 0)
    // ikut dihitung, reviewer yang menembus cap hari ini akan tetap ter-cap
    // besok tanpa sebab.
    await tanamReviewBerpoin(2, '1 second');
    await sql`
      INSERT INTO peer_reviews
        (attempt_id, attempt_date, reviewer_id, author_id, rubric_scores, weighted_points, created_at)
      SELECT a.id, a.attempt_date, ${REVIEWER}::uuid, ${PENULIS}::uuid, '{"x":1}'::jsonb, 0, now()
      FROM lesson_attempts a WHERE a.id = ${attempts[5]}::uuid
    `.execute(db);

    const r = await reviews.submit({
      reviewerId: REVIEWER,
      attemptId: attempts[6]!,
      rubricScores: nilai,
    });
    expect(r.scored_today).toBe(3);
    expect(r.capped).toBe(false);
  });

  // ── PR-5: poin berbobot ─────────────────────────────────────────────────

  it('PR-5: poin = rubrik_total × reviewer_weight', async () => {
    if (!reachable) return;
    // 1,50 adalah bobot MAKSIMUM yang diizinkan CHECK `reviewer_weights_range`.
    await db
      .updateTable('reviewer_weights')
      .set({ weight: '1.50' })
      .where('user_id', '=', REVIEWER)
      .execute();

    const r = await reviews.submit({
      reviewerId: REVIEWER,
      attemptId: attempts[0]!,
      rubricScores: nilai, // total 9
    });
    // 9 × 1,50 = 13,5 → dibulatkan 14. `weighted_points` bertipe integer.
    expect(r.weighted_points).toBe(14);
  });

  it('bobot reviewer dibatasi DATABASE 0,50..1,50 — poin tidak bisa dicetak lewat bobot', async () => {
    if (!reachable) return;
    // PR-9 membiarkan mentor menyetel bobot manual lewat Retool. Tanpa batas
    // ini, satu angka di Retool bisa mengalikan poin seseorang tanpa batas —
    // dan Retool tidak lewat jalur kode mana pun yang bisa memeriksanya.
    // Yang menahannya CHECK, bukan disiplin.
    const setBobot = (w: string) =>
      db
        .updateTable('reviewer_weights')
        .set({ weight: w })
        .where('user_id', '=', REVIEWER)
        .execute();

    // Lapis 1 — CHECK `reviewer_weights_range` (0,50..1,50).
    for (const w of ['2.00', '1.51', '0.49', '0.00', '-1.00']) {
      await expect(setBobot(w), `bobot ${w} diterima`).rejects.toThrow(/reviewer_weights_range/);
    }

    // Lapis 2 — TIPE KOLOMNYA sendiri. `numeric(3,2)` menolak apa pun yang
    // nilai absolutnya >= 10 sebelum CHECK sempat jalan. Angka yang benar-benar
    // berbahaya di Retool (ketik 100, lupa titik desimal) ditolak lebih dulu
    // oleh tipe, bukan oleh constraint.
    await expect(setBobot('100.00'), 'bobot 100 diterima').rejects.toThrow(
      /numeric field overflow/,
    );

    // Dan yang SAH tetap diterima — batas yang menolak semuanya bukan batas.
    await expect(setBobot('1.50')).resolves.toBeDefined();
    await expect(setBobot('0.50')).resolves.toBeDefined();
  });

  it('PR-8: reviewer_weights dibuat otomatis dan bernilai 1,00', async () => {
    if (!reachable) return;
    // Dijamin trigger AU-6 (migrasi 005), bukan oleh kode review. Diuji di sini
    // karena PR-5 diam-diam bergantung padanya: baris yang hilang berarti
    // reviewer kehilangan poin tanpa jejak.
    const w = await db
      .selectFrom('reviewer_weights')
      .select('weight')
      .where('user_id', '=', REVIEWER)
      .executeTakeFirstOrThrow();
    expect(Number(w.weight)).toBe(1);

    const r = await reviews.submit({
      reviewerId: REVIEWER,
      attemptId: attempts[0]!,
      rubricScores: nilai,
    });
    expect(r.weighted_points).toBe(9);
  });

  // ── ATURAN KERAS 9: nilai rubrik dari klien tidak dipercaya ─────────────

  it('ATURAN 9: nilai rubrik di luar rentang DITOLAK — bukan dicetak jadi poin', async () => {
    if (!reachable) return;
    // Tanpa ini, `POST /reviews/:id` dengan {"x": 999999} mencetak 999.999
    // poin lewat endpoint publik.
    for (const jahat of [
      { x: 999999 },
      { x: -1 },
      { x: RUBRIC_MAX_SCORE + 1 },
      { x: 1.5 },
      { x: Number.NaN },
      { x: Number.POSITIVE_INFINITY },
      {},
    ]) {
      await expect(
        reviews.submit({
          reviewerId: REVIEWER,
          attemptId: attempts[0]!,
          rubricScores: jahat as Record<string, number>,
        }),
        `rubrik ${JSON.stringify(jahat)} LOLOS`,
      ).rejects.toBeInstanceOf(BadRequestException);
    }

    const n = await db
      .selectFrom('peer_reviews')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .executeTakeFirstOrThrow();
    expect(Number(n.n), 'ada review tersimpan dari rubrik yang ditolak').toBe(0);
  });

  it('ATURAN 9: kriteria melebihi batas ditolak', async () => {
    if (!reachable) return;
    const banyak = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`k${i}`, 5]));
    await expect(
      reviews.submit({ reviewerId: REVIEWER, attemptId: attempts[0]!, rubricScores: banyak }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  // ── KONKURENSI: cap yang bocor di batasnya adalah cap yang tidak ada ────

  it('dua submit BERSAMAAN di batas cap tidak menghasilkan 6 review berpoin', async () => {
    if (!reachable) return;
    await tanamReviewBerpoin(DAILY_SCORED_CAP - 1, '1 second');

    // ── Kenapa pakai GERBANG, bukan sekadar Promise.all ──
    //
    // Versi pertama test ini menembak dua submit sekaligus lalu menyebutnya
    // test konkurensi. Ia LULUS meski `FOR UPDATE` dicabut dari service —
    // jadi ia tidak membuktikan apa pun. Persis jebakan yang sudah tercatat
    // di CLAUDE.md dan tetap terulang.
    //
    // Di sini transaksi ketiga MENAHAN kunci baris reviewer. Selama tahanan
    // itu hidup, submit yang benar WAJIB menumpuk di belakangnya dan tidak
    // menulis apa pun. Kalau kuncinya dicabut dari service, kedua submit
    // menyelesaikan seluruh baca-tulisnya di dalam jendela ini — dan assert
    // "nol baris selama gerbang tertahan" langsung merah.
    let bukaGerbang!: () => void;
    const gerbang = new Promise<void>((r) => {
      bukaGerbang = r;
    });

    const penahan = db.transaction().execute(async (trx) => {
      await sql`SELECT id FROM users WHERE id = ${REVIEWER}::uuid FOR UPDATE`.execute(trx);
      await gerbang;
    });
    await new Promise((r) => setTimeout(r, 250)); // tahanan sudah memegang kunci

    const p1 = reviews.submit({
      reviewerId: REVIEWER,
      attemptId: attempts[5]!,
      rubricScores: nilai,
    });
    const p2 = reviews.submit({
      reviewerId: REVIEWER,
      attemptId: attempts[6]!,
      rubricScores: nilai,
    });
    await new Promise((r) => setTimeout(r, 400)); // keduanya menumpuk

    // INI assert yang menggigit. Kunci ada -> keduanya terblokir, nol baris
    // baru. Kunci dicabut -> keduanya sudah selesai, dua baris berpoin.
    const selamaTertahan = await sql<{ n: string }>`
      SELECT count(*)::text AS n FROM peer_reviews
      WHERE reviewer_id = ${REVIEWER}::uuid
        AND attempt_id IN (${attempts[5]}::uuid, ${attempts[6]}::uuid)
    `.execute(db);
    expect(
      Number(selamaTertahan.rows[0]!.n),
      'submit menembus kunci baris reviewer — cap dibaca tanpa serialisasi',
    ).toBe(0);

    bukaGerbang();
    await penahan;

    const hasil = await Promise.allSettled([p1, p2]);
    for (const h of hasil) {
      expect(h.status, h.status === 'rejected' ? String(h.reason) : '').toBe('fulfilled');
    }

    const berpoin = await sql<{ n: string }>`
      SELECT count(*)::text AS n
      FROM peer_reviews pr JOIN users u ON u.id = pr.reviewer_id
      WHERE pr.reviewer_id = ${REVIEWER}::uuid
        AND pr.weighted_points > 0
        AND (pr.created_at AT TIME ZONE u.timezone)::date
          = (now() AT TIME ZONE u.timezone)::date
    `.execute(db);

    expect(
      Number(berpoin.rows[0]!.n),
      'lebih dari 5 review berpoin hari ini — cap bocor tepat di batasnya',
    ).toBe(DAILY_SCORED_CAP);
  });
});
