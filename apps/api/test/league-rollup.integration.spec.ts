import { NotFoundException } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase, type DB } from '../src/infra/kysely';
import { LeagueRollupService, type Tier, geser } from '../src/workers';

/**
 * `Q-04` terhadap DATABASE NYATA — PRD §7 E5 `SQ-8` & `SQ-9`.
 *
 * Dua kalimat yang menentukan berkas ini:
 *
 * > **SQ-8** 20% teratas promosi, 20% terbawah degradasi. Gold tidak bisa
 * > promosi, Bronze tidak bisa degradasi.
 * > **SQ-9** Rollup idempoten — dijalankan dua kali tidak menggeser tier dua
 * > langkah.
 */

const URL_DEV = 'postgres://strive:strive_dev_only@localhost:55432/strive';
const url = process.env['DATABASE_URL_TEST'] ?? process.env['DATABASE_URL'] ?? URL_DEV;

const MUSIM = '2026-W40';
let db: Kysely<DB>;
let rollup: LeagueRollupService;
let reachable = false;
let seasonId: string;

/** Membuat `n` squad di `tier`, poin menurun: squad ke-0 paling tinggi. */
async function squads(tier: Tier, n: number, awal = 1000): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const s = await db
      .insertInto('squads')
      .values({ name: `${tier}-${i}`, season_id: seasonId, league_tier: tier })
      .returning('id')
      .executeTakeFirstOrThrow();
    ids.push(s.id);

    const u = await db
      .insertInto('users')
      .values({ email: `q04-${tier}-${i}@uji.test`, display_name: `U${i}` })
      .returning('id')
      .executeTakeFirstOrThrow();
    await db
      .insertInto('squad_members')
      .values({ squad_id: s.id, user_id: u.id, weekly_points: awal - i * 10 })
      .execute();
  }
  return ids;
}

const tierOf = async (id: string) =>
  (
    await db
      .selectFrom('squads')
      .select('league_tier')
      .where('id', '=', id)
      .executeTakeFirstOrThrow()
  ).league_tier;

const standing = async (id: string) =>
  db
    .selectFrom('league_standings')
    .select(['tier', 'points', 'rank', 'outcome'])
    .where('squad_id', '=', id)
    .executeTakeFirst();

beforeAll(async () => {
  db = createDatabase(url);
  rollup = new LeagueRollupService(db);
  try {
    await db.selectFrom('league_seasons').select('id').limit(1).execute();
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
  await sql`TRUNCATE users, league_seasons RESTART IDENTITY CASCADE`.execute(db);
  const s = await db
    .insertInto('league_seasons')
    .values({
      code: MUSIM,
      starts_at: sql`now() - interval '8 days'`,
      ends_at: sql`now() - interval '1 day'`,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  seasonId = s.id;
});

describe('Q-04 — rollup liga (database nyata)', () => {
  it('database siap dipakai', () => {
    expect(reachable, `DATABASE_URL tidak bisa dipakai (${url})`).toBe(true);
  });

  // ── SQ-8 ───────────────────────────────────────────────────────────────

  it('AC: 20% teratas promosi, 20% terbawah degradasi', async () => {
    if (!reachable) return;
    const s = await squads('silver', 10); // kuota = floor(10 × 0,2) = 2

    const r = await rollup.closeSeason(MUSIM);
    expect(r).toMatchObject({ closed: true, promoted: 2, relegated: 2, stayed: 6 });

    expect(await tierOf(s[0]!)).toBe('gold');
    expect(await tierOf(s[1]!)).toBe('gold');
    expect(await tierOf(s[2]!), 'squad ke-3 ikut promosi — kuota bocor').toBe('silver');
    expect(await tierOf(s[7]!)).toBe('silver');
    expect(await tierOf(s[8]!)).toBe('bronze');
    expect(await tierOf(s[9]!)).toBe('bronze');
  });

  it('AC: Gold tidak bisa promosi, Bronze tidak bisa degradasi', async () => {
    if (!reachable) return;
    const g = await squads('gold', 10);
    const b = await squads('bronze', 10, 500);

    await rollup.closeSeason(MUSIM);

    // Puncak Gold tetap Gold — tidak ada tier di atasnya.
    expect(await tierOf(g[0]!)).toBe('gold');
    expect((await standing(g[0]!))?.outcome).toBe('stayed');
    // Dasar Gold TETAP turun: yang dilarang cuma promosinya.
    expect(await tierOf(g[9]!)).toBe('silver');

    // Dasar Bronze tetap Bronze.
    expect(await tierOf(b[9]!)).toBe('bronze');
    expect((await standing(b[9]!))?.outcome).toBe('stayed');
    // Puncak Bronze TETAP naik.
    expect(await tierOf(b[0]!)).toBe('silver');
  });

  it('peringkat dihitung PER TIER, bukan lintas seluruh liga', async () => {
    if (!reachable) return;
    // Squad Bronze terbaik (500) berpoin JAUH di bawah squad Silver terburuk
    // (910). Kalau peringkatnya lintas-liga, tidak ada satu pun Bronze yang
    // promosi — dan tier berhenti berarti "lawan yang setara".
    const silver = await squads('silver', 10, 1000);
    const bronze = await squads('bronze', 10, 500);

    await rollup.closeSeason(MUSIM);

    expect(await tierOf(bronze[0]!), 'Bronze terbaik tidak promosi').toBe('silver');
    expect(await tierOf(silver[9]!)).toBe('bronze');
  });

  it('liga terlalu kecil: kuota NOL, tidak ada yang bergerak', async () => {
    if (!reachable) return;
    // floor(4 × 0,2) = 0. Membulatkan ke ATAS akan memindahkan satu squad
    // setiap minggu di liga kecil, dan tier berhenti berarti apa-apa.
    const s = await squads('silver', 4);

    const r = await rollup.closeSeason(MUSIM);
    expect(r).toMatchObject({ promoted: 0, relegated: 0, stayed: 4 });
    for (const id of s) expect(await tierOf(id)).toBe('silver');
  });

  it('satu squad sendirian tidak promosi DAN degradasi sekaligus', async () => {
    if (!reachable) return;
    const s = await squads('silver', 1);
    const r = await rollup.closeSeason(MUSIM);

    expect(r.promoted + r.relegated).toBe(0);
    expect(await tierOf(s[0]!)).toBe('silver');
  });

  // ── SQ-9: idempotensi, inti acceptance criteria ────────────────────────

  it('AC: dijalankan DUA KALI tidak menggeser tier dua langkah', async () => {
    if (!reachable) return;
    const s = await squads('silver', 10);

    await rollup.closeSeason(MUSIM);
    expect(await tierOf(s[0]!)).toBe('gold');
    expect(await tierOf(s[9]!)).toBe('bronze');

    const kedua = await rollup.closeSeason(MUSIM);

    expect(kedua.closed, 'musim ditutup untuk kedua kalinya').toBe(false);
    // Tanpa klaim `closed_at`, yang ini jadi `gold` → sudah di puncak, jadi
    // gejalanya tersembunyi. Yang bawah yang membongkarnya: `bronze` dua kali
    // akan tetap `bronze` juga. Yang benar-benar menggigit squad TENGAH.
    expect(await tierOf(s[0]!)).toBe('gold');
    expect(await tierOf(s[9]!)).toBe('bronze');
    // Jumlahnya tetap terbaca dari `league_standings`, bukan nol.
    expect(kedua).toMatchObject({ promoted: 2, relegated: 2, stayed: 6 });
  });

  it('idempotensi menggigit di squad TENGAH, bukan cuma di ujung', async () => {
    if (!reachable) return;
    // 15 squad Silver, kuota 3. Yang di peringkat 3 (indeks 2) `stayed`.
    // Kalau rollup jalan dua kali TANPA penjaga, peringkat berubah karena
    // tier-nya berubah, dan squad tengah bisa ikut bergeser.
    const s = await squads('silver', 15);
    await rollup.closeSeason(MUSIM);
    const sebelum = await Promise.all(s.map(tierOf));

    await rollup.closeSeason(MUSIM);
    const sesudah = await Promise.all(s.map(tierOf));

    expect(sesudah).toEqual(sebelum);
  });

  it('dua rollup BERSAMAAN: hanya satu yang menutup', async () => {
    if (!reachable) return;
    const s = await squads('silver', 10);

    const [a, b] = await Promise.all([rollup.closeSeason(MUSIM), rollup.closeSeason(MUSIM)]);

    // `UPDATE … WHERE closed_at IS NULL RETURNING` yang menjaminnya —
    // memeriksa `closed_at` lebih dulu lalu menutup membiarkan KEDUANYA
    // lolos di celah antara baca dan tulis.
    expect([a.closed, b.closed].filter(Boolean), 'dua rollup sama-sama menutup').toHaveLength(1);
    expect(await tierOf(s[0]!)).toBe('gold');
    expect(await tierOf(s[9]!)).toBe('bronze');
  });

  // ── Jejak di league_standings ──────────────────────────────────────────

  it('standing menyimpan tier SAAT musim berjalan, bukan hasilnya', async () => {
    if (!reachable) return;
    const s = await squads('silver', 10);
    await rollup.closeSeason(MUSIM);

    const st = await standing(s[0]!);
    // Squad ini sekarang Gold. Tapi ia BERMAIN di Silver, dan riwayat yang
    // menulis "juara Gold" untuk musim itu adalah riwayat yang berbohong.
    expect(st?.tier).toBe('silver');
    expect(st?.outcome).toBe('promoted');
    expect(st?.rank).toBe(1);
    expect(st?.points).toBe(1000);
    expect(await tierOf(s[0]!)).toBe('gold');
  });

  it('poin squad tidak memuat anggota yang sudah keluar (SQ-10)', async () => {
    if (!reachable) return;
    const s = await squads('silver', 4);
    const keluar = await db
      .insertInto('users')
      .values({ email: 'q04-keluar@uji.test', display_name: 'Keluar' })
      .returning('id')
      .executeTakeFirstOrThrow();
    await db
      .insertInto('squad_members')
      .values({
        squad_id: s[3]!,
        user_id: keluar.id,
        weekly_points: 99_999,
        left_at: sql`now()`,
      })
      .execute();

    await rollup.closeSeason(MUSIM);

    // Kalau `left_at` diabaikan, squad terakhir jadi juara dengan poin orang
    // yang sudah pergi — eksploitasi yang persis dicegah §5 Q5.
    expect((await standing(s[3]!))?.points).toBe(970);
  });

  it('squad tanpa anggota aktif berpoin 0 dan jadi juru kunci, bukan hilang', async () => {
    if (!reachable) return;
    const s = await squads('silver', 4);
    const kosong = await db
      .insertInto('squads')
      .values({ name: 'kosong', season_id: seasonId, league_tier: 'silver' })
      .returning('id')
      .executeTakeFirstOrThrow();

    const r = await rollup.closeSeason(MUSIM);

    // `LEFT JOIN`, bukan `JOIN`: squad tanpa anggota aktif tetap ada, dan
    // menghilangkannya dari peringkat mengubah PEMBAGI kuota 20% — squad
    // lain ikut salah nasib karenanya.
    expect(r.promoted + r.relegated + r.stayed, 'squad kosong hilang dari peringkat').toBe(5);
    expect((await standing(kosong.id))?.points).toBe(0);
    expect((await standing(kosong.id))?.rank, 'squad berpoin 0 bukan juru kunci').toBe(5);
    // Kuota floor(5 × 0,2) = 1: satu naik, satu turun — dan yang turun
    // harusnya si kosong, bukan squad berpoin sungguhan.
    expect((await standing(s[3]!))?.outcome).toBe('stayed');
    expect((await standing(kosong.id))?.outcome).toBe('relegated');
  });

  // ── Penjadwalan ────────────────────────────────────────────────────────

  it('`run()` menutup musim yang sudah lewat, tertua dulu', async () => {
    if (!reachable) return;
    await squads('silver', 10);
    await db
      .insertInto('league_seasons')
      .values({
        code: '2026-W39',
        starts_at: sql`now() - interval '15 days'`,
        ends_at: sql`now() - interval '8 days'`,
      })
      .execute();

    const hasil = await rollup.run();
    expect(
      hasil.map((h) => h.seasonCode),
      'musim tertua tidak ditutup lebih dulu',
    ).toEqual(['2026-W39', MUSIM]);
  });

  it('musim yang BELUM berakhir tidak ikut ditutup', async () => {
    if (!reachable) return;
    await db
      .updateTable('league_seasons')
      .set({ ends_at: sql`now() + interval '3 days'` })
      .where('code', '=', MUSIM)
      .execute();

    expect(await rollup.seasonsSiapDitutup()).toEqual([]);
    expect(await rollup.run()).toEqual([]);
  });

  it('musim yang tidak ada → NOT_FOUND', async () => {
    if (!reachable) return;
    await expect(rollup.closeSeason('2026-W99')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('geser() — batas tier SQ-8', () => {
  it('dijepit di kedua ujung', () => {
    expect(geser('gold', 'promoted')).toBe('gold');
    expect(geser('bronze', 'relegated')).toBe('bronze');
    expect(geser('silver', 'promoted')).toBe('gold');
    expect(geser('silver', 'relegated')).toBe('bronze');
    expect(geser('silver', 'stayed')).toBe('silver');
  });
});
