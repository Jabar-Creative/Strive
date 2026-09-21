import { Kysely, sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, type DB } from '../src/infra/kysely';
import { MONTHS_AHEAD, PartitionService, WARN_DAYS } from '../src/workers';

/**
 * `F-12` terhadap DATABASE NYATA.
 *
 * AC-nya: *"Partisi bulan berjalan + satu bulan ke depan dibuat otomatis,
 * idempoten (`CREATE TABLE IF NOT EXISTS … PARTITION OF`, dijalankan dua kali
 * tidak error)."*
 *
 * Yang dijaga job ini bukan kenyamanan: `lesson_attempts` **tidak punya
 * partisi DEFAULT**, jadi insert di luar rentang **GAGAL**. `POST /attempts`
 * adalah jantung sistem — kalau insert-nya gagal, pengguna berhenti bisa
 * belajar sama sekali.
 */

const URL_DEV = 'postgres://strive:strive_dev_only@localhost:55432/strive';
const url = process.env['DATABASE_URL_TEST'] ?? process.env['DATABASE_URL'] ?? URL_DEV;

let db: Kysely<DB>;
let job: PartitionService;
let reachable = false;

const daftarPartisi = async () => {
  const r = await sql<{ nama: string }>`
    SELECT c.relname AS nama
    FROM pg_class c
    JOIN pg_inherits i ON i.inhrelid = c.oid
    JOIN pg_class p ON p.oid = i.inhparent
    WHERE p.relname = 'lesson_attempts'
    ORDER BY c.relname
  `.execute(db);
  return r.rows.map((x) => x.nama);
};

beforeAll(async () => {
  db = createDatabase(url);
  job = new PartitionService(db);
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

describe('PartitionService (database nyata)', () => {
  it('database siap dipakai', () => {
    expect(reachable, `DATABASE_URL tidak bisa dipakai (${url})`).toBe(true);
  });

  it('AC: bulan berjalan dan satu bulan ke depan dijamin ada', async () => {
    if (!reachable) return;
    await job.run();

    const ada = await daftarPartisi();
    const r = await sql<{ nama: string }>`
      SELECT 'lesson_attempts_' || to_char(date_trunc('month', now() + (i || ' month')::interval), 'YYYY_MM') AS nama
      FROM generate_series(0, ${sql.lit(MONTHS_AHEAD)}) i
    `.execute(db);

    for (const harus of r.rows.map((x) => x.nama)) {
      expect(ada, `partisi ${harus} tidak ada — INSERT di bulan itu akan GAGAL`).toContain(harus);
    }
  });

  it('AC: dijalankan dua kali tidak error, dan tidak membuat apa pun dua kali', async () => {
    if (!reachable) return;
    await job.run();
    const sebelum = await daftarPartisi();

    // Job bulanan yang gagal saat dijalankan dua kali akan membuat orang ragu
    // menjalankannya ulang setelah insiden — dan keraguan itu yang berbahaya.
    const kedua = await job.run();

    expect(kedua.created, 'jalan kedua membuat partisi lagi').toEqual([]);
    expect(await daftarPartisi()).toEqual(sebelum);
  });

  it('melaporkan partisi terjauh dan sisa harinya', async () => {
    if (!reachable) return;
    const r = await job.run();

    expect(r.furthest_until).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Number.isFinite(r.days_remaining)).toBe(true);
    // Batasnya dibaca dari EKSPRESI partisinya, bukan ditebak dari namanya.
    // Nama bisa salah; batasnya tidak.
    const cek = await sql<{ maks: string }>`
      SELECT to_char(max((regexp_match(pg_get_expr(c.relpartbound, c.oid), 'TO \\((''[^'']+'')\\)'))[1]::date), 'YYYY-MM-DD') AS maks
      FROM pg_class c
      JOIN pg_inherits i ON i.inhrelid = c.oid
      JOIN pg_class p ON p.oid = i.inhparent
      WHERE p.relname = 'lesson_attempts'
    `.execute(db);
    expect(r.furthest_until).toBe(cek.rows[0]!.maks);
  });

  it('alarm menyala kalau partisi terjauh tinggal < 30 hari', async () => {
    if (!reachable) return;
    const r = await job.run();
    // Ambangnya diperiksa terhadap angka sungguhan, bukan diandaikan.
    expect(r.warning).toBe(r.days_remaining < WARN_DAYS);
  });

  it('partisi yang dibuat job ini BENAR-BENAR menerima insert', async () => {
    if (!reachable) return;
    await job.run();

    // Partisi yang terdaftar tapi batasnya salah akan lulus pemeriksaan nama
    // dan tetap menolak insert. Satu-satunya bukti adalah insert sungguhan.
    await db
      .transaction()
      .execute(async (trx) => {
        const u = '00000000-0000-4000-8000-0000000f1201';
        const t = '00000000-0000-4000-8000-0000000f1202';
        const m = '00000000-0000-4000-8000-0000000f1203';
        const l = '00000000-0000-4000-8000-0000000f1204';
        await trx
          .insertInto('users')
          .values({ id: u, email: 'f12@uji.test', display_name: 'F' })
          .execute();
        await trx.insertInto('tracks').values({ id: t, slug: 'f12', title: 'T' }).execute();
        await trx.insertInto('modules').values({ id: m, track_id: t, title: 'M' }).execute();
        await trx.insertInto('lessons').values({ id: l, module_id: m, title: 'L' }).execute();

        // Bulan DEPAN — partisi yang baru saja dijamin job ini.
        await sql`
        INSERT INTO lesson_attempts (user_id, lesson_id, attempt_date, card_results, score, points, coins, duration_ms)
        VALUES (${u}::uuid, ${l}::uuid,
                (date_trunc('month', now() + interval '1 month') + interval '3 day')::date,
                '[]'::jsonb, 100, 10, 2, 1000)
      `.execute(trx);

        const n = await sql<{ n: string }>`
        SELECT count(*)::text AS n FROM lesson_attempts WHERE user_id = ${u}
      `.execute(trx);
        expect(Number(n.rows[0]!.n)).toBe(1);

        // Rollback: test ini tidak meninggalkan apa pun di database bersama.
        await sql`ROLLBACK`.execute(trx).catch(() => undefined);
        throw new Error('__rollback__');
      })
      .catch((e: Error) => {
        if (e.message !== '__rollback__') throw e;
      });
  });
});
