import type Redis from 'ioredis';
import { Kysely, sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase, type DB } from '../src/infra/kysely';
import { createRedis } from '../src/infra/redis';
import { LeaderboardService, LB_TTL_SECONDS, squadKey } from '../src/modules/league';

/**
 * `Q-02` terhadap **Redis dan Postgres sungguhan**.
 *
 * AC-nya menyebutkan caranya harfiah: *"Redis di-FLUSHALL lalu papan pulih
 * otomatis pada request berikutnya, dengan angka identik dengan sebelum
 * dihapus."*
 *
 * Itu tidak bisa dibuktikan dengan mock. Mock Redis akan selalu "pulih" —
 * karena datanya memang tidak pernah benar-benar hilang.
 */

const URL_DEV = 'postgres://strive:strive_dev_only@localhost:55432/strive';
const url = process.env['DATABASE_URL_TEST'] ?? process.env['DATABASE_URL'] ?? URL_DEV;
const redisUrl = process.env['REDIS_URL'] ?? 'redis://127.0.0.1:56379';

let db: Kysely<DB>;
let redis: Redis;
let lb: LeaderboardService;
let reachable = false;

const SEASON = '00000000-0000-4000-8000-0000000q0201'.replace('q', 'a');
const SQUAD = '00000000-0000-4000-8000-0000000q0202'.replace('q', 'a');
const uid = (n: number) =>
  `00000000-0000-4000-8000-0000000q02${String(n).padStart(2, '0')}`.replace('q', 'b');

beforeAll(async () => {
  db = createDatabase(url);
  redis = createRedis(redisUrl);
  lb = new LeaderboardService(db, redis);
  try {
    await db.selectFrom('squads').select('id').limit(1).execute();
    await redis.ping();
    reachable = true;
  } catch {
    reachable = false;
  }
});

afterAll(async () => {
  if (db) await db.destroy();
  if (redis) redis.disconnect();
});

beforeEach(async () => {
  if (!reachable) return;
  await sql`TRUNCATE users, league_seasons, squads RESTART IDENTITY CASCADE`.execute(db);
  await redis.del(squadKey(SEASON, SQUAD));

  await db
    .insertInto('league_seasons')
    .values({
      id: SEASON,
      code: '2026-W41',
      starts_at: sql`now()`,
      ends_at: sql`now() + interval '7 days'`,
    })
    .execute();
  await db
    .insertInto('squads')
    .values({ id: SQUAD, name: 'Squad LB', season_id: SEASON, max_members: 8 })
    .execute();
  await db
    .insertInto('users')
    .values(
      Array.from({ length: 4 }, (_, i) => ({
        id: uid(i),
        email: `lb${i}@uji.test`,
        display_name: `U${i}`,
      })),
    )
    .execute();
  await db
    .insertInto('squad_members')
    .values([
      { squad_id: SQUAD, user_id: uid(0), weekly_points: 30 },
      { squad_id: SQUAD, user_id: uid(1), weekly_points: 90 },
      { squad_id: SQUAD, user_id: uid(2), weekly_points: 60 },
      { squad_id: SQUAD, user_id: uid(3), weekly_points: 0 },
    ])
    .execute();
});

describe('LeaderboardService (Redis + Postgres nyata)', () => {
  it('Redis dan database siap dipakai', () => {
    expect(reachable, `DATABASE_URL (${url}) atau REDIS_URL (${redisUrl}) tidak bisa dipakai`).toBe(
      true,
    );
  });

  it('papan terurut dari poin tertinggi, dengan peringkat', async () => {
    if (!reachable) return;
    const board = await lb.squadBoard(SEASON, SQUAD);

    expect(board.map((r) => r.user_id)).toEqual([uid(1), uid(2), uid(0), uid(3)]);
    expect(board.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
    expect(board[0]).toMatchObject({ points: 90, rank: 1 });
  });

  // ── AC harfiah ──────────────────────────────────────────────────────────
  it('AC: FLUSHALL lalu papan pulih otomatis dengan angka IDENTIK', async () => {
    if (!reachable) return;

    const sebelum = await lb.squadBoard(SEASON, SQUAD);
    expect(await redis.exists(squadKey(SEASON, SQUAD))).toBe(1);

    // Bukan `del` satu kunci — FLUSHALL, persis kata AC-nya. Kehilangan
    // Redis SELURUHNYA bukan insiden (aturan 7), dan itulah yang diuji.
    await redis.flushall();
    expect(await redis.exists(squadKey(SEASON, SQUAD))).toBe(0);

    // Tidak ada langkah "rebuild dulu". Pemanggil berikutnya tidak perlu tahu
    // Redis baru saja kosong — jalur kode seperti itu pasti ada yang lupa
    // memanggilnya.
    const sesudah = await lb.squadBoard(SEASON, SQUAD);

    expect(sesudah).toEqual(sebelum);
  });

  it('kunci punya TTL — kunci musim lama kedaluwarsa sendiri, tidak dihapus manual (SQ-5)', async () => {
    if (!reachable) return;
    await lb.squadBoard(SEASON, SQUAD);

    const ttl = await redis.ttl(squadKey(SEASON, SQUAD));
    expect(ttl, 'kunci tanpa TTL akan menumpuk selamanya, satu per musim').toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(LB_TTL_SECONDS);
  });

  it('kunci dirotasi per musim, bukan di-reset — dua musim hidup bersamaan', async () => {
    if (!reachable) return;
    const SEASON2 = SEASON.replace(/1$/, '9');
    await db
      .insertInto('league_seasons')
      .values({
        id: SEASON2,
        code: '2026-W42',
        starts_at: sql`now() + interval '7 days'`,
        ends_at: sql`now() + interval '14 days'`,
      })
      .execute();

    await lb.squadBoard(SEASON, SQUAD);
    await lb.rebuildSquad(SEASON2, SQUAD);

    // Musim lama TIDAK terhapus saat musim baru dibangun. Kalau kuncinya
    // di-reset alih-alih dirotasi, riwayat musim berjalan hilang saat pergantian.
    expect(await redis.exists(squadKey(SEASON, SQUAD))).toBe(1);
  });

  /**
   * Menaikkan `weekly_points` di Postgres PERSIS seperti `L-03`: di transaksi
   * yang sama dengan event outbox-nya, SEBELUM worker menyentuh Redis.
   *
   * Test `bump()` versi `Q-02` tidak melakukan ini — ia memanggil `bump(+15)`
   * atas Postgres yang masih 30 — jadi ia menguji dunia yang urutannya tidak
   * pernah ada, dan lulus untuk kode yang menghitung poin dua kali.
   */
  async function seperti_L03(n: number, tambah: number) {
    await db
      .updateTable('squad_members')
      .set({ weekly_points: sql`weekly_points + ${tambah}` })
      .where('user_id', '=', uid(n))
      .where('left_at', 'is', null)
      .execute();
  }

  it('syncMember setelah Redis KOSONG: poin TIDAK terhitung dua kali', async () => {
    if (!reachable) return;
    await redis.flushall();
    await seperti_L03(0, 15); // Postgres sekarang 45 — sudah memuat event ini

    await lb.syncMember(SEASON, SQUAD, uid(0));

    const board = await lb.squadBoard(SEASON, SQUAD);
    // `bump(+15)` di sini menghasilkan 60: rebuild membaca 45, lalu ZINCRBY
    // menambah 15 lagi.
    expect(board.find((r) => r.user_id === uid(0))?.points, 'poin dihitung dua kali').toBe(45);
    expect(board, 'anggota lain hilang — papan setengah jadi').toHaveLength(4);
  });

  it('syncMember IDEMPOTEN — PRD §8.3: at-least-once, konsumen wajib idempoten', async () => {
    if (!reachable) return;
    await lb.squadBoard(SEASON, SQUAD); // kunci sudah ada
    await seperti_L03(0, 15);

    // Worker yang mati setelah menulis Redis tapi sebelum menandai event
    // selesai akan memprosesnya LAGI. Hasilnya tidak boleh berubah.
    for (let i = 0; i < 3; i++) await lb.syncMember(SEASON, SQUAD, uid(0));

    const board = await lb.squadBoard(SEASON, SQUAD);
    expect(board.find((r) => r.user_id === uid(0))?.points).toBe(45);
  });

  it('anggota yang keluar SETELAH event ditulis dihapus dari papan', async () => {
    if (!reachable) return;
    await lb.squadBoard(SEASON, SQUAD);
    await db
      .updateTable('squad_members')
      .set({ left_at: sql`now()` })
      .where('user_id', '=', uid(2))
      .execute();

    await lb.syncMember(SEASON, SQUAD, uid(2));

    const board = await lb.squadBoard(SEASON, SQUAD);
    expect(board.find((r) => r.user_id === uid(2))).toBeUndefined();
  });

  it('poin selalu integer di respons, meski skor Redis bertipe double', async () => {
    if (!reachable) return;
    await seperti_L03(3, 7);
    await lb.syncMember(SEASON, SQUAD, uid(3));
    const board = await lb.squadBoard(SEASON, SQUAD);
    for (const r of board) {
      expect(Number.isInteger(r.points), `poin ${r.points} bukan integer`).toBe(true);
    }
  });

  it('anggota yang sudah keluar tidak ikut di papan', async () => {
    if (!reachable) return;
    await db
      .updateTable('squad_members')
      .set({ left_at: sql`now()` })
      .where('user_id', '=', uid(1))
      .execute();
    await redis.flushall();

    const board = await lb.squadBoard(SEASON, SQUAD);
    expect(board.map((r) => r.user_id)).not.toContain(uid(1));
    expect(board).toHaveLength(3);
  });

  it('squad tanpa anggota: papan kosong, bukan error', async () => {
    if (!reachable) return;
    await db.deleteFrom('squad_members').where('squad_id', '=', SQUAD).execute();
    await redis.flushall();
    expect(await lb.squadBoard(SEASON, SQUAD)).toEqual([]);
  });
});
