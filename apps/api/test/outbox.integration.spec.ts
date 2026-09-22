import type Redis from 'ioredis';
import { Kysely, sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase, type DB } from '../src/infra/kysely';
import { createRedis } from '../src/infra/redis';
import { LeaderboardService, squadKey } from '../src/modules/league';
import { MAX_ATTEMPTS, OutboxWorkerService } from '../src/workers';

/**
 * `Q-03` terhadap DATABASE dan REDIS NYATA — PRD §8.3 aturan 3.
 *
 * Dua acceptance criteria:
 *   1. Dua instance worker paralel tidak memproses event yang sama.
 *   2. Event gagal 5× masuk `audit_log`, dan antrean tidak macet.
 *
 * Yang pertama diuji dengan tumpang tindih yang DIPAKSA — handler menahan
 * sampai gerbang dibuka — bukan dengan menembak dua `runOnce()` bersamaan.
 * Yang terakhir itu jebakan yang sudah tercatat di CLAUDE.md: koneksi baru
 * berdiri pada waktu berbeda, transaksinya praktis berurutan, dan test lulus
 * bahkan tanpa penguncian sama sekali.
 */

const URL_DEV = 'postgres://strive:strive_dev_only@localhost:55432/strive';
const url = process.env['DATABASE_URL_TEST'] ?? process.env['DATABASE_URL'] ?? URL_DEV;
const redisUrl = process.env['REDIS_URL'] ?? 'redis://127.0.0.1:56379';

const AKU = '00000000-0000-4000-8000-0000000103d1';
const MUSIM = '00000000-0000-4000-8000-0000000103d2';
const SQUAD = '00000000-0000-4000-8000-0000000103d3';

let db: Kysely<DB>;
let redis: Redis;
let reachable = false;

/** Menyisipkan `n` event `points.awarded` berpayload lengkap. */
async function event(n: number, topic = 'points.awarded'): Promise<string[]> {
  const rows = await db
    .insertInto('outbox_events')
    .values(
      Array.from({ length: n }, (_, i) => ({
        topic,
        payload: JSON.stringify({ user_id: AKU, squad_id: SQUAD, season_id: MUSIM, points: i + 1 }),
      })),
    )
    .returning('id')
    .execute();
  return rows.map((r) => String(r.id));
}

/**
 * Leaderboard tiruan yang MENCATAT setiap panggilan dan bisa ditahan.
 *
 * `syncMember` idempoten — memprosesnya dua kali tidak meninggalkan jejak di
 * Redis. Justru karena itu test konkurensi butuh penghitung sendiri: tanpa
 * itu, pemrosesan ganda tidak terlihat dari mana pun.
 */
class LeaderboardMata {
  panggilan: string[] = [];
  gerbang: Promise<void> = Promise.resolve();
  gagalUntuk = new Set<string>();

  async syncMember(_s: string, _q: string, userId: string): Promise<void> {
    this.panggilan.push(userId);
    await this.gerbang;
  }
}

/** Worker yang mencatat event MANA yang ia proses. */
function workerDenganCatatan(lb: LeaderboardMata) {
  const w = new OutboxWorkerService(db, lb as unknown as LeaderboardService);
  const diproses: string[] = [];
  const asli = (
    w as unknown as { handlers: Record<string, (p: Record<string, unknown>) => Promise<void>> }
  ).handlers;
  const handler = asli['points.awarded']!;
  asli['points.awarded'] = async (p) => {
    if (lb.gagalUntuk.has(String(p['points']))) throw new Error('racun');
    diproses.push(String(p['points']));
    await handler(p);
  };
  return { w, diproses };
}

beforeAll(async () => {
  db = createDatabase(url);
  redis = createRedis(redisUrl);
  try {
    await db.selectFrom('outbox_events').select('id').limit(1).execute();
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
  // `outbox_events` tidak punya FK ke `users` — tidak ikut CASCADE.
  await sql`TRUNCATE outbox_events, audit_log RESTART IDENTITY`.execute(db);
  await sql`TRUNCATE users, league_seasons, squads RESTART IDENTITY CASCADE`.execute(db);
  await redis.del(squadKey(MUSIM, SQUAD));

  await db
    .insertInto('users')
    .values({ id: AKU, email: 'q03@uji.test', display_name: 'Q' })
    .execute();
  await db
    .insertInto('league_seasons')
    .values({
      id: MUSIM,
      code: '2026-W42',
      starts_at: sql`now() - interval '1 day'`,
      ends_at: sql`now() + interval '6 days'`,
    })
    .execute();
  await db.insertInto('squads').values({ id: SQUAD, name: 'S', season_id: MUSIM }).execute();
  await db
    .insertInto('squad_members')
    .values({ squad_id: SQUAD, user_id: AKU, weekly_points: 40 })
    .execute();
});

describe('Q-03 — worker outbox (database + Redis nyata)', () => {
  it('database dan Redis siap dipakai', () => {
    expect(reachable, `database/Redis tidak bisa dipakai (${url}, ${redisUrl})`).toBe(true);
  });

  // ── AC 1: dua instance paralel ─────────────────────────────────────────

  it('AC: dua worker PARALEL tidak memproses event yang sama', async () => {
    if (!reachable) return;
    await event(10);

    let buka!: () => void;
    const lb = new LeaderboardMata();
    lb.gerbang = new Promise<void>((r) => {
      buka = r;
    });
    const a = workerDenganCatatan(lb);
    const b = workerDenganCatatan(lb);

    // A mengunci batch-nya lalu TERTAHAN di handler; B mulai selagi A masih
    // memegang kunci. Inilah tumpang tindih yang sungguhan.
    const pa = a.w.runOnce(5);
    await new Promise((r) => setTimeout(r, 300));
    const pb = b.w.runOnce(5);
    await new Promise((r) => setTimeout(r, 300));

    // Diambil SELAGI A MASIH MEMEGANG KUNCINYA — bukan sesudah gerbang dibuka.
    //
    // Versi pertama test ini memeriksa kemajuan B SETELAH keduanya selesai,
    // dan ia HIJAU untuk `FOR UPDATE` tanpa `SKIP LOCKED`. Sebabnya: B memang
    // tetap maju — hanya saja ia menunggu kunci A dilepas dulu, lalu
    // PostgreSQL memeriksa ulang baris 1–5 (sudah diproses), melewatinya, dan
    // melanjutkan ke 6–10. Tidak ganda, tapi juga TIDAK PARALEL: instance
    // kedua cuma antre di belakang yang pertama. Test yang tidak bisa
    // membedakan paralel dari berurutan tidak menguji acceptance criteria-nya.
    const bSebelumGerbang = b.diproses.length;

    buka();
    await Promise.all([pa, pb]);

    const semua = [...a.diproses, ...b.diproses];
    expect(semua, 'ada event yang diproses DUA KALI').toHaveLength(new Set(semua).size);
    expect(new Set(semua).size).toBe(10);

    expect(a.diproses.length, 'worker A tidak memproses apa pun').toBeGreaterThan(0);
    expect(
      bSebelumGerbang,
      'worker B menunggu kunci A alih-alih melewatinya — tidak ada SKIP LOCKED',
    ).toBeGreaterThan(0);
  });

  // ── AC 2: dead-letter dan antrean yang tidak macet ─────────────────────

  it('AC: event gagal 5× masuk audit_log dan KELUAR dari antrean', async () => {
    if (!reachable) return;
    const [racun] = await event(1);
    const lb = new LeaderboardMata();
    lb.gagalUntuk.add('1');
    const { w } = workerDenganCatatan(lb);

    for (let i = 1; i < MAX_ATTEMPTS; i++) {
      const r = await w.runOnce();
      expect(r.failed, `percobaan ${i}`).toBe(1);
    }
    const kelima = await w.runOnce();
    expect(kelima.deadLettered).toBe(1);

    const baris = await db
      .selectFrom('outbox_events')
      .select(['attempts', 'processed_at'])
      .where('id', '=', racun!)
      .executeTakeFirstOrThrow();
    expect(baris.attempts).toBe(MAX_ATTEMPTS);
    expect(baris.processed_at, 'event mati tetap di antrean').not.toBeNull();

    const jejak = await db
      .selectFrom('audit_log')
      .select(['action', 'subject_id', 'after'])
      .where('action', '=', 'outbox.dead_letter')
      .executeTakeFirstOrThrow();
    expect(jejak.subject_id).toBe(racun);
    // Jejaknya membawa pesan galat — tanpa itu audit_log cuma memberi tahu
    // BAHWA sesuatu mati, bukan kenapa.
    expect(jejak.after).toMatchObject({ attempts: MAX_ATTEMPTS, error: 'racun' });

    // Percobaan ke-6: tidak diambil lagi.
    expect(await w.runOnce()).toMatchObject({ processed: 0, failed: 0, deadLettered: 0 });
  });

  it('AC: event beracun di DEPAN antrean tidak menahan yang di belakangnya', async () => {
    if (!reachable) return;
    await event(3); // points 1, 2, 3 — yang pertama beracun
    const lb = new LeaderboardMata();
    lb.gagalUntuk.add('1');
    const { w, diproses } = workerDenganCatatan(lb);

    const r = await w.runOnce();

    // Satu kegagalan tidak membatalkan batch. Kalau galatnya lolos keluar
    // loop, transaksinya rollback — kedua event sehat ikut tidak tercatat,
    // dan event beracun yang SAMA gagal lagi di depan setiap putaran,
    // selamanya. `attempts`-nya pun tidak pernah naik, karena ikut rollback.
    expect(diproses).toEqual(['2', '3']);
    expect(r).toMatchObject({ processed: 2, failed: 1 });

    const racun = await db
      .selectFrom('outbox_events')
      .select('attempts')
      .where('topic', '=', 'points.awarded')
      .orderBy('id')
      .executeTakeFirstOrThrow();
    expect(racun.attempts, 'hitungan percobaan ikut rollback').toBe(1);
  });

  it('topik TANPA konsumen tidak diambil, dan tidak menyumbat batch', async () => {
    if (!reachable) return;
    // 60 event `streak.updated` (konsumennya WebSocket, RT-01, belum ada)
    // DI DEPAN satu `points.awarded`. Dengan batch 50, worker yang mengambil
    // semua topik akan menghabiskan batch-nya pada event yang tidak bisa ia
    // proses dan tidak pernah mencapai yang bisa.
    await event(60, 'streak.updated');
    await event(1);
    const lb = new LeaderboardMata();
    const { w, diproses } = workerDenganCatatan(lb);

    const r = await w.runOnce(50);
    expect(r.processed).toBe(1);
    expect(diproses).toEqual(['1']);

    const belum = await db
      .selectFrom('outbox_events')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('topic', '=', 'streak.updated')
      .where('processed_at', 'is', null)
      .executeTakeFirstOrThrow();
    // TIDAK ditandai selesai: menandainya berarti MEMBUANG event yang
    // konsumennya belum lahir.
    expect(Number(belum.n), 'event tanpa konsumen ditandai selesai — terbuang').toBe(60);
  });

  // ── Ujung ke ujung, dengan Redis sungguhan ─────────────────────────────

  it('papan squad selaras dengan Postgres, dan memproses DUA KALI tidak menggandakan', async () => {
    if (!reachable) return;
    const lb = new LeaderboardService(db, redis);
    const w = new OutboxWorkerService(db, lb);

    await lb.squadBoard(MUSIM, SQUAD); // kunci ada, AKU = 40
    // Seperti L-03: weekly_points naik di transaksi yang sama dengan event.
    await db
      .updateTable('squad_members')
      .set({ weekly_points: 55 })
      .where('user_id', '=', AKU)
      .execute();
    const [id] = await event(1);

    await w.runOnce();
    expect(Number(await redis.zscore(squadKey(MUSIM, SQUAD), AKU))).toBe(55);

    // Pengantaran at-least-once: worker mati setelah menulis Redis tapi
    // sebelum menandai selesai → event yang sama diproses lagi.
    await db
      .updateTable('outbox_events')
      .set({ processed_at: null })
      .where('id', '=', id!)
      .execute();
    await w.runOnce();

    expect(
      Number(await redis.zscore(squadKey(MUSIM, SQUAD), AKU)),
      'poin bertambah dua kali — konsumen tidak idempoten',
    ).toBe(55);
  });

  it('setelah Redis KOSONG, poin event tidak terhitung dua kali', async () => {
    if (!reachable) return;
    const lb = new LeaderboardService(db, redis);
    const w = new OutboxWorkerService(db, lb);

    await redis.del(squadKey(MUSIM, SQUAD));
    await db
      .updateTable('squad_members')
      .set({ weekly_points: 55 })
      .where('user_id', '=', AKU)
      .execute();
    await event(1);

    await w.runOnce();

    // `bump()` versi Q-02 menghasilkan 70 di sini: rebuild membaca 55 — yang
    // SUDAH memuat event ini — lalu ZINCRBY menambah 15 lagi.
    expect(Number(await redis.zscore(squadKey(MUSIM, SQUAD), AKU))).toBe(55);
  });

  it('event pengguna TANPA squad selesai tanpa galat', async () => {
    if (!reachable) return;
    await db
      .insertInto('outbox_events')
      .values({
        topic: 'points.awarded',
        payload: JSON.stringify({ user_id: AKU, squad_id: null, season_id: null, points: 5 }),
      })
      .execute();
    const w = new OutboxWorkerService(db, new LeaderboardService(db, redis));

    // Pengguna baru belum punya squad sampai job mingguan (Q-01). Tidak ada
    // papan untuk diselaraskan — itu keadaan sah, bukan kegagalan yang
    // pantas memakan jatah 5 percobaan.
    expect(await w.runOnce()).toMatchObject({ processed: 1, failed: 0 });
  });
});
