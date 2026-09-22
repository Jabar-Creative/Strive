import { Kysely, sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase, type DB } from '../src/infra/kysely';

/**
 * `SA-01` terhadap DATABASE NYATA.
 *
 * Dua AC, dan yang kedua tidak bisa diuji dengan membaca migrasi:
 *   "Satu transaksi bisa ditelusuri dari order sampai entri ledger dalam SATU query"
 *   "Koneksi Retool memakai role read-only"
 *
 * Untuk yang kedua dipakai `SET ROLE strive_readonly` di dalam transaksi —
 * itu menjalankan query SEBAGAI role tersebut, jadi yang diuji adalah GRANT
 * sungguhan, bukan niat migrasinya.
 */

const URL_DEV = 'postgres://strive:strive_dev_only@localhost:55432/strive';
const url = process.env['DATABASE_URL_TEST'] ?? process.env['DATABASE_URL'] ?? URL_DEV;

let db: Kysely<DB>;
let reachable = false;

const USER = '00000000-0000-4000-8000-0000000sa001'.replace(/sa/, 'de');
const ADMIN = '00000000-0000-4000-8000-0000000sa002'.replace(/sa/, 'de');
let orderId: string;

beforeAll(async () => {
  db = createDatabase(url);
  try {
    await sql`SELECT 1 FROM admin_transactions LIMIT 1`.execute(db);
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
  await sql`TRUNCATE users, pricing_config RESTART IDENTITY CASCADE`.execute(db);
  await db
    .insertInto('users')
    .values([
      {
        id: ADMIN,
        email: 'sa0@uji.test',
        display_name: 'Admin',
        role: 'superadmin',
      },
      { id: USER, email: 'sa1@uji.test', display_name: 'Beli' },
    ])
    .execute();
  await db
    .insertInto('pricing_config')
    .values({
      version: 1,
      coin_price_idr: 25,
      scan_cost_coins: 2400,
      scan_cached_cost_coins: 1200,
      lesson_reward_coins: 10,
      cv_cost_coins: 1500,
      interview_cost_coins: 2000,
      statement_cost_coins: 2000,
      prompt_run_cost_coins: 300,
      freeze_cost_coins: 200,
      packages: JSON.stringify([{ id: 'p1', name: 'Starter', coins: 2200, price_idr: 55000 }]),
      created_by: ADMIN,
    })
    .execute();

  const o = await db
    .insertInto('orders')
    .values({
      user_id: USER,
      pricing_version: 1,
      coins: 2200,
      amount_idr: 55000,
      idempotency_key: 'sa-1',
      status: 'paid',
      paid_at: sql`now()`,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  orderId = o.id;

  await db
    .insertInto('payments')
    .values({
      order_id: orderId,
      provider: 'midtrans',
      event_type: 'settlement',
      raw_payload: JSON.stringify({ transaction_status: 'settlement' }),
      signature_ok: true,
    })
    .execute();
});

/** Menjalankan `fn` SEBAGAI role read-only, lalu mengembalikan peran semula. */
async function sebagaiReadonly<T>(fn: (trx: Kysely<DB>) => Promise<T>): Promise<T> {
  return db.transaction().execute(async (trx) => {
    await sql`SET LOCAL ROLE strive_readonly`.execute(trx);
    return fn(trx as unknown as Kysely<DB>);
  });
}

describe('View admin + role read-only (database nyata)', () => {
  it('view-nya ada dan bisa dibaca', () => {
    expect(
      reachable,
      `DATABASE_URL tidak bisa dipakai, atau migrasi 006 belum jalan (${url})`,
    ).toBe(true);
  });

  // ── AC 1 ────────────────────────────────────────────────────────────────
  it('AC: satu transaksi ditelusuri dari order sampai ledger dalam SATU query', async () => {
    if (!reachable) return;
    await db
      .insertInto('coin_ledger')
      .values({
        user_id: USER,
        entry_type: 'purchase',
        amount: 2200,
        balance_after: 2200,
        ref_type: 'order',
        ref_id: orderId,
      })
      .execute();

    const r = await sql<Record<string, unknown>>`
      SELECT * FROM admin_transactions WHERE order_id = ${orderId}
    `.execute(db);

    const baris = r.rows[0]!;
    // Empat tabel dalam satu baris: orders, users, payments, coin_ledger.
    // Tanpa view ini, orang yang menelusuri insiden pembayaran harus
    // merangkainya sendiri — saat sedang panik, di jam yang salah.
    expect(baris).toMatchObject({
      order_status: 'paid',
      coins_ordered: 2200,
      amount_idr: 55000,
      email: 'sa1@uji.test',
      payment_event_type: 'settlement',
      payment_signature_ok: true,
      ledger_entry_type: 'purchase',
      ledger_amount: 2200,
      paid_without_ledger: false,
    });
  });

  it('paid_without_ledger menandai uang masuk tanpa koin keluar', async () => {
    if (!reachable) return;
    // Order `paid` TANPA entri ledger. Itu keadaan yang tidak boleh ada, dan
    // view ini membuatnya terlihat tanpa menghitung apa pun.
    const r = await sql<{ paid_without_ledger: boolean }>`
      SELECT paid_without_ledger FROM admin_transactions WHERE order_id = ${orderId}
    `.execute(db);
    expect(r.rows[0]?.paid_without_ledger).toBe(true);
  });

  it('order pending tetap muncul — justru itu yang paling sering ditelusuri', async () => {
    if (!reachable) return;
    await db
      .insertInto('orders')
      .values({
        user_id: USER,
        pricing_version: 1,
        coins: 2200,
        amount_idr: 55000,
        idempotency_key: 'sa-pending',
        status: 'pending',
      })
      .execute();

    const r = await sql<{ n: string }>`
      SELECT count(*)::text AS n FROM admin_transactions WHERE order_status = 'pending'
    `.execute(db);
    expect(Number(r.rows[0]!.n)).toBe(1);
  });

  it('admin_audit membawa identitas pelaku, bukan cuma uuid', async () => {
    if (!reachable) return;
    await db
      .insertInto('audit_log')
      .values({
        actor_id: ADMIN,
        action: 'pricing.publish',
        subject_type: 'pricing',
        subject_id: '1',
      })
      .execute();

    const r = await sql<{ actor_email: string; actor_role: string }>`
      SELECT actor_email, actor_role FROM admin_audit WHERE action = 'pricing.publish'
    `.execute(db);
    expect(r.rows[0]).toMatchObject({ actor_email: 'sa0@uji.test', actor_role: 'superadmin' });
  });

  // ── AC 2 ────────────────────────────────────────────────────────────────
  it('AC: role read-only BISA membaca view', async () => {
    if (!reachable) return;
    const n = await sebagaiReadonly(async (trx) => {
      const r = await sql<{
        n: string;
      }>`SELECT count(*)::text AS n FROM admin_transactions`.execute(trx);
      return Number(r.rows[0]!.n);
    });
    expect(n).toBeGreaterThan(0);
  });

  it('AC: role read-only TIDAK BISA menulis apa pun', async () => {
    if (!reachable) return;
    // SA-2 mewajibkan semua aksi tulis lewat endpoint resmi. Role inilah yang
    // membuat aturan itu ditegakkan DATABASE, bukan disiplin orang yang
    // membuka Retool pada hari yang buruk.
    for (const [nama, jalankan] of [
      ['UPDATE users', (t: Kysely<DB>) => sql`UPDATE users SET coin_balance = 999`.execute(t)],
      [
        'INSERT coin_ledger',
        (t: Kysely<DB>) =>
          sql`INSERT INTO coin_ledger (user_id, entry_type, amount, balance_after)
            VALUES (${USER}, 'adjust', 1, 1)`.execute(t),
      ],
      ['DELETE orders', (t: Kysely<DB>) => sql`DELETE FROM orders`.execute(t)],
      [
        'UPDATE view',
        (t: Kysely<DB>) => sql`UPDATE admin_transactions SET coins_ordered = 1`.execute(t),
      ],
    ] as const) {
      await expect(
        sebagaiReadonly((trx) => jalankan(trx)),
        `${nama} TIDAK ditolak — Retool bisa menulis`,
      ).rejects.toBeTruthy();
    }
  });

  it('role read-only TIDAK BISA membaca tabel mentah — hanya view', async () => {
    if (!reachable) return;
    // Retool yang bisa membaca `users` langsung akan menampilkan
    // kolom sensitif `users` di layar seseorang.
    await expect(
      sebagaiReadonly((trx) => sql`SELECT * FROM users LIMIT 1`.execute(trx)),
    ).rejects.toBeTruthy();
    await expect(
      sebagaiReadonly((trx) => sql`SELECT * FROM coin_ledger LIMIT 1`.execute(trx)),
    ).rejects.toBeTruthy();
  });

  it('jumlah tabel domain tetap 32 — view bukan tabel', async () => {
    if (!reachable) return;
    const r = await sql<{ n: string }>`
      SELECT count(*)::text AS n FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        AND table_name NOT LIKE 'lesson_attempts\\_%'
    `.execute(db);
    // 33 → 32 sejak migrasi 007 membuang `refresh_tokens` (isu #47).
    expect(Number(r.rows[0]!.n), 'view tidak boleh menambah hitungan tabel di CI').toBe(32);
  });
});
