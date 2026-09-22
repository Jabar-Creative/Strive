import { Kysely, sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase, type DB } from '../src/infra/kysely';
import { CoinLedgerService } from '../src/modules/wallet';
import { ReconcileBalanceService } from '../src/workers';

/**
 * `C-04` terhadap DATABASE NYATA.
 *
 * Acceptance criteria-nya menyebutkan caranya secara harfiah: **"Diuji dengan
 * sengaja merusak satu saldo."** Jadi di bawah `users.coin_balance` benar-benar
 * ditulis langsung — satu-satunya tempat di repo ini yang boleh melakukannya,
 * dan justru karena itulah ia harus ada di sini: kalau job-nya tidak menangkap
 * penulisan terlarang, ia tidak menjaga apa pun.
 */

const URL_DEV = 'postgres://strive:strive_dev_only@localhost:55432/strive';
const url = process.env['DATABASE_URL_TEST'] ?? process.env['DATABASE_URL'] ?? URL_DEV;

let db: Kysely<DB>;
let job: ReconcileBalanceService;
let coins: CoinLedgerService;
let reachable = false;

const A = '00000000-0000-4000-8000-00000000c401';
const B = '00000000-0000-4000-8000-00000000c402';

beforeAll(async () => {
  db = createDatabase(url);
  coins = new CoinLedgerService();
  job = new ReconcileBalanceService(db, coins);
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
  await sql`TRUNCATE users, audit_log RESTART IDENTITY CASCADE`.execute(db);
  await db
    .insertInto('users')
    .values([
      { id: A, email: 'rec1@uji.test', display_name: 'A' },
      { id: B, email: 'rec2@uji.test', display_name: 'B' },
    ])
    .execute();
  for (const id of [A, B]) {
    await db
      .transaction()
      .execute((trx) => coins.write(trx, { userId: id, entryType: 'adjust', amount: 100 }));
  }
});

const auditTerakhir = () =>
  db
    .selectFrom('audit_log')
    .selectAll()
    .where('action', '=', 'coin.reconcile')
    .orderBy('id', 'desc')
    .executeTakeFirst();

describe('ReconcileBalanceService (database nyata)', () => {
  it('database siap dipakai', () => {
    expect(reachable, `DATABASE_URL tidak bisa dipakai (${url})`).toBe(true);
  });

  it('saldo yang konsisten: nol selisih', async () => {
    if (!reachable) return;
    const hasil = await job.run();
    expect(hasil.drift_count).toBe(0);
    expect(hasil.drifts).toEqual([]);
  });

  it('baris audit ditulis MESKI nol selisih', async () => {
    if (!reachable) return;
    await job.run();

    // "Tidak ada selisih hari ini" adalah fakta yang berguna. Tanpa baris ini,
    // "rekonsiliasi bersih" tidak bisa dibedakan dari "rekonsiliasi tidak
    // pernah berjalan" — dan keduanya butuh tindakan yang sangat berbeda.
    const baris = await auditTerakhir();
    expect(baris, 'jalan bersih pun harus meninggalkan jejak').toBeDefined();
    expect((baris?.after as { drift_count?: number })?.drift_count).toBe(0);
  });

  // ── AC harfiah ──────────────────────────────────────────────────────────
  it('AC: satu saldo sengaja dirusak → selisihnya tertangkap dan masuk audit', async () => {
    if (!reachable) return;

    // SATU-SATUNYA penulisan langsung `coin_balance` di seluruh repo ini.
    // Persis yang CLAUDE.md aturan 3 larang — dan itulah yang sedang diuji:
    // job ini ada untuk menangkap kode yang melanggarnya.
    await db.updateTable('users').set({ coin_balance: 999 }).where('id', '=', A).execute();

    const hasil = await job.run();

    expect(hasil.drift_count).toBe(1);
    expect(hasil.drifts[0]).toMatchObject({
      userId: A,
      cachedBalance: 999,
      ledgerSum: 100,
      drift: 899,
    });

    const after = (await auditTerakhir())?.after as {
      drift_count: number;
      drifts: { user_id: string; cached: number; ledger: number; drift: number }[];
    };
    expect(after.drift_count).toBe(1);
    // Seluruh selisih disimpan, bukan ringkasannya — daftar user_id yang
    // terdampak adalah hal pertama yang dicari saat menelusuri berbulan-bulan
    // kemudian.
    expect(after.drifts[0]).toMatchObject({ user_id: A, cached: 999, ledger: 100, drift: 899 });
  });

  it('selisih SEKECIL 1 koin tetap tertangkap — ambangnya nol, bukan toleransi', async () => {
    if (!reachable) return;
    await db.updateTable('users').set({ coin_balance: 101 }).where('id', '=', B).execute();

    const hasil = await job.run();
    expect(hasil.drift_count, 'PRD §20: ambang alert adalah "apa pun bukan nol"').toBe(1);
    expect(hasil.drifts[0]?.drift).toBe(1);
  });

  it('selisih NEGATIF (cache lebih kecil dari ledger) juga tertangkap', async () => {
    if (!reachable) return;
    await db.updateTable('users').set({ coin_balance: 40 }).where('id', '=', A).execute();

    const hasil = await job.run();
    expect(hasil.drifts[0]?.drift).toBe(-60);
  });

  it('job TIDAK memperbaiki apa pun — saldo yang rusak tetap rusak setelah dijalankan', async () => {
    if (!reachable) return;
    await db.updateTable('users').set({ coin_balance: 999 }).where('id', '=', A).execute();

    await job.run();

    // Memperbaiki otomatis menghapus satu-satunya bukti tentang APA yang
    // menyebabkannya — dan penyebabnya selalu lebih penting daripada angkanya.
    const sesudah = await db
      .selectFrom('users')
      .select('coin_balance')
      .where('id', '=', A)
      .executeTakeFirstOrThrow();
    expect(sesudah.coin_balance, 'job ini hanya membaca dan mencatat').toBe(999);
  });

  it('dua pengguna menyimpang: keduanya dilaporkan, bukan yang pertama saja', async () => {
    if (!reachable) return;
    await db.updateTable('users').set({ coin_balance: 5 }).where('id', '=', A).execute();
    await db.updateTable('users').set({ coin_balance: 7 }).where('id', '=', B).execute();

    const hasil = await job.run();
    expect(hasil.drift_count).toBe(2);
    expect(new Set(hasil.drifts.map((d) => d.userId))).toEqual(new Set([A, B]));
  });
});
