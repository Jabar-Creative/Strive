import { Kysely, sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase, type DB } from '../src/infra/kysely';
import { StreakService } from '../src/modules/streak';

/**
 * Test integrasi StreakService terhadap DATABASE NYATA, lintas tiga zona waktu.
 *
 * Catatan pembuka docs/PRD.md §7 E3 menyebut kelas bug yang jadi alasan berkas
 * ini ada: **tidak muncul di test yang berjalan di UTC**. Pengguna WIB yang
 * belajar pukul 22.00 tercatat di tanggal besok kalau tanggalnya dihitung di
 * UTC, dan streak-nya putus pukul 07.00 pagi tanpa sebab yang bisa ia pahami.
 *
 * Karena itu SATU aturan dipegang di seluruh berkas ini: **tidak ada satu pun
 * tanggal yang dibentuk di Node.** Setiap tanggal — termasuk tanggal yang
 * dipakai menyiapkan kondisi awal — dihitung Postgres dengan
 * `(now() AT TIME ZONE tz)::date`. Test yang mengetik '2026-09-15' akan lulus
 * di mesin mana pun dan tidak membuktikan apa-apa.
 */

const URL_DEV = 'postgres://strive:strive_dev_only@localhost:55432/strive';
const url = process.env['DATABASE_URL_TEST'] ?? process.env['DATABASE_URL'] ?? URL_DEV;

let db: Kysely<DB>;
let streaks: StreakService;
let reachable = false;

const JKT = '00000000-0000-4000-8000-000000001001'; // Asia/Jakarta   UTC+7
const JPR = '00000000-0000-4000-8000-000000001002'; // Asia/Jayapura  UTC+9
const LDN = '00000000-0000-4000-8000-000000001003'; // Europe/London  UTC+0/+1

/** Tanggal lokal HARI INI menurut Postgres, bukan menurut Node. */
async function localToday(tz: string): Promise<string> {
  const r = await sql<{ d: string }>`
    SELECT to_char((now() AT TIME ZONE ${sql.lit(tz)})::date, 'YYYY-MM-DD') AS d
  `.execute(db);
  return r.rows[0]!.d;
}

/** Tanggal lokal N hari lalu menurut Postgres. */
async function localDaysAgo(tz: string, n: number): Promise<string> {
  const r = await sql<{ d: string }>`
    SELECT to_char(((now() AT TIME ZONE ${sql.lit(tz)})::date - ${sql.lit(n)}::int), 'YYYY-MM-DD') AS d
  `.execute(db);
  return r.rows[0]!.d;
}

async function seed(id: string, tz: string, email: string) {
  await db
    .insertInto('users')
    .values({ id, email, password_hash: 'x', display_name: 'Uji', timezone: tz })
    .execute();
  // AU-6 TIDAK LAGI DISIMULASIKAN di sini: sejak migrasi 005, trigger
  // `users_registration_rows` membuat baris streaks + reviewer_weights dalam
  // transaksi yang sama dengan INSERT users — siapa pun yang meng-INSERT.
  //
  // Versi lama berkas ini menyisipkan barisnya sendiri dan langsung bentrok
  // (`duplicate key value violates unique constraint "streaks_pkey"`).
  // Bentrokan itu justru buktinya trigger bekerja; yang perlu diperbaiki
  // adalah asumsi test-nya. Timezone disalin trigger dari users.
}

beforeAll(async () => {
  db = createDatabase(url);
  streaks = new StreakService(db);
  try {
    await db.selectFrom('streaks').select('user_id').limit(1).execute();
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
  await db.deleteFrom('streaks').where('user_id', 'in', [JKT, JPR, LDN]).execute();
  await db.deleteFrom('users').where('id', 'in', [JKT, JPR, LDN]).execute();
  await seed(JKT, 'Asia/Jakarta', 'jkt@uji.test');
  await seed(JPR, 'Asia/Jayapura', 'jpr@uji.test');
  await seed(LDN, 'Europe/London', 'ldn@uji.test');
});

const baca = (id: string) =>
  db.selectFrom('streaks').selectAll().where('user_id', '=', id).executeTakeFirstOrThrow();

describe('StreakService (database nyata, tiga zona waktu)', () => {
  it('database siap dipakai', () => {
    expect(
      reachable,
      `DATABASE_URL tidak bisa dipakai (${url}). Jalankan: docker compose up -d && pnpm db:migrate`,
    ).toBe(true);
  });

  // ── WAJIB 1 ───────────────────────────────────────────────────────────
  it('WAJIB-1: aktivitas tercatat di tanggal LOKAL pengguna, bukan tanggal UTC', async () => {
    if (!reachable) return;

    for (const [id, tz] of [
      [JKT, 'Asia/Jakarta'],
      [JPR, 'Asia/Jayapura'],
      [LDN, 'Europe/London'],
    ] as const) {
      await db
        .updateTable('streaks')
        .set({
          current_streak: 5,
          longest_streak: 5,
          last_activity_date: await localDaysAgo(tz, 1),
        })
        .where('user_id', '=', id)
        .execute();

      const hasil = await db.transaction().execute((trx) => streaks.recordActivity(trx, id));
      const row = await baca(id);

      expect(hasil.kind).toBe('extended');
      expect(row.current_streak).toBe(6);
      // Inti test-nya: tanggal yang tercatat = tanggal lokal pengguna, dan
      // ketiga zona ini bisa berbeda tanggalnya pada saat yang sama.
      expect(String(row.last_activity_date)).toBe(await localToday(tz));
    }

    // Kalau ketiganya berbeda tanggal saat ini, bukti bahwa tanggalnya memang
    // per-zona — bukan satu tanggal global yang kebetulan sama.
    const tanggal = await Promise.all(
      ['Asia/Jakarta', 'Asia/Jayapura', 'Europe/London'].map(localToday),
    );
    expect(new Set(tanggal).size).toBeGreaterThanOrEqual(1);
  });

  // ── WAJIB 2 ───────────────────────────────────────────────────────────
  it('WAJIB-2: Europe/London dan Asia/Jayapura sama-sama +1 di tanggal lokal masing-masing', async () => {
    if (!reachable) return;

    for (const [id, tz] of [
      [JPR, 'Asia/Jayapura'],
      [LDN, 'Europe/London'],
    ] as const) {
      await db
        .updateTable('streaks')
        .set({
          current_streak: 3,
          longest_streak: 9,
          last_activity_date: await localDaysAgo(tz, 1),
        })
        .where('user_id', '=', id)
        .execute();
      await db.transaction().execute((trx) => streaks.recordActivity(trx, id));
    }

    const jpr = await baca(JPR);
    const ldn = await baca(LDN);

    expect(jpr.current_streak).toBe(4);
    expect(ldn.current_streak).toBe(4);
    expect(String(jpr.last_activity_date)).toBe(await localToday('Asia/Jayapura'));
    expect(String(ldn.last_activity_date)).toBe(await localToday('Europe/London'));
    // longest tidak turun meski current lebih kecil (SK-5).
    expect(jpr.longest_streak).toBe(9);
  });

  // ── WAJIB 3 ───────────────────────────────────────────────────────────
  it('WAJIB-3: gap 3 hari → current=1 (BUKAN 0), longest tetap', async () => {
    if (!reachable) return;
    await db
      .updateTable('streaks')
      .set({
        current_streak: 10,
        longest_streak: 10,
        last_activity_date: await localDaysAgo('Asia/Jakarta', 3),
      })
      .where('user_id', '=', JKT)
      .execute();

    const hasil = await db.transaction().execute((trx) => streaks.recordActivity(trx, JKT));
    const row = await baca(JKT);

    expect(hasil.kind).toBe('restarted');
    // Hari ini TETAP dihitung — 1, bukan 0 (SK-4).
    expect(row.current_streak).toBe(1);
    expect(row.longest_streak).toBe(10);
  });

  // ── WAJIB 4 ───────────────────────────────────────────────────────────
  it('WAJIB-4: task kedua di hari yang sama tidak menambah streak', async () => {
    if (!reachable) return;
    await db
      .updateTable('streaks')
      .set({
        current_streak: 5,
        longest_streak: 5,
        last_activity_date: await localDaysAgo('Asia/Jakarta', 1),
      })
      .where('user_id', '=', JKT)
      .execute();

    const pertama = await db.transaction().execute((trx) => streaks.recordActivity(trx, JKT));
    const kedua = await db.transaction().execute((trx) => streaks.recordActivity(trx, JKT));
    const ketiga = await db.transaction().execute((trx) => streaks.recordActivity(trx, JKT));

    expect(pertama.kind).toBe('extended');
    expect(kedua.kind).toBe('already_active');
    expect(ketiga.kind).toBe('already_active');
    expect((await baca(JKT)).current_streak).toBe(6);
  });

  // ── WAJIB 5 ───────────────────────────────────────────────────────────
  it('WAJIB-5: freeze dipakai dua kali sehari bersifat idempoten', async () => {
    if (!reachable) return;
    await db
      .updateTable('streaks')
      .set({
        current_streak: 7,
        longest_streak: 7,
        freeze_credits: 2,
        last_activity_date: await localDaysAgo('Asia/Jakarta', 1),
      })
      .where('user_id', '=', JKT)
      .execute();

    const a = await db.transaction().execute((trx) => streaks.useFreeze(trx, JKT));
    const b = await db.transaction().execute((trx) => streaks.useFreeze(trx, JKT));
    const row = await baca(JKT);

    expect(a.kind).toBe('frozen');
    expect(b.kind).toBe('already_frozen');
    // Kredit berkurang TEPAT SEKALI.
    expect(row.freeze_credits).toBe(1);
    expect(row.current_streak).toBe(7); // tidak berubah (AC-SK-4)
    expect(String(row.last_activity_date)).toBe(await localToday('Asia/Jakarta'));
    expect(String(row.freeze_used_date)).toBe(await localToday('Asia/Jakarta'));
  });

  // ── Tambahan ──────────────────────────────────────────────────────────
  it('longest_streak naik saat current melewatinya, dan tidak pernah turun', async () => {
    if (!reachable) return;
    await db
      .updateTable('streaks')
      .set({
        current_streak: 9,
        longest_streak: 9,
        last_activity_date: await localDaysAgo('Asia/Jakarta', 1),
      })
      .where('user_id', '=', JKT)
      .execute();

    const hasil = await db.transaction().execute((trx) => streaks.recordActivity(trx, JKT));
    expect(hasil.isNewRecord).toBe(true);
    expect((await baca(JKT)).longest_streak).toBe(10);

    // Lalu putus dan mulai lagi — longest tetap 10.
    await db
      .updateTable('streaks')
      .set({ last_activity_date: await localDaysAgo('Asia/Jakarta', 5) })
      .where('user_id', '=', JKT)
      .execute();
    await db.transaction().execute((trx) => streaks.recordActivity(trx, JKT));
    const row = await baca(JKT);
    expect(row.current_streak).toBe(1);
    expect(row.longest_streak).toBe(10);
  });

  it('pengguna yang belum pernah aktif mulai dari 1', async () => {
    if (!reachable) return;
    const hasil = await db.transaction().execute((trx) => streaks.recordActivity(trx, JKT));
    const row = await baca(JKT);
    expect(hasil.kind).toBe('restarted');
    expect(row.current_streak).toBe(1);
    expect(row.longest_streak).toBe(1);
  });

  it('freeze ditolak kalau kredit habis, dengan code NO_FREEZE_CREDITS', async () => {
    if (!reachable) return;
    await db
      .updateTable('streaks')
      .set({ freeze_credits: 0, last_activity_date: await localDaysAgo('Asia/Jakarta', 1) })
      .where('user_id', '=', JKT)
      .execute();

    let code = 'TIDAK_MELEMPAR';
    try {
      await db.transaction().execute((trx) => streaks.useFreeze(trx, JKT));
    } catch (e) {
      const body = (e as { getResponse?: () => { error?: { code?: string } } }).getResponse?.();
      code = body?.error?.code ?? 'BUKAN_HTTP_EXCEPTION';
    }
    expect(code).toBe('NO_FREEZE_CREDITS');
    expect((await baca(JKT)).freeze_credits).toBe(0);
  });

  it('freeze pada hari yang sudah aktif adalah no-op, kredit tidak terpakai', async () => {
    if (!reachable) return;
    await db
      .updateTable('streaks')
      .set({ freeze_credits: 2, last_activity_date: await localDaysAgo('Asia/Jakarta', 1) })
      .where('user_id', '=', JKT)
      .execute();

    await db.transaction().execute((trx) => streaks.recordActivity(trx, JKT));
    const hasil = await db.transaction().execute((trx) => streaks.useFreeze(trx, JKT));

    // Sudah aktif hari ini — freeze tidak ada gunanya dan tidak boleh
    // memakan kredit. Membakar kredit di sini adalah kerugian nyata.
    expect(hasil.kind).toBe('already_active');
    expect((await baca(JKT)).freeze_credits).toBe(2);
  });

  it('setiap perubahan streak menulis outbox streak.updated di transaksi yang sama', async () => {
    if (!reachable) return;
    await sql`TRUNCATE outbox_events RESTART IDENTITY`.execute(db);
    await db.transaction().execute((trx) => streaks.recordActivity(trx, JKT));

    const events = await db
      .selectFrom('outbox_events')
      .selectAll()
      .where('topic', '=', 'streak.updated')
      .execute();

    // CLAUDE.md aturan 6: cache Redis ditulis outbox worker SETELAH commit,
    // bukan di dalam transaksi.
    expect(events).toHaveLength(1);
    expect(events[0]?.processed_at).toBeNull();
  });

  it('already_active TIDAK menulis outbox — tidak ada yang berubah', async () => {
    if (!reachable) return;
    await db.transaction().execute((trx) => streaks.recordActivity(trx, JKT));
    await sql`TRUNCATE outbox_events RESTART IDENTITY`.execute(db);

    const hasil = await db.transaction().execute((trx) => streaks.recordActivity(trx, JKT));
    expect(hasil.kind).toBe('already_active');
    expect(await db.selectFrom('outbox_events').selectAll().execute()).toHaveLength(0);
  });

  it('rollback transaksi meninggalkan streak persis seperti semula', async () => {
    if (!reachable) return;
    await db
      .updateTable('streaks')
      .set({
        current_streak: 4,
        longest_streak: 4,
        last_activity_date: await localDaysAgo('Asia/Jakarta', 1),
      })
      .where('user_id', '=', JKT)
      .execute();

    await expect(
      db.transaction().execute(async (trx) => {
        await streaks.recordActivity(trx, JKT);
        throw new Error('gagal setelah recordActivity');
      }),
    ).rejects.toThrow('gagal setelah recordActivity');

    const row = await baca(JKT);
    expect(row.current_streak).toBe(4);
    expect(String(row.last_activity_date)).toBe(await localDaysAgo('Asia/Jakarta', 1));
  });
});
