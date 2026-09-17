import { ForbiddenException } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase, type DB } from '../src/infra/kysely';
import { CheckoutService, PricingConfigService, SnapClient } from '../src/modules/payment';

/**
 * `P-02` terhadap DATABASE NYATA.
 *
 * ── Apa yang BISA dan TIDAK BISA dibuktikan di sini ──
 *
 * AC-nya dua kalimat, dan hanya satu yang bisa kubuktikan:
 *
 *   ✅ "Order tercipta idempoten terhadap Idempotency-Key"
 *   ❌ "Respons memuat token Snap dan redirect_url yang VALID"
 *
 * Yang kedua menuntut panggilan ke Midtrans sungguhan, dan
 * `MIDTRANS_SERVER_KEY` kosong — kredensialnya butuh akun vendor, sama seperti
 * `F-05` butuh akun cloud. `SnapClient` karena itu diganti ganda di bawah:
 * bentuk responsnya diketahui dari dokumentasi Midtrans, tapi **keabsahan
 * tokennya tidak diuji**, dan aku tidak mau test ini terlihat seperti
 * membuktikan sesuatu yang tidak ia buktikan.
 */

const URL_DEV = 'postgres://strive:strive_dev_only@localhost:55432/strive';
const url = process.env['DATABASE_URL_TEST'] ?? process.env['DATABASE_URL'] ?? URL_DEV;

let db: Kysely<DB>;
let checkout: CheckoutService;
let snapCalls = 0;
let reachable = false;

const USER = '00000000-0000-4000-8000-0000000002a1';
const ADMIN = '00000000-0000-4000-8000-0000000002a2';

/** Ganda Snap: menghitung panggilan, supaya idempotensi bisa dibuktikan sampai ke vendor. */
class SnapGanda extends SnapClient {
  override configured(): boolean {
    return true;
  }
  override async createTransaction(o: { orderId: string }) {
    snapCalls++;
    return { token: `tok-${o.orderId}`, redirect_url: `https://sandbox.example/${o.orderId}` };
  }
}

beforeAll(async () => {
  db = createDatabase(url);
  const pricing = new PricingConfigService(db);
  checkout = new CheckoutService(db, pricing, new SnapGanda());
  try {
    await db.selectFrom('orders').select('id').limit(1).execute();
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
  snapCalls = 0;
  await sql`TRUNCATE users, pricing_config RESTART IDENTITY CASCADE`.execute(db);

  await db
    .insertInto('users')
    .values([
      {
        id: ADMIN,
        email: 'padmin@uji.test',
        password_hash: 'x',
        display_name: 'Admin',
        role: 'superadmin',
        email_verified: true,
      },
      {
        id: USER,
        email: 'p1@uji.test',
        password_hash: 'x',
        display_name: 'Beli',
        email_verified: true,
      },
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
      packages: JSON.stringify([
        { id: 'p1', name: 'Starter', coins: 2200, price_idr: 55000 },
        { id: 'p2', name: 'Plus', coins: 5000, price_idr: 120000 },
      ]),
      created_by: ADMIN,
    })
    .execute();
});

describe('CheckoutService (database nyata)', () => {
  it('database siap dipakai', () => {
    expect(reachable, `DATABASE_URL tidak bisa dipakai (${url})`).toBe(true);
  });

  it('membuat order pending dengan harga dari versi aktif (PA-2, PA-4)', async () => {
    if (!reachable) return;
    const r = await checkout.checkout({ userId: USER, coins: 2200, idempotencyKey: 'k-1' });

    expect(r).toMatchObject({
      coins: 2200,
      amount_idr: 55000,
      pricing_version: 1,
      status: 'pending',
      reused: false,
    });

    const o = await db
      .selectFrom('orders')
      .selectAll()
      .where('id', '=', r.order_id)
      .executeTakeFirstOrThrow();
    // PA-4: versi harga disimpan PER ORDER, supaya order lama tetap terbaca
    // harganya setelah harga berubah.
    expect(o.pricing_version).toBe(1);
    expect(o.status).toBe('pending');
  });

  // ── AC yang bisa dibuktikan ─────────────────────────────────────────────
  it('AC: request ulang dengan Idempotency-Key yang sama mengembalikan order yang SAMA', async () => {
    if (!reachable) return;
    const a = await checkout.checkout({ userId: USER, coins: 2200, idempotencyKey: 'k-sama' });
    const b = await checkout.checkout({ userId: USER, coins: 2200, idempotencyKey: 'k-sama' });

    expect(b.order_id).toBe(a.order_id);
    expect(b.reused).toBe(true);

    const semua = await db.selectFrom('orders').selectAll().execute();
    expect(semua, 'order kedua terbuat — idempotensi bocor').toHaveLength(1);

    // Dan Midtrans TIDAK ditembak dua kali. Idempotensi yang berhenti di
    // database kita tapi tetap membuat transaksi Snap kedua akan meninggalkan
    // transaksi menggantung yang bisa dibayar pengguna.
    expect(snapCalls).toBe(1);
  });

  it('idempotensi dijamin DATABASE, bukan pengecekan di kode', async () => {
    if (!reachable) return;
    // Menembus service, langsung ke database — penjaga terakhir harus menahan.
    await checkout.checkout({ userId: USER, coins: 2200, idempotencyKey: 'k-db' });
    await expect(
      db
        .insertInto('orders')
        .values({
          user_id: USER,
          pricing_version: 1,
          coins: 2200,
          amount_idr: 55000,
          idempotency_key: 'k-db',
        })
        .execute(),
    ).rejects.toThrow(/idempotency_key/);
  });

  it('kunci berbeda menghasilkan order berbeda', async () => {
    if (!reachable) return;
    const a = await checkout.checkout({ userId: USER, coins: 2200, idempotencyKey: 'k-a' });
    const b = await checkout.checkout({ userId: USER, coins: 5000, idempotencyKey: 'k-b' });
    expect(a.order_id).not.toBe(b.order_id);
    expect(b.amount_idr).toBe(120000);
  });

  // ── PA-5: koin TIDAK bertambah di jalur ini ─────────────────────────────
  it('PA-5: checkout TIDAK menambah koin — saldo tetap nol', async () => {
    if (!reachable) return;
    await checkout.checkout({ userId: USER, coins: 2200, idempotencyKey: 'k-koin' });

    const u = await db
      .selectFrom('users')
      .select('coin_balance')
      .where('id', '=', USER)
      .executeTakeFirstOrThrow();
    const ledger = await db
      .selectFrom('coin_ledger')
      .selectAll()
      .where('user_id', '=', USER)
      .execute();

    // Apa pun yang menambah koin dari jalur yang bisa dipanggil klien adalah
    // koin gratis untuk siapa pun yang tahu URL-nya. Koin hanya dari webhook
    // bertanda tangan (P-03).
    expect(u.coin_balance).toBe(0);
    expect(ledger).toHaveLength(0);
  });

  // ── PA-10 ───────────────────────────────────────────────────────────────
  it('PA-10: pengguna yang belum verifikasi email tidak bisa top-up', async () => {
    if (!reachable) return;
    await db.updateTable('users').set({ email_verified: false }).where('id', '=', USER).execute();

    await expect(
      checkout.checkout({ userId: USER, coins: 2200, idempotencyKey: 'k-belum' }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(await db.selectFrom('orders').selectAll().execute()).toHaveLength(0);
  });

  it('paket yang tidak ada di harga aktif ditolak, bukan dibuatkan order', async () => {
    if (!reachable) return;
    await expect(
      checkout.checkout({ userId: USER, coins: 12345, idempotencyKey: 'k-aneh' }),
    ).rejects.toBeTruthy();
    expect(await db.selectFrom('orders').selectAll().execute()).toHaveLength(0);
  });

  it('SnapClient sungguhan MENOLAK jalan tanpa kredensial, bukan mengembalikan token palsu', async () => {
    if (!reachable) return;
    const asli = new SnapClient();
    const kunciAda = asli.configured();

    if (!kunciAda) {
      // Token palsu akan mengalir ke klien, membuka halaman yang tidak ada,
      // dan gejalanya muncul jauh dari sebabnya.
      await expect(
        asli.createTransaction({
          orderId: 'x',
          amountIdr: 1000,
          coins: 10,
          customer: { email: 'a@b.c', name: 'A' },
        }),
      ).rejects.toBeTruthy();
    }
    // Kalau kredensialnya ADA di lingkungan ini, test ini tidak berlaku —
    // dan itu berarti AC "token valid" akhirnya bisa diuji sungguhan.
    expect(typeof kunciAda).toBe('boolean');
  });
});
