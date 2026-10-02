import { Kysely, sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase, type DB } from '../src/infra/kysely';
import { HubService } from '../src/modules/hub';
import { CoinLedgerService } from '../src/modules/wallet';

/**
 * `HubService` terhadap DATABASE NYATA.
 *
 * `S-02` punya acceptance criteria yang tidak biasa: **p95 < 250 ms dengan
 * 1.000 `lesson_attempts` milik pengguna tersebut.** Itu tidak bisa dibuktikan
 * dengan membaca kode — jadi test terakhir di bawah benar-benar menyemai 1.000
 * attempt dan mengukurnya.
 */

const URL_DEV = 'postgres://strive:strive_dev_only@localhost:55432/strive';
const url = process.env['DATABASE_URL_TEST'] ?? process.env['DATABASE_URL'] ?? URL_DEV;

let db: Kysely<DB>;
let hub: HubService;
let coins: CoinLedgerService;
let reachable = false;

const USER = '00000000-0000-4000-8000-0000000502a1';
const TEMAN = '00000000-0000-4000-8000-0000000502a2';
const TRACK = '00000000-0000-4000-8000-0000000502b1';
const MODUL = '00000000-0000-4000-8000-0000000502b2';
const SEASON = '00000000-0000-4000-8000-0000000502c1';
const SQUAD = '00000000-0000-4000-8000-0000000502c2';
const lessonId = (n: number) => `00000000-0000-4000-8000-0000005${String(n).padStart(5, '0')}`;

beforeAll(async () => {
  db = createDatabase(url);
  hub = new HubService(db);
  coins = new CoinLedgerService();
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
  await sql`TRUNCATE users, tracks, league_seasons, squads RESTART IDENTITY CASCADE`.execute(db);
  await db
    .insertInto('users')
    .values([
      { id: USER, email: 'hub1@uji.test', display_name: 'Uji' },
      { id: TEMAN, email: 'hub2@uji.test', display_name: 'Teman' },
    ])
    .execute();
  await db
    .insertInto('tracks')
    .values({ id: TRACK, slug: 'hub', title: 'Track Hub', is_published: true })
    .execute();
  await db.insertInto('modules').values({ id: MODUL, track_id: TRACK, title: 'M1' }).execute();
  await db
    .insertInto('lessons')
    .values(
      Array.from({ length: 5 }, (_, i) => ({
        id: lessonId(i),
        module_id: MODUL,
        title: `Lesson ${i}`,
        sort_order: i,
      })),
    )
    .execute();
});

/**
 * Menyetel zona waktu seperti `PATCH /me` melakukannya: KEDUA baris, sekaligus.
 *
 * Ada sebagai fungsi supaya tidak ada test yang menyetel salah satu saja tanpa
 * sengaja — persis kekeliruan yang membuat test tanggal lokal di bawah lulus
 * terhadap implementasi yang membaca sumber yang salah.
 */
async function setZona(userId: string, zona: string): Promise<void> {
  await db.updateTable('users').set({ timezone: zona }).where('id', '=', userId).execute();
  await db.updateTable('streaks').set({ timezone: zona }).where('user_id', '=', userId).execute();
}

describe('HubService (database nyata)', () => {
  it('database siap dipakai', () => {
    expect(reachable, `DATABASE_URL tidak bisa dipakai (${url})`).toBe(true);
  });

  it('satu panggilan mengembalikan kelima bagian layar Hub', async () => {
    if (!reachable) return;
    const h = await hub.forUser(USER);

    // Alasan endpoint ini ada adalah menghindari 5 request dari satu layar.
    // Kalau salah satu bagian hilang, layarnya tetap harus menembak request
    // kedua — dan janji itu batal.
    expect(Object.keys(h).sort()).toEqual(['balance', 'next_cards', 'quest', 'squad', 'streak']);
  });

  it('pengguna baru: streak 0 dan berisiko hari ini, quest 0/3, squad null', async () => {
    if (!reachable) return;
    const h = await hub.forUser(USER);

    expect(h.streak.current_streak).toBe(0);
    expect(h.streak.at_risk_today, 'belum aktif hari ini → berisiko').toBe(true);
    // Barisnya dibuat trigger AU-6, jadi ada meski belum pernah dipakai.
    expect(h.streak.freeze_credits).toBe(1);
    expect(h.quest).toMatchObject({ target_tasks: 3, done_tasks: 0, completed: false });
    expect(h.squad).toBeNull();
    expect(h.balance).toBe(0);
  });

  it('quest memakai tanggal LOKAL pengguna, bukan tanggal UTC', async () => {
    if (!reachable) return;
    // Pacific/Kiritimati (UTC+14) dan Pacific/Niue (UTC-11) berjarak 25 jam —
    // lebih dari satu hari, jadi tanggal lokal keduanya SELALU berbeda, jam UTC
    // berapa pun. Itu yang membuat test ini menangkap `::date` atas
    // timestamptz UTC.
    //
    // KEDUA baris disetel, dan itu bukan kelebihan hati-hati: `users.timezone`
    // dan `streaks.timezone` menyimpan satu fakta di dua tempat, dan
    // `PATCH /me` menulis keduanya dalam SATU transaksi. Versi pertama test ini
    // hanya menyetel `users` — dan karena itu ia LULUS hanya terhadap
    // implementasi yang membaca sumber yang salah. Ia merah saat sumbernya
    // dibetulkan, yang membuktikan apa yang sebenarnya dijaganya.
    await setZona(USER, 'Pacific/Kiritimati');
    await setZona(TEMAN, 'Pacific/Niue');

    const [a, b] = await Promise.all([hub.forUser(USER), hub.forUser(TEMAN)]);
    const harapan = await sql<{ a: string; b: string }>`
      SELECT to_char((now() AT TIME ZONE 'Pacific/Kiritimati')::date, 'YYYY-MM-DD') AS a,
             to_char((now() AT TIME ZONE 'Pacific/Niue')::date, 'YYYY-MM-DD') AS b
    `.execute(db);

    expect(a.quest.date).toBe(harapan.rows[0]!.a);
    expect(b.quest.date).toBe(harapan.rows[0]!.b);
    // Zona yang menentukan tanggal itu ikut dikirim, supaya klien tidak
    // memanggil /me hanya untuk merender hitungan sisa jam (S-03).
    expect(a.streak.timezone).toBe('Pacific/Kiritimati');
    expect(b.streak.timezone).toBe('Pacific/Niue');
  });

  it('quest_date dibaca dengan streaks.timezone — sumber yang SAMA dengan penulisnya', async () => {
    if (!reachable) return;
    // Kedua baris sengaja DISIMPANGKAN. Keadaan ini tidak bisa dicapai lewat
    // API (PATCH /me menulis keduanya sekaligus), dan justru itu gunanya: ia
    // satu-satunya cara memisahkan SUMBER mana yang dibaca. Selama keduanya
    // sama, membaca yang salah tidak punya gejala apa pun.
    await db
      .updateTable('users')
      .set({ timezone: 'Pacific/Niue' })
      .where('id', '=', USER)
      .execute();
    await db
      .updateTable('streaks')
      .set({ timezone: 'Pacific/Kiritimati' })
      .where('user_id', '=', USER)
      .execute();

    const t = await sql<{ kiritimati: string; niue: string }>`
      SELECT to_char((now() AT TIME ZONE 'Pacific/Kiritimati')::date, 'YYYY-MM-DD') AS kiritimati,
             to_char((now() AT TIME ZONE 'Pacific/Niue')::date, 'YYYY-MM-DD') AS niue
    `.execute(db);
    const { kiritimati, niue } = t.rows[0]!;
    expect(kiritimati, '25 jam terpisah: tanggalnya tidak boleh sama').not.toBe(niue);

    // Baris quest ditulis pada tanggal lokal KIRITIMATI — tanggal yang dipakai
    // `attempts.service.ts`, satu-satunya penulis kolom ini, yang juga membaca
    // `streaks.timezone`.
    await db
      .insertInto('daily_quests')
      .values({ user_id: USER, quest_date: kiritimati, target_tasks: 3, done_tasks: 2 })
      .execute();

    const h = await hub.forUser(USER);
    // Membaca `users.timezone` berarti mencari tanggal Niue — tanggal yang
    // tidak pernah ditulis siapa pun. Barisnya tidak ditemukan, dan layar
    // menampilkan 0/3 kepada orang yang sudah mengerjakan dua tugas, tanpa
    // satu galat pun. Itu bentuk kegagalan yang paling lama tidak ketahuan.
    // `done_tasks` lebih dulu: ia yang melaporkan KERUGIANNYA kalau merah,
    // bukan selisih tanggal yang masih perlu ditafsirkan.
    expect(h.quest.done_tasks, 'dua tugas selesai terbaca 0 = baris tidak ditemukan').toBe(2);
    expect(h.quest.date).toBe(kiritimati);
    expect(h.streak.timezone).toBe('Pacific/Kiritimati');
  });

  it('freeze_used_today: hanya hari lokal INI, bukan "pernah pakai freeze"', async () => {
    if (!reachable) return;
    expect((await hub.forUser(USER)).streak.freeze_used_today, 'belum pernah memakai freeze').toBe(
      false,
    );

    // Tanggal diambil dari Postgres, zona dari baris `streaks` — sumber yang
    // sama dengan yang dibaca service. `- 1` berada di TEKS SQL, bukan
    // parameter bind, jadi ia `date - integer -> date` tanpa ambiguitas
    // (jebakan `date - $1` di CLAUDE.md hanya berlaku untuk parameter).
    const t = await sql<{ hari_ini: string; kemarin: string }>`
      SELECT to_char((now() AT TIME ZONE s.timezone)::date, 'YYYY-MM-DD')     AS hari_ini,
             to_char((now() AT TIME ZONE s.timezone)::date - 1, 'YYYY-MM-DD') AS kemarin
      FROM streaks s WHERE s.user_id = ${USER}
    `.execute(db);
    const { hari_ini, kemarin } = t.rows[0]!;

    // KEMARIN lebih dulu: tanpa assert ini, `freeze_used_date IS NOT NULL`
    // sendirian akan lulus — dan setiap orang yang pernah memakai freeze akan
    // terlihat beku selamanya.
    await db
      .updateTable('streaks')
      .set({ freeze_used_date: kemarin })
      .where('user_id', '=', USER)
      .execute();
    expect((await hub.forUser(USER)).streak.freeze_used_today).toBe(false);

    await db
      .updateTable('streaks')
      .set({ freeze_used_date: hari_ini })
      .where('user_id', '=', USER)
      .execute();
    const h = await hub.forUser(USER);
    expect(h.streak.freeze_used_today).toBe(true);
    // Hari yang dibekukan tetap "belum aktif" secara harfiah, jadi KEDUANYA
    // true. Urutan presentasinya (frozen menang atas at_risk) keputusan klien;
    // server melaporkan dua fakta, bukan satu kesimpulan.
    expect(h.streak.at_risk_today).toBe(true);
  });

  it('saldo dan kartu berikutnya mencerminkan keadaan sungguhan', async () => {
    if (!reachable) return;
    await db
      .transaction()
      .execute((trx) => coins.write(trx, { userId: USER, entryType: 'adjust', amount: 150 }));

    const h = await hub.forUser(USER);
    expect(h.balance).toBe(150);
    // Tiga kartu berikutnya, urut sesuai sort_order.
    expect(h.next_cards).toHaveLength(3);
    expect(h.next_cards.map((c) => c.lesson_id)).toEqual([lessonId(0), lessonId(1), lessonId(2)]);
    expect(h.next_cards[0]!.track_title).toBe('Track Hub');
  });

  it('lesson yang SUDAH dikerjakan tidak disarankan lagi', async () => {
    if (!reachable) return;
    await db
      .insertInto('lesson_attempts')
      .values({
        user_id: USER,
        lesson_id: lessonId(0),
        attempt_date: sql`(now() AT TIME ZONE 'Asia/Jakarta')::date`,
        card_results: JSON.stringify([]),
        score: 100,
        points: 10,
        coins: 2,
        duration_ms: 1000,
      })
      .execute();

    const h = await hub.forUser(USER);
    expect(h.next_cards.map((c) => c.lesson_id)).toEqual([lessonId(1), lessonId(2), lessonId(3)]);
  });

  it('peringkat squad dihitung Postgres, bukan diurutkan di Node', async () => {
    if (!reachable) return;
    await db
      .insertInto('league_seasons')
      .values({
        id: SEASON,
        code: '2026-W40',
        starts_at: sql`now()`,
        ends_at: sql`now() + interval '7 days'`,
      })
      .execute();
    await db
      .insertInto('squads')
      .values({ id: SQUAD, name: 'Squad Hub', season_id: SEASON, max_members: 8 })
      .execute();
    // Poin per-pengguna ada di squad_members.weekly_points, BUKAN di
    // league_standings — tabel itu berkunci (season_id, squad_id) dan mencatat
    // peringkat SQUAD di liga, bukan peringkat orang di dalam squad.
    await db
      .insertInto('squad_members')
      .values([
        { squad_id: SQUAD, user_id: USER, weekly_points: 40 },
        { squad_id: SQUAD, user_id: TEMAN, weekly_points: 90 },
      ])
      .execute();

    const [a, b] = await Promise.all([hub.forUser(USER), hub.forUser(TEMAN)]);
    expect(b.squad?.rank, 'poin lebih tinggi harus peringkat 1').toBe(1);
    expect(a.squad?.rank).toBe(2);
    expect(a.squad?.members).toBe(2);
    expect(a.squad?.weekly_points).toBe(40);
    expect(a.squad?.name).toBe('Squad Hub');
  });

  // ── AC performa ─────────────────────────────────────────────────────────
  it('AC: p95 < 250 ms dengan 1.000 lesson_attempts milik pengguna itu', async () => {
    if (!reachable) return;

    // 1.000 attempt sungguhan. Angka ini yang ada di acceptance criteria, dan
    // membacanya dari kode tidak membuktikan apa pun — `next_cards` memakai
    // anti-join terhadap tabel ini, dan itu bagian yang paling mungkin melambat.
    // 1.000 attempt sungguhan, disebar ke 100 lesson x 10 hari.
    //
    // Dua batas nyata membentuk bentuk seed ini, dan keduanya baru ketahuan
    // saat dijalankan:
    //   - unique index harian (user_id, lesson_id, attempt_date) — satu
    //     attempt per lesson per hari, jadi 1.000 baris butuh >= 100 lesson
    //   - partisi lesson_attempts terbatas (2026-09 s.d. 2027-02); insert di
    //     luar rentang GAGAL, bukan jatuh ke partisi default
    await sql`
      INSERT INTO lessons (id, module_id, title, sort_order)
      SELECT gen_random_uuid(), ${MODUL}::uuid, 'Perf ' || i, 100 + i
      FROM generate_series(1, 100) i
    `.execute(db);

    await sql`
      INSERT INTO lesson_attempts (user_id, lesson_id, attempt_date, card_results, score, points, coins, duration_ms)
      SELECT ${USER}::uuid, l.id,
             (now() AT TIME ZONE 'Asia/Jakarta')::date - d,
             '[]'::jsonb, 100, 10, 2, 1000
      FROM (SELECT id FROM lessons WHERE title LIKE 'Perf %' LIMIT 100) l
      CROSS JOIN generate_series(0, 9) d
    `.execute(db);

    const jumlah = await sql<{ n: string }>`
      SELECT count(*)::text AS n FROM lesson_attempts WHERE user_id = ${USER}
    `.execute(db);
    expect(Number(jumlah.rows[0]!.n), 'seed performa tidak lengkap').toBe(1000);

    const n = 30;
    const ms: number[] = [];
    for (let i = 0; i < n; i++) {
      const t = performance.now();
      await hub.forUser(USER);
      ms.push(performance.now() - t);
    }
    ms.sort((a, b) => a - b);
    const p95 = ms[Math.ceil(0.95 * n) - 1]!;

    expect(p95, `p95 ${p95.toFixed(0)} ms — AC menuntut < 250 ms`).toBeLessThan(250);
  });
});
