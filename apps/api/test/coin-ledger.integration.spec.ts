import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { DB } from '../src/infra/kysely';
import { CoinLedgerService, InsufficientCoinsError } from '../src/modules/wallet';

/**
 * Test integrasi CoinLedgerService terhadap DATABASE NYATA.
 *
 * Bukan unit test dengan mock, dan itu disengaja: tiga dari lima hal yang
 * diuji di sini — trigger append-only, serialisasi `FOR UPDATE`, dan partial
 * unique index — hidup di PostgreSQL, bukan di TypeScript. Mock akan lulus
 * tanpa membuktikan apa pun.
 *
 * Butuh database yang sudah dimigrasi:
 *   docker compose up -d && pnpm db:migrate
 *
 * Kalau DATABASE_URL menunjuk ke database yang belum siap, seluruh berkas ini
 * DILEWATI dengan pesan jelas — bukan gagal dengan error koneksi yang
 * menyesatkan, dan bukan pula lulus diam-diam.
 */

const URL_DEV = 'postgres://strive:strive_dev_only@localhost:55432/strive';
const url = process.env['DATABASE_URL_TEST'] ?? process.env['DATABASE_URL'] ?? URL_DEV;

let db: Kysely<DB>;
let coins: CoinLedgerService;
let reachable = false;

const USER_A = '00000000-0000-4000-8000-00000000a001';
const USER_B = '00000000-0000-4000-8000-00000000b002';

/**
 * Menyemai pengguna dengan saldo awal LEWAT LEDGER, bukan dengan menulis
 * `coin_balance` langsung.
 *
 * Versi pertama fixture ini menulis saldonya langsung ke kolom users — dan
 * enam test langsung merah, karena `trueBalance()` (SUM ledger) mulai dari 0
 * sementara cache-nya 100. Fixture-nya yang salah, bukan service-nya: menulis
 * saldo tanpa menulis ledger di transaksi yang sama adalah persis bug yang
 * CLAUDE.md aturan 2 larang. Test yang menyemai dengan cara terlarang tidak
 * menguji sistem yang sebenarnya.
 */
async function seedUser(id: string, balance: number, email: string) {
  await db
    .insertInto('users')
    .values({ id, email, password_hash: 'x', display_name: 'Uji', coin_balance: 0 })
    .execute();

  if (balance !== 0) {
    await db.transaction().execute((trx) =>
      coins.write(trx, {
        userId: id,
        entryType: 'adjust',
        amount: balance,
        note: 'saldo awal fixture test',
      }),
    );
  }
}

beforeAll(async () => {
  db = new Kysely<DB>({
    dialect: new PostgresDialect({ pool: new Pool({ connectionString: url }) }),
  });
  coins = new CoinLedgerService();
  try {
    await db.selectFrom('coin_ledger').select('id').limit(1).execute();
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
  // coin_ledger append-only, jadi pembersihan lewat TRUNCATE CASCADE — DELETE
  // akan ditolak trigger, dan itu justru perilaku yang benar.
  // TRUNCATE, bukan DELETE: coin_ledger append-only, dan trigger-nya menolak
  // DELETE — perilaku yang memang diuji WAJIB-1. TRUNCATE adalah DDL, jadi
  // lolos trigger baris.
  await sql`TRUNCATE coin_ledger, audit_log, outbox_events RESTART IDENTITY CASCADE`.execute(db);
  await db.deleteFrom('users').where('id', 'in', [USER_A, USER_B]).execute();
  await seedUser(USER_A, 100, 'a@uji.test');
  await seedUser(USER_B, 0, 'b@uji.test');
});

describe('CoinLedgerService (database nyata)', () => {
  it('database siap dipakai', () => {
    expect(
      reachable,
      `DATABASE_URL tidak bisa dipakai (${url}). Jalankan: docker compose up -d && pnpm db:migrate`,
    ).toBe(true);
  });

  // ── WAJIB 1 ───────────────────────────────────────────────────────────
  it('WAJIB-1: UPDATE dan DELETE pada coin_ledger ditolak trigger', async () => {
    if (!reachable) return;
    await db.transaction().execute(async (trx) => {
      await coins.write(trx, { userId: USER_A, entryType: 'earn_lesson', amount: 20 });
    });

    await expect(
      db.updateTable('coin_ledger').set({ amount: 999 }).where('user_id', '=', USER_A).execute(),
    ).rejects.toThrow(/append-only/);

    await expect(
      db.deleteFrom('coin_ledger').where('user_id', '=', USER_A).execute(),
    ).rejects.toThrow(/append-only/);

    // Append-only, bukan read-only: INSERT tetap boleh.
    await db.transaction().execute(async (trx) => {
      await coins.write(trx, { userId: USER_A, entryType: 'adjust', amount: -5 });
    });
    expect(await db.transaction().execute((t) => coins.trueBalance(t, USER_A))).toBe(115);
  });

  // ── WAJIB 2 ───────────────────────────────────────────────────────────
  it('WAJIB-2: dua debit paralel 80 dari saldo 100 → satu lolos, saldo 20 bukan -60', async () => {
    if (!reachable) return;

    const debit = (key: string) =>
      db.transaction().execute(async (trx) => {
        await coins.write(trx, {
          userId: USER_A,
          entryType: 'spend_scan',
          amount: -80,
          idempotencyKey: key,
        });
      });

    const hasil = await Promise.allSettled([debit('paralel-1'), debit('paralel-2')]);
    const lolos = hasil.filter((r) => r.status === 'fulfilled');
    const ditolak = hasil.filter((r) => r.status === 'rejected');

    expect(lolos).toHaveLength(1);
    expect(ditolak).toHaveLength(1);
    expect((ditolak[0] as PromiseRejectedResult).reason).toBeInstanceOf(InsufficientCoinsError);

    const user = await db
      .selectFrom('users')
      .select('coin_balance')
      .where('id', '=', USER_A)
      .executeTakeFirstOrThrow();
    expect(user.coin_balance).toBe(20);
    expect(await db.transaction().execute((t) => coins.trueBalance(t, USER_A))).toBe(20);
  });

  // ── WAJIB 3 ───────────────────────────────────────────────────────────
  it('WAJIB-3: release dua kali → satu entri, saldo kembali tepat sekali', async () => {
    if (!reachable) return;
    const scanId = '00000000-0000-4000-8000-00000000cafe';

    await db.transaction().execute(async (trx) => {
      await coins.hold(trx, { userId: USER_A, amount: 60, refType: 'scan', refId: scanId });
    });
    expect(await db.transaction().execute((t) => coins.trueBalance(t, USER_A))).toBe(40);

    await db.transaction().execute((trx) =>
      coins.release(trx, {
        userId: USER_A,
        refType: 'scan',
        refId: scanId,
        reason: 'vendor down',
      }),
    );
    await db.transaction().execute((trx) =>
      coins.release(trx, {
        userId: USER_A,
        refType: 'scan',
        refId: scanId,
        reason: 'dipanggil lagi',
      }),
    );

    const releases = await db
      .selectFrom('coin_ledger')
      .selectAll()
      .where('entry_type', '=', 'release')
      .where('ref_id', '=', scanId)
      .execute();

    expect(releases).toHaveLength(1);
    expect(await db.transaction().execute((t) => coins.trueBalance(t, USER_A))).toBe(100);
  });

  // ── WAJIB 4 ───────────────────────────────────────────────────────────
  it('WAJIB-4: idempotency_key sama dua kali → satu entri', async () => {
    if (!reachable) return;
    const key = 'idem-abc-123';

    const a = await db.transaction().execute((trx) =>
      coins.write(trx, {
        userId: USER_A,
        entryType: 'earn_lesson',
        amount: 20,
        idempotencyKey: key,
      }),
    );
    const b = await db.transaction().execute((trx) =>
      coins.write(trx, {
        userId: USER_A,
        entryType: 'earn_lesson',
        amount: 20,
        idempotencyKey: key,
      }),
    );

    expect(b.id).toBe(a.id);
    const rows = await db
      .selectFrom('coin_ledger')
      .selectAll()
      .where('idempotency_key', '=', key)
      .execute();
    expect(rows).toHaveLength(1);
    expect(await db.transaction().execute((t) => coins.trueBalance(t, USER_A))).toBe(120);
  });

  // ── WAJIB 5 ───────────────────────────────────────────────────────────
  it('WAJIB-5: saldo TIDAK PERNAH negatif — termasuk untuk adjust (CO-6)', async () => {
    if (!reachable) return;

    await expect(
      db
        .transaction()
        .execute((trx) =>
          coins.write(trx, { userId: USER_A, entryType: 'spend_ai', amount: -101 }),
        ),
    ).rejects.toBeInstanceOf(InsufficientCoinsError);

    // Penolakan terjadi SEBELUM apa pun ditulis — saldo tidak bergerak.
    expect(await db.transaction().execute((t) => coins.trueBalance(t, USER_A))).toBe(100);

    // Koreksi Superadmin tepat sampai nol: lolos.
    await db
      .transaction()
      .execute((trx) => coins.write(trx, { userId: USER_A, entryType: 'adjust', amount: -100 }));
    expect(await db.transaction().execute((t) => coins.trueBalance(t, USER_A))).toBe(0);

    // Koreksi yang melewati saldo tersedia: ditolak SERVICE dengan
    // InsufficientCoinsError, bukan oleh pelanggaran constraint mentah.
    //
    // Isu #27: CO-6 versi lama menjanjikan pengecualian saldo negatif untuk
    // `adjust`, padahal CHECK `users_coin_balance_non_negative` tidak punya
    // pengecualian apa pun — setengah CO-6 tidak pernah bisa dijalankan, dan
    // yang sampai ke pemanggil adalah error constraint yang tidak memberitahu
    // apa-apa. Sekarang kedua lapis sepakat, dan pesannya berguna.
    await expect(
      db
        .transaction()
        .execute((trx) => coins.write(trx, { userId: USER_A, entryType: 'adjust', amount: -1 })),
    ).rejects.toBeInstanceOf(InsufficientCoinsError);
  });

  // ── Tambahan: semantik settle ─────────────────────────────────────────
  it('settle TIDAK menulis entri ledger — hold sudah memotong saldo (CO-8)', async () => {
    if (!reachable) return;
    const scanId = '00000000-0000-4000-8000-00000000beef';

    await db.transaction().execute(async (trx) => {
      await coins.hold(trx, { userId: USER_A, amount: 60, refType: 'scan', refId: scanId });
    });
    const sebelum = await db.selectFrom('coin_ledger').selectAll().execute();

    const r1 = await db
      .transaction()
      .execute((trx) => coins.settle(trx, { userId: USER_A, refType: 'scan', refId: scanId }));
    const r2 = await db
      .transaction()
      .execute((trx) => coins.settle(trx, { userId: USER_A, refType: 'scan', refId: scanId }));

    expect(r1.settled).toBe(true);
    expect(r2.settled).toBe(false); // idempoten, no-op

    const sesudah = await db.selectFrom('coin_ledger').selectAll().execute();
    expect(sesudah).toHaveLength(sebelum.length); // NOL entri baru
    expect(await db.transaction().execute((t) => coins.trueBalance(t, USER_A))).toBe(40);

    const audit = await db
      .selectFrom('audit_log')
      .selectAll()
      .where('action', '=', 'coin.settle')
      .execute();
    expect(audit).toHaveLength(1); // jejaknya di audit_log, sekali
  });

  it('hold yang sudah di-settle tidak bisa di-release', async () => {
    if (!reachable) return;
    const scanId = '00000000-0000-4000-8000-00000000d00d';

    await db.transaction().execute(async (trx) => {
      await coins.hold(trx, { userId: USER_A, amount: 60, refType: 'scan', refId: scanId });
      await coins.settle(trx, { userId: USER_A, refType: 'scan', refId: scanId });
    });

    const hasil = await db
      .transaction()
      .execute((trx) =>
        coins.release(trx, { userId: USER_A, refType: 'scan', refId: scanId, reason: 'terlambat' }),
      );

    expect(hasil).toBeNull();
    expect(await db.transaction().execute((t) => coins.trueBalance(t, USER_A))).toBe(40);
  });

  it('release untuk referensi tanpa hold → null, bukan error (kasus tepi PRD §7 E4)', async () => {
    if (!reachable) return;
    const hasil = await db.transaction().execute((trx) =>
      coins.release(trx, {
        userId: USER_A,
        refType: 'scan',
        refId: '00000000-0000-4000-8000-0000000000ff',
        reason: 'tidak ada hold',
      }),
    );
    expect(hasil).toBeNull();
  });

  // ── Rollback & outbox ─────────────────────────────────────────────────
  it('exception di tengah transaksi meninggalkan NOL baris di ledger, users, dan outbox', async () => {
    if (!reachable) return;

    const ledgerSebelum = (await db.selectFrom('coin_ledger').selectAll().execute()).length;
    const outboxSebelum = (await db.selectFrom('outbox_events').selectAll().execute()).length;

    await expect(
      db.transaction().execute(async (trx) => {
        await coins.write(trx, { userId: USER_A, entryType: 'earn_lesson', amount: 20 });
        throw new Error('gagal setelah insert ledger');
      }),
    ).rejects.toThrow('gagal setelah insert ledger');

    // NOL baris BARU. Dibandingkan relatif, bukan terhadap nol mutlak — saldo
    // awal fixture sendiri sudah menulis satu entri ledger dan satu outbox.
    expect(await db.selectFrom('coin_ledger').selectAll().execute()).toHaveLength(ledgerSebelum);
    expect(await db.selectFrom('outbox_events').selectAll().execute()).toHaveLength(outboxSebelum);
    const user = await db
      .selectFrom('users')
      .select('coin_balance')
      .where('id', '=', USER_A)
      .executeTakeFirstOrThrow();
    expect(user.coin_balance).toBe(100);
  });

  it('setiap entri menulis outbox wallet.updated di transaksi yang sama (CO-12)', async () => {
    if (!reachable) return;
    await db.transaction().execute(async (trx) => {
      await coins.write(trx, { userId: USER_A, entryType: 'earn_lesson', amount: 20 });
    });

    // Dua: satu dari saldo awal fixture, satu dari penulisan di atas.
    const events = await db
      .selectFrom('outbox_events')
      .selectAll()
      .where('topic', '=', 'wallet.updated')
      .execute();
    expect(events).toHaveLength(2);
    expect(events.every((e) => e.processed_at === null)).toBe(true);
  });

  // ── findDrift ─────────────────────────────────────────────────────────
  it('findDrift menemukan cache yang menyimpang dari jumlah ledger (CO-11)', async () => {
    if (!reachable) return;
    await db.transaction().execute(async (trx) => {
      await coins.write(trx, { userId: USER_A, entryType: 'earn_lesson', amount: 20 });
    });

    // Dipersempit ke pengguna milik test ini: database dev bisa memuat baris
    // sisa dari uji manual, dan test yang mengandaikan database kosong akan
    // merah karena alasan yang tidak ada hubungannya dengan kode.
    const driftMilikKita = async () =>
      (await db.transaction().execute((t) => coins.findDrift(t))).filter((d) =>
        [USER_A, USER_B].includes(d.userId),
      );

    expect(await driftMilikKita()).toHaveLength(0);

    // Rusakkan cache-nya dengan sengaja — persis skenario AC-CO-4.
    await db.updateTable('users').set({ coin_balance: 999 }).where('id', '=', USER_A).execute();

    const drift = await driftMilikKita();
    expect(drift).toHaveLength(1);
    expect(drift[0]?.userId).toBe(USER_A);
    expect(drift[0]?.cachedBalance).toBe(999);
    expect(drift[0]?.ledgerSum).toBe(120);
    expect(drift[0]?.drift).toBe(879);
  });

  it('hold() menolak jumlah negatif — salah tanda adalah kesalahan pemanggil', async () => {
    if (!reachable) return;
    await expect(
      db.transaction().execute((trx) =>
        coins.hold(trx, {
          userId: USER_A,
          amount: -60,
          refType: 'scan',
          refId: '00000000-0000-4000-8000-00000000aaaa',
        }),
      ),
    ).rejects.toThrow(/jumlah POSITIF/);
  });
});
