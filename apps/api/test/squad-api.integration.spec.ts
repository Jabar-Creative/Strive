import Redis from 'ioredis';
import { Kysely, sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { createDatabase, type DB } from '../src/infra/kysely';
import { KyselyModule } from '../src/infra/kysely';
import { RedisModule } from '../src/infra/redis';
import { SquadModule } from '../src/modules/squad';

/**
 * `Q-06` terhadap PostgreSQL + Redis NYATA, lewat HTTP.
 *
 * AC-nya menyebut satu batas secara harfiah:
 *
 *   "anggota squad lain tidak bisa membaca papan squad yang bukan miliknya
 *    lewat `:id` tebakan"
 *
 * Itu **kepemilikan**, bukan peran — dan `RolesGuard` tidak tahu apa-apa soal
 * keanggotaan (PRD §2.5). Diuji lewat HTTP, bukan lewat service, karena yang
 * dijaga adalah rutenya: service yang benar di belakang controller yang lupa
 * memanggilnya tetap bocor.
 *
 * Sesi disisipkan LANGSUNG ke tabel `sessions`. Yang diuji rute squad, bukan
 * Argon2id — melewati registrasi sungguhan menghemat ~50 ms hashing per
 * pengguna dan tidak mengubah apa pun yang diukur (`SessionGuard` hanya
 * mencocokkan `sessions.token`).
 */

const URL_DEV = 'postgres://strive:strive_dev_only@localhost:55432/strive';
const url = process.env['DATABASE_URL_TEST'] ?? process.env['DATABASE_URL'] ?? URL_DEV;
const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:56379';

const uuid = (n: number) =>
  `00000000-0000-4000-8000-q06${String(n).padStart(9, '0')}`.replace('q06', 'a06');

const SEASON = uuid(1);
const SQUAD_A = uuid(2);
const SQUAD_B = uuid(3);
/** Anggota SQUAD_A, poin 50 · 50 · 10 — dua teratas SERI, sengaja. */
const A1 = uuid(11);
const A2 = uuid(12);
const A3 = uuid(13);
/** Anggota SQUAD_B — ia yang mencoba mengintip papan SQUAD_A. */
const B1 = uuid(21);
/** Mentor SQUAD_A, dan mentor yang BUKAN mentor SQUAD_A. */
const MENTOR_A = uuid(31);
const MENTOR_LAIN = uuid(32);
/** Tidak punya squad sama sekali. */
const SENDIRIAN = uuid(41);

const token = (id: string) => `q06-${id.slice(-6)}`;

let db: Kysely<DB>;
let redis: Redis;
let app: INestApplication;
let base: string;
let reachable = false;

async function get(path: string, sebagai?: string) {
  return fetch(`${base}${path}`, {
    headers: sebagai ? { authorization: `Bearer ${token(sebagai)}` } : {},
  });
}

beforeAll(async () => {
  db = createDatabase(url);
  redis = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
  try {
    await db.selectFrom('squads').select('id').limit(1).execute();
    await redis.connect();
    await redis.ping();
    reachable = true;
  } catch {
    reachable = false;
    return;
  }

  process.env['DATABASE_URL'] = url;
  const moduleRef = await Test.createTestingModule({
    imports: [KyselyModule, RedisModule, SquadModule],
  }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });
  const server = await app.listen(0);
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('tidak mendapat port listen');
  base = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  if (app) await app.close();
  if (redis) redis.disconnect();
  if (db) await db.destroy();
});

beforeEach(async () => {
  if (!reachable) return;
  await sql`TRUNCATE users, league_seasons, squads RESTART IDENTITY CASCADE`.execute(db);
  await redis.flushall();

  await db
    .insertInto('users')
    .values([
      { id: A1, email: 'q06a1@uji.test', display_name: 'Ayu' },
      { id: A2, email: 'q06a2@uji.test', display_name: 'Budi' },
      { id: A3, email: 'q06a3@uji.test', display_name: 'Citra' },
      { id: B1, email: 'q06b1@uji.test', display_name: 'Dewi' },
      {
        id: MENTOR_A,
        email: 'q06m1@uji.test',
        display_name: 'Mentor A',
        role: 'mentor',
      },
      {
        id: MENTOR_LAIN,
        email: 'q06m2@uji.test',
        display_name: 'Mentor Lain',
        role: 'mentor',
      },
      { id: SENDIRIAN, email: 'q06s@uji.test', display_name: 'Sendirian' },
    ])
    .execute();

  await db
    .insertInto('sessions')
    .values(
      [A1, A2, A3, B1, MENTOR_A, MENTOR_LAIN, SENDIRIAN].map((id) => ({
        user_id: id,
        token: token(id),
        expires_at: sql`now() + interval '1 day'`,
      })),
    )
    .execute();

  await db
    .insertInto('league_seasons')
    .values({
      id: SEASON,
      code: '2026-W38',
      starts_at: sql`now()`,
      ends_at: sql`now() + interval '7 days'`,
    })
    .execute();

  await db
    .insertInto('squads')
    .values([
      {
        id: SQUAD_A,
        name: 'Alfa',
        season_id: SEASON,
        max_members: 8,
        mentor_id: MENTOR_A,
        league_tier: 'silver',
      },
      { id: SQUAD_B, name: 'Beta', season_id: SEASON, max_members: 8, mentor_id: MENTOR_LAIN },
    ])
    .execute();

  await db
    .insertInto('squad_members')
    .values([
      { squad_id: SQUAD_A, user_id: A1, weekly_points: 50 },
      { squad_id: SQUAD_A, user_id: A2, weekly_points: 50 },
      { squad_id: SQUAD_A, user_id: A3, weekly_points: 10 },
      { squad_id: SQUAD_B, user_id: B1, weekly_points: 99 },
    ])
    .execute();
});

describe('GET /squads/me (Q-06)', () => {
  it('database dan Redis siap dipakai', () => {
    expect(reachable, `DATABASE_URL / REDIS_URL tidak bisa dipakai (${url})`).toBe(true);
  });

  it('AC: mengembalikan squad, anggota, poin mingguan, dan tier', async () => {
    if (!reachable) return;
    const res = await get('/api/v1/squads/me', A3);
    expect(res.status).toBe(200);

    const { squad: b } = (await res.json()) as {
      squad: {
        squad_id: string;
        name: string;
        tier: string;
        season: { code: string };
        members: { display_name: string; weekly_points: number; rank: number }[];
        me: { rank: number; weekly_points: number };
      };
    };

    expect(b.squad_id).toBe(SQUAD_A);
    expect(b.name).toBe('Alfa');
    expect(b.tier).toBe('silver');
    expect(b.season.code).toBe('2026-W38');
    expect(b.members).toHaveLength(3);
    // Posisi si pemanggil ikut, supaya UI tidak perlu mencarinya di daftar.
    expect(b.me).toEqual({ rank: 3, weekly_points: 10 });
  });

  it('peringkat SERI berbagi angka — RANK(), bukan ROW_NUMBER()', async () => {
    if (!reachable) return;
    // Ayu dan Budi sama-sama 50. ROW_NUMBER akan menempatkan salah satunya di
    // atas berdasarkan urutan baris — perbedaan yang tidak ada dasarnya tapi
    // terlihat nyata di layar, dan berubah-ubah tiap query.
    const { squad: b } = (await (await get('/api/v1/squads/me', A1)).json()) as {
      squad: { members: { display_name: string; rank: number }[] };
    };
    const rank = Object.fromEntries(b.members.map((m) => [m.display_name, m.rank]));
    expect(rank['Ayu']).toBe(1);
    expect(rank['Budi']).toBe(1);
    expect(rank['Citra'], 'peringkat setelah seri harus melompat ke 3').toBe(3);
  });

  it('pengguna tanpa squad dapat `null`, BUKAN 404', async () => {
    if (!reachable) return;
    // Pengguna baru memang belum punya squad — dibentuk job mingguan (Q-01),
    // bukan saat registrasi. 404 akan membuat layar Hub menampilkan galat di
    // hari pertama seseorang memakai produk ini.
    const res = await get('/api/v1/squads/me', SENDIRIAN);
    expect(res.status).toBe(200);
    // Dibungkus `{ squad }`: handler yang mengembalikan `null` telanjang
    // mengirim body KOSONG, dan `.json()` melempar di peramban juga.
    expect(await res.json()).toEqual({ squad: null });
  });

  it('tanpa sesi ditolak 401', async () => {
    if (!reachable) return;
    expect((await get('/api/v1/squads/me')).status).toBe(401);
  });
});

describe('GET /squads/:id/leaderboard (Q-06)', () => {
  it('anggota bisa membaca papan squadnya sendiri, terurut dan berperingkat', async () => {
    if (!reachable) return;
    const res = await get(`/api/v1/squads/${SQUAD_A}/leaderboard`, A1);
    expect(res.status).toBe(200);

    const b = (await res.json()) as { display_name: string; weekly_points: number; rank: number }[];
    expect(b).toHaveLength(3);
    expect(b[0]!.weekly_points).toBe(50);
    // Seri juga berbagi peringkat di jalur Redis — sama dengan /squads/me.
    expect(b.map((x) => x.rank)).toEqual([1, 1, 3]);
    expect(b[2]!.display_name).toBe('Citra');
    expect(b[2]!.weekly_points).toBe(10);
  });

  // ── AC INTI ─────────────────────────────────────────────────────────────

  it('AC: anggota squad LAIN tidak bisa membaca lewat `:id` tebakan', async () => {
    if (!reachable) return;
    // Dewi anggota Beta. Ia punya sesi yang sah dan peran yang benar — guard
    // meloloskannya. Yang menahannya kepemilikan, dicek di service.
    const res = await get(`/api/v1/squads/${SQUAD_A}/leaderboard`, B1);
    expect(res.status, 'papan squad lain bisa dibaca dengan menebak id').toBe(403);

    const b = (await res.json()) as { error: { code: string } };
    expect(b.error.code).toBe('FORBIDDEN_ROLE');
  });

  it('AC: pengguna tanpa squad sama sekali juga ditolak', async () => {
    if (!reachable) return;
    expect((await get(`/api/v1/squads/${SQUAD_A}/leaderboard`, SENDIRIAN)).status).toBe(403);
  });

  it('squad yang tidak ada → 404, bukan 403', async () => {
    if (!reachable) return;
    // Bedanya berguna: 403 atas id yang tidak ada akan membuat orang mengira
    // squad itu ada dan ia tidak diizinkan.
    const res = await get(`/api/v1/squads/${uuid(999)}/leaderboard`, A1);
    expect(res.status).toBe(404);
  });

  // ── PR-7: mentor hanya melihat squad binaannya ──────────────────────────

  it('PR-7: mentor BISA membaca papan squad yang dibinanya', async () => {
    if (!reachable) return;
    const res = await get(`/api/v1/squads/${SQUAD_A}/leaderboard`, MENTOR_A);
    expect(res.status, 'mentor tidak bisa melihat squad binaannya sendiri').toBe(200);
    expect((await res.json()) as unknown[]).toHaveLength(3);
  });

  it('PR-7: mentor TIDAK bisa membaca papan squad yang bukan binaannya', async () => {
    if (!reachable) return;
    // Peran `mentor` saja tidak cukup — PRD §7 E11 PR-7 menyebutnya harfiah.
    expect((await get(`/api/v1/squads/${SQUAD_A}/leaderboard`, MENTOR_LAIN)).status).toBe(403);
  });

  // ── Aturan keras 7: Redis turunan, selalu bisa dibangun ulang ───────────

  it('ATURAN 7: FLUSHALL lalu papan pulih sendiri dengan angka IDENTIK', async () => {
    if (!reachable) return;
    const sebelum = (await (await get(`/api/v1/squads/${SQUAD_A}/leaderboard`, A1)).json()) as {
      user_id: string;
      weekly_points: number;
      rank: number;
    }[];
    expect(sebelum).toHaveLength(3);

    // Kehilangan Redis BUKAN insiden (CLAUDE.md aturan 7). Tidak ada jalur
    // "tolong rebuild dulu" yang harus dipanggil — kalau ada, pasti ada yang
    // lupa memanggilnya.
    await redis.flushall();

    const sesudah = (await (await get(`/api/v1/squads/${SQUAD_A}/leaderboard`, A1)).json()) as {
      user_id: string;
      weekly_points: number;
      rank: number;
    }[];
    expect(sesudah, 'papan tidak pulih setelah FLUSHALL').toEqual(sebelum);
  });

  it('kedua rute sepakat: Postgres dan Redis memberi angka yang sama', async () => {
    if (!reachable) return;
    // `/squads/me` membaca PostgreSQL (pemilik), `/leaderboard` membaca ZSET
    // Redis (pelayan). Kalau keduanya menyimpang, salah satunya berbohong —
    // dan pengguna akan melihat dua angka berbeda di layar yang sama.
    await redis.flushall();
    const { squad: me } = (await (await get('/api/v1/squads/me', A1)).json()) as {
      squad: { members: { user_id: string; weekly_points: number; rank: number }[] };
    };
    const papan = (await (await get(`/api/v1/squads/${SQUAD_A}/leaderboard`, A1)).json()) as {
      user_id: string;
      weekly_points: number;
      rank: number;
    }[];

    // PERINGKAT ikut dibandingkan, bukan cuma poin. Tanpa itu, peringkat
    // posisional dari ZSET vs RANK() Postgres akan menyimpang saat seri dan
    // testnya tetap hijau — pengguna melihat dua angka berbeda di layar yang
    // sama.
    const ringkas = (x: { user_id: string; weekly_points: number; rank: number }[]) =>
      [...x].map((y) => [y.user_id, y.weekly_points, y.rank]).sort();
    expect(ringkas(papan)).toEqual(ringkas(me.members));
  });

  it('PRD §10.3: header Cache-Control max-age=30, dan `private`', async () => {
    if (!reachable) return;
    const res = await get(`/api/v1/squads/${SQUAD_A}/leaderboard`, A1);
    const cc = res.headers.get('cache-control') ?? '';
    expect(cc).toContain('max-age=30');
    // `private`, bukan `public`: isinya bergantung siapa yang bertanya, jadi
    // proxy bersama tidak boleh menyimpannya untuk orang berikutnya.
    expect(cc, 'papan squad di-cache proxy bersama').toContain('private');
  });

  it('squad tanpa musim ditolak eksplisit, bukan dijawab papan kosong', async () => {
    if (!reachable) return;
    // `squads.season_id` NULLABLE sejak migrasi 001 (isu #84). Papan kosong
    // terbaca "belum ada yang berpoin minggu ini" dan menyembunyikan keadaan
    // data yang seharusnya tidak pernah ada.
    await db.updateTable('squads').set({ season_id: null }).where('id', '=', SQUAD_A).execute();

    const res = await get(`/api/v1/squads/${SQUAD_A}/leaderboard`, A1);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});
