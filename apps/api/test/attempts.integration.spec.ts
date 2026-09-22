import { randomUUID } from 'node:crypto';
import { Kysely, sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase, type DB } from '../src/infra/kysely';
import { AttemptsService, GradingService } from '../src/modules/learning';
import { StreakService } from '../src/modules/streak';
import { CoinLedgerService } from '../src/modules/wallet';

/**
 * `L-03` terhadap DATABASE NYATA — PRD §7 E2 `LE-4` … `LE-8`, AC-LE-1…5.
 *
 * Ini JANTUNG SISTEM dan jalur uang sekaligus. Dua hal yang diuji paling
 * keras, karena keduanya acceptance criteria harfiah:
 *
 *   1. Exception di TENGAH transaksi meninggalkan NOL baris di keempat tabel.
 *   2. `Idempotency-Key` yang sama dua kali → SATU attempt, SATU entri koin.
 */

const URL_DEV = 'postgres://strive:strive_dev_only@localhost:55432/strive';
const url = process.env['DATABASE_URL_TEST'] ?? process.env['DATABASE_URL'] ?? URL_DEV;

const AKU = '00000000-0000-4000-8000-0000000103a1';
const TRACK = '00000000-0000-4000-8000-0000000103b0';
const MODUL = '00000000-0000-4000-8000-0000000103b1';
const LESSON = '00000000-0000-4000-8000-0000000103b2';
const LESSON2 = '00000000-0000-4000-8000-0000000103b3';
const MUSIM = '00000000-0000-4000-8000-0000000103c0';
const SQUAD = '00000000-0000-4000-8000-0000000103c1';

let db: Kysely<DB>;
let attempts: AttemptsService;
let reachable = false;
let kartu: string[] = [];

const opsi = (benar: string) =>
  JSON.stringify({
    options: [
      { id: 'a', text: 'A', correct: benar === 'a', why: 'karena A' },
      { id: 'b', text: 'B', correct: benar === 'b', why: 'karena B' },
    ],
  });

const semuaBenar = () => [
  { card_id: kartu[0]!, answer: 'a', ms: 4000 },
  { card_id: kartu[1]!, answer: 'b', ms: 4000 },
];

const hitung = async (
  tabel: 'lesson_attempts' | 'coin_ledger' | 'outbox_events' | 'daily_quests',
) =>
  Number(
    (
      await db
        .selectFrom(tabel)
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .executeTakeFirstOrThrow()
    ).n,
  );

/**
 * Event outbox per TOPIK.
 *
 * Satu attempt menghasilkan TIGA baris, dan ketiganya benar: `streak.updated`
 * dari `StreakService`, `wallet.updated` dari `CoinLedgerService`, dan
 * `points.awarded` dari sini. Menghitung totalnya akan menguji jumlah
 * konsumen, bukan perilaku item ini.
 */
const hitungTopik = async (topic: string) =>
  Number(
    (
      await db
        .selectFrom('outbox_events')
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .where('topic', '=', topic)
        .executeTakeFirstOrThrow()
    ).n,
  );

const saldo = async () =>
  (
    await db
      .selectFrom('users')
      .select('coin_balance')
      .where('id', '=', AKU)
      .executeTakeFirstOrThrow()
  ).coin_balance;

const streakRow = async () =>
  db
    .selectFrom('streaks')
    .select(['current_streak', 'longest_streak', 'last_activity_date'])
    .where('user_id', '=', AKU)
    .executeTakeFirstOrThrow();

const poinSquad = async () =>
  (
    await db
      .selectFrom('squad_members')
      .select('weekly_points')
      .where('user_id', '=', AKU)
      .where('left_at', 'is', null)
      .executeTakeFirstOrThrow()
  ).weekly_points;

/** ATURAN 2 — cache saldo harus SELALU sama dengan jumlah ledger. */
async function assertSaldoKonsisten() {
  const r = await sql<{ cache: number; ledger: string }>`
    SELECT u.coin_balance AS cache, COALESCE(SUM(l.amount), 0)::text AS ledger
    FROM users u LEFT JOIN coin_ledger l ON l.user_id = u.id
    WHERE u.id = ${AKU} GROUP BY u.coin_balance
  `.execute(db);
  const row = r.rows[0]!;
  expect(row.cache, `cache ${row.cache} vs ledger ${row.ledger}`).toBe(Number(row.ledger));
}

beforeAll(async () => {
  db = createDatabase(url);
  attempts = new AttemptsService(
    db,
    new GradingService(),
    new StreakService(db),
    new CoinLedgerService(),
  );
  try {
    await db.selectFrom('lesson_attempts').select('id').limit(1).execute();
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
  // `outbox_events` disebut TERPISAH: ia tidak punya FK ke `users`, jadi tidak
  // ikut terbawa CASCADE — dan sisa event dari berkas test lain akan membuat
  // hitungan di bawah meleset tanpa petunjuk apa pun. Aman karena
  // `fileParallelism: false`.
  await sql`TRUNCATE users, tracks, league_seasons, squads RESTART IDENTITY CASCADE`.execute(db);
  await sql`TRUNCATE outbox_events RESTART IDENTITY`.execute(db);
  await db
    .insertInto('users')
    .values({ id: AKU, email: 'l03@uji.test', display_name: 'Aku' })
    .execute();
  await db.insertInto('tracks').values({ id: TRACK, slug: 'l03', title: 'T' }).execute();
  await db.insertInto('modules').values({ id: MODUL, track_id: TRACK, title: 'M' }).execute();
  await db
    .insertInto('lessons')
    .values([
      { id: LESSON, module_id: MODUL, title: 'L', base_points: 10, base_coins: 20 },
      { id: LESSON2, module_id: MODUL, title: 'L2', base_points: 10, base_coins: 20 },
    ])
    .execute();

  const baris = await db
    .insertInto('lesson_cards')
    .values([
      {
        lesson_id: LESSON,
        kind: 'multiple_choice',
        prompt: 'p1',
        content: opsi('a'),
        sort_order: 1,
      },
      {
        lesson_id: LESSON,
        kind: 'multiple_choice',
        prompt: 'p2',
        content: opsi('b'),
        sort_order: 2,
      },
    ])
    .returning('id')
    .execute();
  kartu = baris.map((b) => b.id);
  await db
    .insertInto('lesson_cards')
    .values({ lesson_id: LESSON2, kind: 'multiple_choice', prompt: 'x', content: opsi('a') })
    .execute();

  // Squad supaya tulisan ke-5 (poin liga) punya sasaran.
  await db
    .insertInto('league_seasons')
    .values({
      id: MUSIM,
      code: '2026-W41',
      starts_at: sql`now() - interval '1 day'`,
      ends_at: sql`now() + interval '6 days'`,
    })
    .execute();
  await db.insertInto('squads').values({ id: SQUAD, name: 'S', season_id: MUSIM }).execute();
  await db.insertInto('squad_members').values({ squad_id: SQUAD, user_id: AKU }).execute();
});

describe('L-03 — POST /attempts (database nyata)', () => {
  it('database siap dipakai', () => {
    expect(reachable, `DATABASE_URL tidak bisa dipakai (${url})`).toBe(true);
  });

  // ── AC-LE-1: enam tulisan, satu transaksi ──────────────────────────────

  it('AC-LE-1: semua benar → rewarded, score 100, coins 20, dan ENAM tulisan', async () => {
    if (!reachable) return;
    const r = await attempts.submit({
      userId: AKU,
      lessonId: LESSON,
      answers: semuaBenar(),
      durationMs: 20_000,
      idempotencyKey: randomUUID(),
    });

    expect(r).toMatchObject({ rewarded: true, score: 100, coins: 20, points: 10, balance: 20 });
    expect(r.feedback).toHaveLength(2);

    // 1 · attempt
    const a = await db
      .selectFrom('lesson_attempts')
      .selectAll()
      .where('id', '=', r.attempt_id)
      .executeTakeFirstOrThrow();
    expect(a.score).toBe(100);
    expect(a.duration_ms).toBe(20_000);
    // `card_results` menyimpan JAWABAN YANG DIKIRIM, bukan yang benar — tanpa
    // itu analisis anti-cheat nanti membaca data yang tidak pernah terjadi.
    expect(a.card_results).toHaveLength(2);

    // 2 · streak
    expect((await streakRow()).current_streak).toBe(1);
    // `reset`, BUKAN `extended`, untuk aktivitas pertama seumur hidup:
    // `StreakService` memperlakukan "belum pernah aktif" sama dengan gap > 1
    // (SK-4 → current = 1). Kosakatanya milik `S-01`, dan yang diuji di sini
    // apa yang BENAR-BENAR terjadi — bukan apa yang enak dibaca.
    expect(r.streak).toMatchObject({ kind: 'reset', current: 1, is_new_record: true });

    // 3 · ledger + cache saldo
    expect(await saldo()).toBe(20);
    await assertSaldoKonsisten();
    const entri = await db
      .selectFrom('coin_ledger')
      .selectAll()
      .where('user_id', '=', AKU)
      .executeTakeFirstOrThrow();
    expect(entri).toMatchObject({
      entry_type: 'earn_lesson',
      amount: 20,
      ref_type: 'attempt',
      ref_id: r.attempt_id,
    });

    // 4 · quest
    expect(r.quest).toMatchObject({ done_tasks: 1, target_tasks: 3, completed: false });

    // 5 · poin squad
    expect(await poinSquad(), 'poin liga tidak bertambah').toBe(10);

    // 6 · outbox — BUKAN ZINCRBY langsung (aturan 6, LE-7)
    const ob = await db
      .selectFrom('outbox_events')
      .selectAll()
      .where('topic', '=', 'points.awarded')
      .executeTakeFirstOrThrow();
    expect(ob.processed_at, 'event sudah ditandai selesai padahal belum diproses').toBeNull();
    expect(ob.payload).toMatchObject({ user_id: AKU, attempt_id: r.attempt_id, points: 10 });
  });

  it('skor 0 TETAP berhadiah dan tetap menaikkan streak', async () => {
    if (!reachable) return;
    const r = await attempts.submit({
      userId: AKU,
      lessonId: LESSON,
      answers: [
        { card_id: kartu[0]!, answer: 'b', ms: 4000 },
        { card_id: kartu[1]!, answer: 'a', ms: 4000 },
      ],
      durationMs: 20_000,
      idempotencyKey: randomUUID(),
    });

    // "Menghukum percobaan yang jujur membuat orang berhenti mencoba."
    expect(r).toMatchObject({ rewarded: true, score: 0, coins: 8, points: 5 });
    expect((await streakRow()).current_streak).toBe(1);
  });

  // ── AC-LE-3: rollback. Inti acceptance criteria item ini ───────────────

  it('AC-LE-3: exception di TENGAH transaksi → nol baris di keempat tabel', async () => {
    if (!reachable) return;
    // Exception dilempar SETELAH insert coin_ledger, persis seperti bunyi
    // AC-nya. Caranya: `CoinLedgerService` yang meledak tepat sesudah menulis.
    class LedgerMeledak extends CoinLedgerService {
      override async write(trx: never, params: never) {
        await super.write(trx, params);
        throw new Error('meledak tepat setelah insert coin_ledger');
      }
    }
    const rapuh = new AttemptsService(
      db,
      new GradingService(),
      new StreakService(db),
      new LedgerMeledak(),
    );

    await expect(
      rapuh.submit({
        userId: AKU,
        lessonId: LESSON,
        answers: semuaBenar(),
        durationMs: 20_000,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toThrow(/meledak/);

    // Keempat tabel yang disebut AC — plus quest dan poin squad.
    expect(await hitung('lesson_attempts'), 'attempt tertinggal').toBe(0);
    expect(await hitung('coin_ledger'), 'entri ledger tertinggal').toBe(0);
    expect(await hitung('outbox_events'), 'event outbox tertinggal').toBe(0);
    expect(await hitung('daily_quests'), 'quest tertinggal').toBe(0);
    expect(await saldo(), 'cache saldo berubah padahal transaksi gagal').toBe(0);
    expect((await streakRow()).current_streak, 'streak maju padahal attempt gagal').toBe(0);
    expect(await poinSquad(), 'poin liga bertambah padahal transaksi gagal').toBe(0);
    await assertSaldoKonsisten();
  });

  // ── AC-LE-4 / LE-8: idempotensi ────────────────────────────────────────

  it('AC: Idempotency-Key SAMA dua kali → satu attempt, satu entri koin', async () => {
    if (!reachable) return;
    const kunci = randomUUID();
    const p = { userId: AKU, lessonId: LESSON, answers: semuaBenar(), durationMs: 20_000 };

    const a = await attempts.submit({ ...p, idempotencyKey: kunci });
    const b = await attempts.submit({ ...p, idempotencyKey: kunci });

    expect(await hitung('lesson_attempts')).toBe(1);
    expect(await hitung('coin_ledger')).toBe(1);
    expect(await hitungTopik('points.awarded'), 'event dikirim dua kali').toBe(1);
    expect(await saldo()).toBe(20);
    expect(await poinSquad(), 'poin liga ditambahkan dua kali').toBe(10);
    await assertSaldoKonsisten();

    // Request yang diulang jaringan BUKAN latihan: menjawabnya
    // `rewarded: false` membuat klien mengira hadiahnya hilang.
    expect(b.rewarded, 'request ulang dijawab seolah tidak berhadiah').toBe(true);
    expect(b.attempt_id).toBe(a.attempt_id);
    expect(b.coins).toBe(a.coins);
    expect(b.balance).toBe(a.balance);
  });

  it('dua submit BERSAMAAN dengan kunci sama → tetap satu attempt', async () => {
    if (!reachable) return;
    const kunci = randomUUID();
    const p = {
      userId: AKU,
      lessonId: LESSON,
      answers: semuaBenar(),
      durationMs: 20_000,
      idempotencyKey: kunci,
    };

    const hasil = await Promise.allSettled([attempts.submit(p), attempts.submit(p)]);

    // Salah satunya boleh gagal (unique violation) — yang TIDAK boleh adalah
    // dua attempt, dua entri koin, atau saldo yang terhitung dua kali.
    expect(hasil.some((h) => h.status === 'fulfilled')).toBe(true);
    expect(await hitung('lesson_attempts')).toBe(1);
    expect(await hitung('coin_ledger')).toBe(1);
    expect(await saldo()).toBe(20);
    await assertSaldoKonsisten();
  });

  // ── AC-LE-2 / LE-4: pengulangan latihan ────────────────────────────────

  it('AC-LE-2: lesson yang SAMA hari ini lagi → rewarded=false, nol efek', async () => {
    if (!reachable) return;
    await attempts.submit({
      userId: AKU,
      lessonId: LESSON,
      answers: semuaBenar(),
      durationMs: 20_000,
      idempotencyKey: randomUUID(),
    });
    const streakSebelum = (await streakRow()).current_streak;

    // Kunci BERBEDA — ini latihan sungguhan, bukan request yang diulang.
    const ulang = await attempts.submit({
      userId: AKU,
      lessonId: LESSON,
      answers: [
        { card_id: kartu[0]!, answer: 'b', ms: 4000 },
        { card_id: kartu[1]!, answer: 'b', ms: 4000 },
      ],
      durationMs: 9000,
      idempotencyKey: randomUUID(),
    });

    expect(ulang.rewarded).toBe(false);
    expect(ulang.coins).toBe(0);
    expect(ulang.points).toBe(0);
    // Skor dari latihan BARUSAN — yang ingin dilihat orang yang baru saja
    // berlatih adalah hasil latihannya, bukan hasil paginya.
    expect(ulang.score, 'skor latihan diambil dari attempt lama').toBe(50);

    expect(await hitung('lesson_attempts')).toBe(1);
    expect(await hitung('coin_ledger')).toBe(1);
    expect(await saldo()).toBe(20);
    expect((await streakRow()).current_streak, 'streak naik dua kali di hari yang sama').toBe(
      streakSebelum,
    );
    expect(await poinSquad()).toBe(10);
    await assertSaldoKonsisten();
  });

  it('LESSON LAIN di hari yang sama tetap berhadiah', async () => {
    if (!reachable) return;
    // LE-4 membatasi per LESSON, bukan per hari. Penjaga terhadap larangan
    // yang kelewat luas: pengguna rajin berhenti dapat koin setelah satu
    // lesson, dan tidak ada yang mengeluh karena mereka mengira itu aturannya.
    await attempts.submit({
      userId: AKU,
      lessonId: LESSON,
      answers: semuaBenar(),
      durationMs: 20_000,
      idempotencyKey: randomUUID(),
    });

    const kartu2 = await db
      .selectFrom('lesson_cards')
      .select('id')
      .where('lesson_id', '=', LESSON2)
      .executeTakeFirstOrThrow();

    const kedua = await attempts.submit({
      userId: AKU,
      lessonId: LESSON2,
      answers: [{ card_id: kartu2.id, answer: 'a', ms: 4000 }],
      durationMs: 10_000,
      idempotencyKey: randomUUID(),
    });

    expect(kedua.rewarded).toBe(true);
    expect(await saldo()).toBe(40);
    // SK-3: task kedua di hari yang sama TIDAK menambah streak.
    expect((await streakRow()).current_streak).toBe(1);
    expect(kedua.quest.done_tasks).toBe(2);
    await assertSaldoKonsisten();
  });

  it('quest selesai di task ke-3, dan tidak "selesai lagi" di ke-4', async () => {
    if (!reachable) return;
    await sql`
      INSERT INTO daily_quests (user_id, quest_date, done_tasks)
      VALUES (${AKU}, (now() AT TIME ZONE 'Asia/Jakarta')::date, 2)
    `.execute(db);

    const r = await attempts.submit({
      userId: AKU,
      lessonId: LESSON,
      answers: semuaBenar(),
      durationMs: 20_000,
      idempotencyKey: randomUUID(),
    });
    expect(r.quest).toMatchObject({ done_tasks: 3, completed: true });

    const selesaiPertama = (
      await db
        .selectFrom('daily_quests')
        .select('completed_at')
        .where('user_id', '=', AKU)
        .executeTakeFirstOrThrow()
    ).completed_at;

    const kartu2 = await db
      .selectFrom('lesson_cards')
      .select('id')
      .where('lesson_id', '=', LESSON2)
      .executeTakeFirstOrThrow();
    await attempts.submit({
      userId: AKU,
      lessonId: LESSON2,
      answers: [{ card_id: kartu2.id, answer: 'a', ms: 4000 }],
      durationMs: 10_000,
      idempotencyKey: randomUUID(),
    });

    const selesaiKedua = (
      await db
        .selectFrom('daily_quests')
        .select(['completed_at', 'done_tasks'])
        .where('user_id', '=', AKU)
        .executeTakeFirstOrThrow()
    ).completed_at;

    expect(selesaiKedua, 'completed_at ditulis ulang di task berikutnya').toEqual(selesaiPertama);
  });

  // ── Tanggal lokal ──────────────────────────────────────────────────────

  it('LE-5: `attempt_date` tanggal LOKAL pengguna, bukan UTC', async () => {
    if (!reachable) return;
    await db
      .updateTable('streaks')
      .set({ timezone: 'Pacific/Kiritimati' }) // UTC+14
      .where('user_id', '=', AKU)
      .execute();

    const r = await attempts.submit({
      userId: AKU,
      lessonId: LESSON,
      answers: semuaBenar(),
      durationMs: 20_000,
      idempotencyKey: randomUUID(),
    });

    // Dibandingkan ke hitungan POSTGRES untuk zona itu, bukan ke string yang
    // diketik di sini — satu-satunya bentuk yang tidak lulus palsu di CI UTC.
    const harap = await sql<{ d: string; utc: string }>`
      SELECT to_char((now() AT TIME ZONE 'Pacific/Kiritimati')::date, 'YYYY-MM-DD') AS d,
             to_char(now()::date, 'YYYY-MM-DD') AS utc
    `.execute(db);
    const a = await db
      .selectFrom('lesson_attempts')
      .select('attempt_date')
      .where('id', '=', r.attempt_id)
      .executeTakeFirstOrThrow();

    expect(a.attempt_date).toBe(harap.rows[0]!.d);
    // `attempt_date` HARUS sama dengan hari streak — kalau keduanya memakai
    // sumber zona yang berbeda, LE-4 bocor tepat di hari mereka berselisih.
    expect((await streakRow()).last_activity_date).toBe(a.attempt_date);
  });

  // ── Validasi ───────────────────────────────────────────────────────────

  it('card_id di luar lesson → 422, dan NOL baris ditulis', async () => {
    if (!reachable) return;
    const kartu2 = await db
      .selectFrom('lesson_cards')
      .select('id')
      .where('lesson_id', '=', LESSON2)
      .executeTakeFirstOrThrow();

    await expect(
      attempts.submit({
        userId: AKU,
        lessonId: LESSON,
        answers: [{ card_id: kartu2.id, answer: 'a', ms: 4000 }],
        durationMs: 20_000,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({
      response: { error: { code: 'CARD_NOT_IN_LESSON' } },
    });

    expect(await hitung('lesson_attempts')).toBe(0);
    expect(await hitung('coin_ledger')).toBe(0);
    expect(await saldo()).toBe(0);
  });

  it('pengguna tanpa squad tetap bisa mengerjakan lesson', async () => {
    if (!reachable) return;
    // Pengguna baru belum punya squad sampai job mingguan berjalan (Q-01).
    // `UPDATE` yang menyentuh nol baris bukan galat — tapi kalau kode ini
    // pernah diubah jadi `executeTakeFirstOrThrow`, seluruh pengguna baru
    // berhenti bisa belajar, dan pesannya menunjuk ke squad.
    await db.deleteFrom('squad_members').where('user_id', '=', AKU).execute();

    const r = await attempts.submit({
      userId: AKU,
      lessonId: LESSON,
      answers: semuaBenar(),
      durationMs: 20_000,
      idempotencyKey: randomUUID(),
    });
    expect(r.rewarded).toBe(true);
    expect(await saldo()).toBe(20);
  });
});
