import { Kysely, sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase, type DB } from '../src/infra/kysely';
import { NotificationsService } from '../src/modules/notification';
import { StreakWarningService, WARNING_HOUR_LOCAL } from '../src/workers';

/**
 * `S-04` terhadap DATABASE NYATA.
 *
 * AC-nya: *"Terkirim pukul 20.00 waktu lokal masing-masing pengguna. Pengguna
 * yang sudah aktif hari itu tidak menerima apa pun."*
 *
 * Yang paling mudah salah di job ini bukan bunyi pesannya, tapi **siapa yang
 * terpilih** — jadi hampir seluruh test di bawah menguji `candidates()`, dengan
 * zona waktu yang dipilih supaya tepat pukul 20.00 lokal SAAT test berjalan,
 * apa pun jam UTC-nya.
 */

const URL_DEV = 'postgres://strive:strive_dev_only@localhost:55432/strive';
const url = process.env['DATABASE_URL_TEST'] ?? process.env['DATABASE_URL'] ?? URL_DEV;

let db: Kysely<DB>;
let job: StreakWarningService;
let reachable = false;

const A = '00000000-0000-4000-8000-00000000s401'.replace('s', 'a');
const B = '00000000-0000-4000-8000-00000000s402'.replace('s', 'a');

/** Mailer palsu: S-04 menguji SIAPA yang terpilih, bukan pengiriman email (itu N-01). */
class MailerDiam {
  async send(): Promise<{ id: string }> {
    return { id: 'uji' };
  }
}

/**
 * Zona waktu yang SEKARANG tepat pukul `jam` lokal.
 *
 * Dipilih dari daftar zona nyata, bukan dari offset karangan: `AT TIME ZONE`
 * hanya menerima nama zona yang dikenal Postgres, dan menghitung offset
 * sendiri akan salah saat daylight saving.
 */
async function zonaPadaJam(jam: number): Promise<string> {
  const r = await sql<{ name: string }>`
    SELECT name FROM pg_timezone_names
    WHERE EXTRACT(hour FROM (now() AT TIME ZONE name)) = ${sql.lit(jam)}
      AND name NOT LIKE 'posix/%' AND name LIKE '%/%'
    ORDER BY name LIMIT 1
  `.execute(db);
  const n = r.rows[0]?.name;
  if (!n) throw new Error(`Tidak ada zona yang sekarang pukul ${jam}`);
  return n;
}

beforeAll(async () => {
  db = createDatabase(url);
  job = new StreakWarningService(
    db,
    new NotificationsService(db, new MailerDiam() as never) as never,
  );
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
  await sql`TRUNCATE users RESTART IDENTITY CASCADE`.execute(db);
});

/** Membuat pengguna; trigger AU-6 membuat baris streaks dengan timezone-nya. */
async function buat(id: string, email: string, tz: string) {
  await db.insertInto('users').values({ id, email, display_name: 'Uji', timezone: tz }).execute();
}

describe('StreakWarningService (database nyata)', () => {
  it('database siap dipakai', () => {
    expect(reachable, `DATABASE_URL tidak bisa dipakai (${url})`).toBe(true);
  });

  it('AC: hanya pengguna yang SEKARANG pukul 20.00 lokal yang terpilih', async () => {
    if (!reachable) return;
    const tzDua0 = await zonaPadaJam(WARNING_HOUR_LOCAL);
    const tzLain = await zonaPadaJam((WARNING_HOUR_LOCAL + 5) % 24);

    await buat(A, 's1@uji.test', tzDua0);
    await buat(B, 's2@uji.test', tzLain);

    const k = await job.candidates();
    expect(k.map((x) => x.user_id)).toEqual([A]);
    expect(k[0]!.local_hour).toBe(WARNING_HOUR_LOCAL);
  });

  it('AC: pengguna yang SUDAH aktif hari ini tidak menerima apa pun', async () => {
    if (!reachable) return;
    const tz = await zonaPadaJam(WARNING_HOUR_LOCAL);
    await buat(A, 's1@uji.test', tz);

    // Aktif hari ini menurut tanggal LOKALNYA sendiri.
    await db
      .updateTable('streaks')
      .set({ last_activity_date: sql`(now() AT TIME ZONE ${sql.lit(tz)})::date` })
      .where('user_id', '=', A)
      .execute();

    expect(await job.candidates()).toEqual([]);
  });

  it('aktif KEMARIN tetap terpilih — yang penting hari ini, bukan pernah', async () => {
    if (!reachable) return;
    const tz = await zonaPadaJam(WARNING_HOUR_LOCAL);
    await buat(A, 's1@uji.test', tz);
    await db
      .updateTable('streaks')
      .set({ last_activity_date: sql`(now() AT TIME ZONE ${sql.lit(tz)})::date - 1` })
      .where('user_id', '=', A)
      .execute();

    expect((await job.candidates()).map((x) => x.user_id)).toEqual([A]);
  });

  it('last_activity_date NULL tetap terpilih — NULL <> date menghasilkan NULL, bukan true', async () => {
    if (!reachable) return;
    const tz = await zonaPadaJam(WARNING_HOUR_LOCAL);
    await buat(A, 's1@uji.test', tz);

    // Jebakannya di SQL: `s.last_activity_date <> today` akan MENGHILANGKAN
    // pengguna yang belum pernah aktif sama sekali, padahal merekalah yang
    // paling butuh diingatkan. `IS DISTINCT FROM` yang benar.
    expect((await job.candidates()).map((x) => x.user_id)).toEqual([A]);
  });

  it('pengguna yang ditangguhkan tidak menerima apa pun', async () => {
    if (!reachable) return;
    const tz = await zonaPadaJam(WARNING_HOUR_LOCAL);
    await buat(A, 's1@uji.test', tz);
    await db.updateTable('users').set({ status: 'suspended' }).where('id', '=', A).execute();

    expect(await job.candidates()).toEqual([]);
  });

  it('idempoten per hari lokal: job jalan dua kali → satu notifikasi', async () => {
    if (!reachable) return;
    const tz = await zonaPadaJam(WARNING_HOUR_LOCAL);
    await buat(A, 's1@uji.test', tz);

    const satu = await job.run();
    const dua = await job.run();

    // Job ini berjalan TIAP JAM. Tanpa penjaga harian, pengguna di zona yang
    // offset-nya setengah jam bisa cocok dua kali dalam satu hari lokal.
    expect(satu.sent).toBe(1);
    expect(dua.sent, 'peringatan kedua di hari yang sama').toBe(0);

    const n = await db
      .selectFrom('notifications')
      .selectAll()
      .where('user_id', '=', A)
      .where('kind', '=', 'streak_warning')
      .execute();
    expect(n).toHaveLength(1);
    expect(n[0]!.title).toContain('hampir putus');
  });

  it('notifikasi memuat streak berjalan dan tanggal lokalnya', async () => {
    if (!reachable) return;
    const tz = await zonaPadaJam(WARNING_HOUR_LOCAL);
    await buat(A, 's1@uji.test', tz);
    // `longest_streak` ikut dinaikkan: CHECK `streaks_longest_gte_current`
    // menolak longest < current, dan itu memang benar (SK-5: longest tidak
    // pernah turun).
    await db
      .updateTable('streaks')
      .set({ current_streak: 12, longest_streak: 12 })
      .where('user_id', '=', A)
      .execute();

    await job.run();
    const n = await db
      .selectFrom('notifications')
      .selectAll()
      .where('user_id', '=', A)
      .executeTakeFirstOrThrow();

    expect(n.title).toContain('12');
    expect((n.data as { current_streak: number }).current_streak).toBe(12);
  });
});
