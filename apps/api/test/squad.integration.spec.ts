import { Kysely, sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase, type DB } from '../src/infra/kysely';
import { SquadService } from '../src/modules/squad';

/**
 * Test integrasi SquadService terhadap DATABASE NYATA.
 *
 * Dua acceptance criteria item ini keduanya soal BATAS YANG TIDAK BOLEH
 * TEMBUS, dan keduanya hanya bisa dibuktikan dengan konkurensi sungguhan:
 * satu pengguna tidak pernah aktif di dua squad, dan squad tidak pernah
 * melebihi max_members. Test berurutan akan lulus meski penjaganya bocor.
 */

const URL_DEV = 'postgres://strive:strive_dev_only@localhost:55432/strive';
const url = process.env['DATABASE_URL_TEST'] ?? process.env['DATABASE_URL'] ?? URL_DEV;

let db: Kysely<DB>;
/** Koneksi kedua, POOL TERPISAH — dipakai menahan kunci tanpa berebut koneksi. */
let dbPenahan: Kysely<DB>;
let squads: SquadService;
let reachable = false;

const SEASON = '00000000-0000-4000-8000-000000002001';
const SEASON_LAMA = '00000000-0000-4000-8000-000000002002';
const SQUAD_A = '00000000-0000-4000-8000-000000003001';
const SQUAD_B = '00000000-0000-4000-8000-000000003002';

/** id pengguna ke-n, stabil supaya mudah dilacak saat test gagal. */
const uid = (n: number) => `00000000-0000-4000-8000-0000000040${String(n).padStart(2, '0')}`;

async function seedUsers(count: number) {
  await db
    .insertInto('users')
    .values(
      Array.from({ length: count }, (_, i) => ({
        id: uid(i),
        email: `sq${i}@uji.test`,
        display_name: `Uji ${i}`,
      })),
    )
    .execute();
}

beforeAll(async () => {
  db = createDatabase(url);
  dbPenahan = createDatabase(url);
  squads = new SquadService(db);
  try {
    await db.selectFrom('squads').select('id').limit(1).execute();
    reachable = true;
  } catch {
    reachable = false;
  }
});

afterAll(async () => {
  if (db) await db.destroy();
  if (dbPenahan) await dbPenahan.destroy();
});

beforeEach(async () => {
  if (!reachable) return;
  // `formSquads` melihat SELURUH pengguna aktif tanpa squad — itu memang
  // perilakunya sebagai job mingguan. Karena itu berkas ini butuh awal yang
  // benar-benar bersih: pengguna sisa dari berkas test lain akan ikut
  // terbentuk jadi squad dan membuat hitungannya salah.
  //
  // Aman karena `fileParallelism: false` di vitest.integration.config.mts dan
  // setiap berkas menyemai kebutuhannya sendiri di beforeEach.
  await sql`TRUNCATE users, squads, league_seasons, tracks RESTART IDENTITY CASCADE`.execute(db);

  await db
    .insertInto('league_seasons')
    .values([
      {
        id: SEASON_LAMA,
        code: '2026-W37',
        starts_at: sql`now() - interval '14 days'`,
        ends_at: sql`now() - interval '7 days'`,
      },
      {
        id: SEASON,
        code: '2026-W38',
        starts_at: sql`now() - interval '1 day'`,
        ends_at: sql`now() + interval '6 days'`,
      },
    ])
    .execute();

  await db
    .insertInto('squads')
    .values([
      { id: SQUAD_A, name: 'Squad A', season_id: SEASON, max_members: 8 },
      { id: SQUAD_B, name: 'Squad B', season_id: SEASON, max_members: 8 },
    ])
    .execute();
});

const aktif = (userId: string) =>
  db
    .selectFrom('squad_members')
    .selectAll()
    .where('user_id', '=', userId)
    .where('left_at', 'is', null)
    .executeTakeFirst();

async function codeDari(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return 'TIDAK_MELEMPAR';
  } catch (e) {
    const body = (e as { getResponse?: () => { error?: { code?: string } } }).getResponse?.();
    return body?.error?.code ?? 'BUKAN_HTTP_EXCEPTION';
  }
}

describe('SquadService (database nyata)', () => {
  it('database siap dipakai', () => {
    expect(
      reachable,
      `DATABASE_URL tidak bisa dipakai (${url}). Jalankan: docker compose up -d && pnpm db:migrate`,
    ).toBe(true);
  });

  // ── AC 1 ──────────────────────────────────────────────────────────────
  it('AC-1: satu pengguna tidak pernah aktif di dua squad', async () => {
    if (!reachable) return;
    await seedUsers(1);

    await db.transaction().execute((trx) => squads.join(trx, uid(0), SQUAD_A));
    const code = await codeDari(() =>
      db.transaction().execute((trx) => squads.join(trx, uid(0), SQUAD_B)),
    );

    expect(code).toBe('ALREADY_IN_SQUAD');
    expect((await aktif(uid(0)))?.squad_id).toBe(SQUAD_A);
  });

  it('AC-1: dijamin partial unique index, bukan cuma pengecekan di kode', async () => {
    if (!reachable) return;
    await seedUsers(1);
    await db.transaction().execute((trx) => squads.join(trx, uid(0), SQUAD_A));

    // Menembus service, langsung ke database — penjaga terakhir harus menahan.
    await expect(
      db
        .insertInto('squad_members')
        .values({ squad_id: SQUAD_B, user_id: uid(0) })
        .execute(),
    ).rejects.toThrow(/squad_members_one_active/);
  });

  it('AC-1: dua join PARALEL ke squad berbeda → tepat satu lolos', async () => {
    if (!reachable) return;
    await seedUsers(1);

    const hasil = await Promise.allSettled([
      db.transaction().execute((trx) => squads.join(trx, uid(0), SQUAD_A)),
      db.transaction().execute((trx) => squads.join(trx, uid(0), SQUAD_B)),
    ]);

    expect(hasil.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const baris = await db
      .selectFrom('squad_members')
      .selectAll()
      .where('user_id', '=', uid(0))
      .where('left_at', 'is', null)
      .execute();
    expect(baris).toHaveLength(1);
  });

  // ── AC 2 ──────────────────────────────────────────────────────────────
  it('AC-2: squad tidak pernah melebihi max_members', async () => {
    if (!reachable) return;
    await seedUsers(9);

    for (let i = 0; i < 8; i++) {
      await db.transaction().execute((trx) => squads.join(trx, uid(i), SQUAD_A));
    }

    const code = await codeDari(() =>
      db.transaction().execute((trx) => squads.join(trx, uid(8), SQUAD_A)),
    );
    expect(code).toBe('SQUAD_FULL');
    expect(await squads.activeMemberCount(db, SQUAD_A)).toBe(8);
  });

  it('AC-2: sepuluh join yang BENAR-BENAR bersamaan → tepat satu lolos', async () => {
    if (!reachable) return;
    await seedUsers(17);

    for (let i = 0; i < 7; i++) {
      await db.transaction().execute((trx) => squads.join(trx, uid(i), SQUAD_A));
    }

    // Versi awal test ini cuma menembak 10 join sekaligus lalu berharap mereka
    // berebut. Ternyata TIDAK: tiap koneksi baru berdiri pada waktu yang
    // berbeda, jadi transaksinya praktis berurutan dan yang belakangan sudah
    // melihat kursi terisi. Testnya lulus bahkan setelah `.forUpdate()` dicabut
    // dari service — lulus karena tidak pernah benar-benar berebut.
    //
    // Gerbang di bawah membuat tumpang tindihnya deterministik: satu transaksi
    // lain menahan kunci baris squad, kesepuluh join menumpuk di belakangnya,
    // baru dilepas bersamaan. Tanpa `.forUpdate()` di service, kesepuluhnya
    // melewati penahan ini tanpa menunggu, sama-sama membaca "7 anggota", dan
    // sama-sama masuk — test jadi merah, sebagaimana mestinya.
    let lepas!: () => void;
    const gerbang = new Promise<void>((r) => {
      lepas = r;
    });
    const penahan = dbPenahan.transaction().execute(async (trx) => {
      await sql`SELECT id FROM squads WHERE id = ${SQUAD_A} FOR UPDATE`.execute(trx);
      await gerbang;
    });

    // Beri waktu penahan mengambil kuncinya sebelum para penantang datang.
    await new Promise((r) => setTimeout(r, 150));

    const hasil = Promise.allSettled(
      Array.from({ length: 10 }, (_, k) =>
        db.transaction().execute((trx) => squads.join(trx, uid(7 + k), SQUAD_A)),
      ),
    );

    // Jendela ini yang menentukan: dengan kunci, kesepuluhnya MASIH menunggu.
    await new Promise((r) => setTimeout(r, 400));
    lepas();
    await penahan;

    const selesai = await hasil;
    expect(selesai.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await squads.activeMemberCount(db, SQUAD_A)).toBe(8);
  });

  // ── Keluar & gabung ulang ─────────────────────────────────────────────
  it('keluar lalu gabung ULANG ke squad yang sama berhasil — PK surrogate', async () => {
    if (!reachable) return;
    await seedUsers(1);

    await db.transaction().execute((trx) => squads.join(trx, uid(0), SQUAD_A));
    await db.transaction().execute((trx) => squads.leave(trx, uid(0)));
    await db.transaction().execute((trx) => squads.join(trx, uid(0), SQUAD_A));

    const semua = await db
      .selectFrom('squad_members')
      .selectAll()
      .where('user_id', '=', uid(0))
      .execute();

    // PK (squad_id, user_id) akan membuat ini mustahil — jebakan yang tercatat
    // di CLAUDE.md dan sudah dihindari di 001_init.sql.
    expect(semua).toHaveLength(2);
    expect(semua.filter((r) => r.left_at === null)).toHaveLength(1);
  });

  it('keluar saat tidak punya squad aktif adalah no-op, bukan error', async () => {
    if (!reachable) return;
    await seedUsers(1);
    const hasil = await db.transaction().execute((trx) => squads.leave(trx, uid(0)));
    expect(hasil.left).toBe(false);
  });

  // ── Q5: pindah squad tengah musim ─────────────────────────────────────
  it('Q5: pindah squad — poin TIDAK ikut, baris baru mulai dari 0', async () => {
    if (!reachable) return;
    await seedUsers(1);

    await db.transaction().execute((trx) => squads.join(trx, uid(0), SQUAD_A));
    await db
      .updateTable('squad_members')
      .set({ weekly_points: 250 })
      .where('user_id', '=', uid(0))
      .execute();

    await db.transaction().execute((trx) => squads.move(trx, uid(0), SQUAD_B));

    const lama = await db
      .selectFrom('squad_members')
      .selectAll()
      .where('user_id', '=', uid(0))
      .where('squad_id', '=', SQUAD_A)
      .executeTakeFirstOrThrow();
    const baru = await aktif(uid(0));

    // Poin tetap tercatat di squad LAMA untuk musim itu (§5 Q5).
    expect(lama.weekly_points).toBe(250);
    expect(lama.left_at).not.toBeNull();
    expect(baru?.squad_id).toBe(SQUAD_B);
    expect(baru?.weekly_points).toBe(0);
  });

  it('Q5: maksimal SATU perpindahan per musim', async () => {
    if (!reachable) return;
    await seedUsers(1);
    await db
      .insertInto('squads')
      .values({
        id: '00000000-0000-4000-8000-000000003003',
        name: 'Squad C',
        season_id: SEASON,
        max_members: 8,
      })
      .execute();

    await db.transaction().execute((trx) => squads.join(trx, uid(0), SQUAD_A));
    await db.transaction().execute((trx) => squads.move(trx, uid(0), SQUAD_B));

    // Tanpa batas ini ada eksploitasi jelas: pindah ke squad yang hampir
    // menang di hari terakhir (§5 Q5).
    const code = await codeDari(() =>
      db
        .transaction()
        .execute((trx) => squads.move(trx, uid(0), '00000000-0000-4000-8000-000000003003')),
    );
    expect(code).toBe('SQUAD_MOVE_LIMIT');
    expect((await aktif(uid(0)))?.squad_id).toBe(SQUAD_B);
  });

  it('Q5: batas perpindahan dihitung per MUSIM, bukan seumur hidup', async () => {
    if (!reachable) return;
    await seedUsers(1);
    // Riwayat pindah di musim LAMA tidak boleh membatasi musim ini.
    const squadLama = '00000000-0000-4000-8000-000000003009';
    await db
      .insertInto('squads')
      .values({ id: squadLama, name: 'Squad musim lalu', season_id: SEASON_LAMA, max_members: 8 })
      .execute();
    await db
      .insertInto('squad_members')
      .values([
        { squad_id: squadLama, user_id: uid(0), left_at: sql`now() - interval '8 days'` },
        { squad_id: squadLama, user_id: uid(0), left_at: sql`now() - interval '9 days'` },
      ])
      .execute();

    await db.transaction().execute((trx) => squads.join(trx, uid(0), SQUAD_A));
    await db.transaction().execute((trx) => squads.move(trx, uid(0), SQUAD_B));
    expect((await aktif(uid(0)))?.squad_id).toBe(SQUAD_B);
  });

  // ── Pembentukan otomatis (Q4) ─────────────────────────────────────────
  it('membentuk squad 8-12 anggota dari pengguna yang belum punya squad', async () => {
    if (!reachable) return;
    await seedUsers(20);

    const dibentuk = await db.transaction().execute((trx) => squads.formSquads(trx, SEASON));

    expect(dibentuk.length).toBeGreaterThan(0);
    for (const s of dibentuk) {
      expect(s.memberCount).toBeGreaterThanOrEqual(8);
      expect(s.memberCount).toBeLessThanOrEqual(12);
    }
    const total = dibentuk.reduce((a, s) => a + s.memberCount, 0);
    expect(total).toBe(20);
  });

  it('sisa yang kurang dari 8 TIDAK dipaksakan jadi squad sendiri', async () => {
    if (!reachable) return;
    // 21 pengguna: 12 + 9 muat; 8 + 13 tidak. Yang penting tidak ada squad < 8.
    await seedUsers(21);
    const dibentuk = await db.transaction().execute((trx) => squads.formSquads(trx, SEASON));
    for (const s of dibentuk) {
      expect(s.memberCount).toBeGreaterThanOrEqual(8);
    }
  });

  it('kurang dari 8 pengguna → NOL squad dibentuk, bukan squad kecil', async () => {
    if (!reachable) return;
    await seedUsers(5);
    const dibentuk = await db.transaction().execute((trx) => squads.formSquads(trx, SEASON));
    expect(dibentuk).toHaveLength(0);
    expect(await aktif(uid(0))).toBeUndefined();
  });

  it('pengguna yang sudah punya squad aktif tidak ikut dibentuk ulang', async () => {
    if (!reachable) return;
    await seedUsers(10);
    await db.transaction().execute((trx) => squads.join(trx, uid(0), SQUAD_A));

    const dibentuk = await db.transaction().execute((trx) => squads.formSquads(trx, SEASON));
    const total = dibentuk.reduce((a, s) => a + s.memberCount, 0);
    expect(total).toBe(9);
    expect((await aktif(uid(0)))?.squad_id).toBe(SQUAD_A);
  });

  it('pengelompokan berdasarkan rata-rata poin 2 minggu terakhir (Q4)', async () => {
    if (!reachable) return;
    await seedUsers(16);

    // Delapan pengguna pertama diberi poin tinggi, delapan sisanya nol.
    const track = '00000000-0000-4000-8000-000000005001';
    const modul = '00000000-0000-4000-8000-000000005002';
    const lesson = '00000000-0000-4000-8000-000000005003';
    await db.insertInto('tracks').values({ id: track, slug: 'sq', title: 'T' }).execute();
    await db.insertInto('modules').values({ id: modul, track_id: track, title: 'M' }).execute();
    await db.insertInto('lessons').values({ id: lesson, module_id: modul, title: 'L' }).execute();

    for (let i = 0; i < 8; i++) {
      await db
        .insertInto('lesson_attempts')
        .values({
          user_id: uid(i),
          lesson_id: lesson,
          // `::int` WAJIB: `date - $1` ambigu di PostgreSQL — ada `date - int
          // → date` dan `date - date → int`, dan ia memilih yang kedua.
          attempt_date: sql`(now() AT TIME ZONE 'Asia/Jakarta')::date - ${sql.lit(i)}::int`,
          card_results: JSON.stringify([]),
          score: 100,
          points: 100 - i,
          coins: 20,
          duration_ms: 1000,
        })
        .execute();
    }

    const dibentuk = await db.transaction().execute((trx) => squads.formSquads(trx, SEASON));
    expect(dibentuk).toHaveLength(2);

    // Squad pertama harus berisi pengguna berpoin tinggi, kedua yang nol —
    // itu yang membuat liga kompetitif, bukan timpang (§5 Q4).
    const anggota = async (squadId: string) =>
      (
        await db
          .selectFrom('squad_members')
          .select('user_id')
          .where('squad_id', '=', squadId)
          .execute()
      ).map((r) => r.user_id);

    const pertama = new Set(await anggota(dibentuk[0]!.squadId));
    const berpoin = Array.from({ length: 8 }, (_, i) => uid(i));
    expect(berpoin.every((u) => pertama.has(u))).toBe(true);
  });

  it('squad yang dibentuk terhubung ke musim yang diminta', async () => {
    if (!reachable) return;
    await seedUsers(8);
    const dibentuk = await db.transaction().execute((trx) => squads.formSquads(trx, SEASON));
    const row = await db
      .selectFrom('squads')
      .select('season_id')
      .where('id', '=', dibentuk[0]!.squadId)
      .executeTakeFirstOrThrow();
    expect(row.season_id).toBe(SEASON);
  });

  it('rollback transaksi tidak meninggalkan squad setengah jadi', async () => {
    if (!reachable) return;
    await seedUsers(10);
    const sebelum = (await db.selectFrom('squads').selectAll().execute()).length;

    await expect(
      db.transaction().execute(async (trx) => {
        await squads.formSquads(trx, SEASON);
        throw new Error('gagal setelah pembentukan');
      }),
    ).rejects.toThrow('gagal setelah pembentukan');

    expect(await db.selectFrom('squads').selectAll().execute()).toHaveLength(sebelum);
    expect(await aktif(uid(0))).toBeUndefined();
  });
});
