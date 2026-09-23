import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Kysely, sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { KyselyModule, createDatabase, type DB } from '../src/infra/kysely';
import { RedisModule } from '../src/infra/redis';
import { PaymentModule, PaymentWebhookService, hitungTandaTangan } from '../src/modules/payment';

/**
 * `P-03` terhadap DATABASE NYATA — PRD §7 E6 `PA-5` … `PA-8`.
 *
 * Ini satu-satunya jalur penambahan koin BERBAYAR di produk ini, jadi yang
 * diuji bukan "endpoint-nya jalan" melainkan empat hal yang kalau salah
 * berarti kerugian uang sungguhan:
 *
 *   1. Webhook sah yang sama tiga kali menambah koin TEPAT sekali (AC-PA-1).
 *   2. Tanda tangan salah → 401, saldo tidak berubah, `audit_log` mencatatnya
 *      (AC-PA-2).
 *   3. Tanpa webhook, saldo tidak bertambah sama sekali (AC-PA-3).
 *   4. `MIDTRANS_SERVER_KEY` kosong menolak SEMUANYA — bukan menerima semuanya.
 */

const URL_DEV = 'postgres://strive:strive_dev_only@localhost:55432/strive';
const url = process.env['DATABASE_URL_TEST'] ?? process.env['DATABASE_URL'] ?? URL_DEV;

const KUNCI = 'SB-Mid-server-UJI-P03';
const PEMBELI = '00000000-0000-4000-8000-000000030301';
const VERSI = 9301;

let db: Kysely<DB>;
let app: INestApplication;
let base = '';
let svc: PaymentWebhookService;
let reachable = false;
let kunciAsli: string | undefined;

interface Notif {
  order_id: string;
  status_code: string;
  gross_amount: string;
  transaction_status: string;
  signature_key: string;
  [k: string]: unknown;
}

/** Notifikasi Midtrans yang BENAR-BENAR bertanda tangan sah. */
function notif(orderId: string, status = 'settlement', jumlah = '55000.00'): Notif {
  return {
    order_id: orderId,
    status_code: '200',
    gross_amount: jumlah,
    transaction_status: status,
    payment_type: 'qris',
    transaction_id: randomUUID(),
    signature_key: hitungTandaTangan(orderId, '200', jumlah, KUNCI),
  };
}

async function kirim(body: unknown): Promise<{ status: number; json: unknown }> {
  const r = await fetch(`${base}/api/v1/webhooks/payment`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: await r.json().catch(() => null) };
}

/** Satu order `pending` siap dibayar. */
async function order(coins = 2200, amount = 55000): Promise<string> {
  const o = await db
    .insertInto('orders')
    .values({
      user_id: PEMBELI,
      pricing_version: VERSI,
      coins,
      amount_idr: amount,
      idempotency_key: randomUUID(),
      status: 'pending',
      provider: 'midtrans',
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return o.id;
}

async function saldo(): Promise<{ cache: number; ledger: number }> {
  const u = await db
    .selectFrom('users')
    .select('coin_balance')
    .where('id', '=', PEMBELI)
    .executeTakeFirstOrThrow();
  const l = await db
    .selectFrom('coin_ledger')
    .select(sql<string>`coalesce(sum(amount), 0)`.as('j'))
    .where('user_id', '=', PEMBELI)
    .executeTakeFirstOrThrow();
  return { cache: u.coin_balance, ledger: Number(l.j) };
}

beforeAll(async () => {
  db = createDatabase(url);
  try {
    await db.selectFrom('orders').select('id').limit(1).execute();
    reachable = true;
  } catch {
    reachable = false;
    return;
  }
  kunciAsli = process.env['MIDTRANS_SERVER_KEY'];
  process.env['MIDTRANS_SERVER_KEY'] = KUNCI;
  process.env['DATABASE_URL'] = url;

  const moduleRef = await Test.createTestingModule({
    imports: [KyselyModule, RedisModule, PaymentModule],
  }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });
  await app.listen(0, '127.0.0.1');
  const alamat = app.getHttpServer().address() as AddressInfo | null;
  if (!alamat) throw new Error('tidak mendapat port listen');
  base = `http://127.0.0.1:${alamat.port}`;
  svc = app.get(PaymentWebhookService);
}, 30_000);

afterAll(async () => {
  if (kunciAsli === undefined) delete process.env['MIDTRANS_SERVER_KEY'];
  else process.env['MIDTRANS_SERVER_KEY'] = kunciAsli;
  if (app) await app.close();
  if (db) await db.destroy();
});

beforeEach(async () => {
  if (!reachable) return;
  process.env['MIDTRANS_SERVER_KEY'] = KUNCI;
  await sql`TRUNCATE users, pricing_config, audit_log RESTART IDENTITY CASCADE`.execute(db);
  await db
    .insertInto('users')
    .values({
      id: PEMBELI,
      email: 'p03@uji.test',
      display_name: 'Pembeli',
      email_verified: true,
      coin_balance: 0,
    })
    .execute();
  await db
    .insertInto('pricing_config')
    .values({
      version: VERSI,
      coin_price_idr: 25,
      scan_cost_coins: 2400,
      scan_cached_cost_coins: 1200,
      lesson_reward_coins: 10,
      cv_cost_coins: 1500,
      interview_cost_coins: 2000,
      statement_cost_coins: 2000,
      prompt_run_cost_coins: 300,
      freeze_cost_coins: 200,
      packages: JSON.stringify([{ coins: 2200, price_idr: 55000 }]),
    })
    .execute();
});

describe('P-03 — POST /webhooks/payment (database nyata)', () => {
  it('database siap dipakai', () => {
    expect(reachable, `DATABASE_URL tidak bisa dipakai (${url})`).toBe(true);
  });

  // ── AC-PA-1 ────────────────────────────────────────────────────────────

  it('AC-PA-1: webhook settlement yang SAMA tiga kali → koin bertambah sekali', async () => {
    if (!reachable) return;
    const id = await order(2200, 55000);
    const badan = notif(id);

    for (let i = 0; i < 3; i++) {
      const r = await kirim(badan);
      expect(r.status, `kiriman ke-${i + 1}`).toBe(200);
    }

    expect(await saldo()).toEqual({ cache: 2200, ledger: 2200 });

    const o = await db
      .selectFrom('orders')
      .select(['status', 'paid_at'])
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    expect(o.status).toBe('paid');
    expect(o.paid_at).not.toBeNull();

    // Jejak SEMUA webhook, bukan hanya yang menambah koin — itu yang dipakai
    // saat menelusuri dugaan pembayaran ganda.
    const jejak = await db.selectFrom('payments').selectAll().where('order_id', '=', id).execute();
    expect(jejak).toHaveLength(3);
    expect(jejak.every((p) => p.signature_ok)).toBe(true);

    // Dan tepat SATU entri ledger 'purchase'.
    const entri = await db
      .selectFrom('coin_ledger')
      .select(['entry_type', 'amount'])
      .where('ref_type', '=', 'order')
      .where('ref_id', '=', id)
      .execute();
    expect(entri).toEqual([{ entry_type: 'purchase', amount: 2200 }]);
  });

  it('dua webhook settlement BERSAMAAN tetap menambah koin sekali', async () => {
    if (!reachable) return;
    const id = await order(2200, 55000);
    const badan = notif(id);

    const [a, b] = await Promise.all([svc.handle(badan), svc.handle({ ...badan })]);

    // Keduanya BERHASIL — yang kalah balapan menjawab "sudah paid", bukan
    // melempar. Webhook yang dijawab galat akan dikirim ulang selamanya.
    expect([a.credited, b.credited].filter(Boolean)).toHaveLength(1);
    expect(await saldo()).toEqual({ cache: 2200, ledger: 2200 });
  });

  it('webhook tidak menerobos baris order yang sedang dikunci', async () => {
    if (!reachable) return;
    const id = await order(2200, 55000);

    // Tumpang tindih DIPAKSA, bukan diharapkan: transaksi lain memegang kunci
    // barisnya, dan webhook harus berbaris di belakangnya.
    //
    // Apa yang test ini SUNGGUH buktikan, setelah diukur: seluruh transaksi
    // webhook berbaris di belakang kunci baris order. Ia TIDAK membuktikan
    // `.forUpdate()` ada — mencabutnya membuat test ini tetap hijau, karena
    // `UPDATE orders` di ujung transaksi mengambil kunci yang sama. Yang
    // menjaga `.forUpdate()` adalah test 'dua webhook BERSAMAAN' di atas, dan
    // itu sudah dibuktikan merah dengan mencabutnya.
    let lepas = (): void => {};
    const gerbang = new Promise<void>((r) => (lepas = r));
    const penahan = db.transaction().execute(async (trx) => {
      await trx.selectFrom('orders').select('id').where('id', '=', id).forUpdate().execute();
      await gerbang;
    });

    let selesai = false;
    const webhook = svc.handle(notif(id)).then((r) => {
      selesai = true;
      return r;
    });

    await new Promise((r) => setTimeout(r, 500));
    // Diukur SELAGI kunci masih dipegang — bukan setelah semuanya selesai,
    // yang akan hijau untuk transaksi apa pun.
    expect(selesai, 'webhook menerobos kunci baris order').toBe(false);

    lepas();
    await penahan;
    expect((await webhook).credited).toBe(true);
  });

  // ── AC-PA-2 ────────────────────────────────────────────────────────────

  it('AC-PA-2: tanda tangan salah → 401, saldo tidak berubah, tercatat di audit_log', async () => {
    if (!reachable) return;
    const id = await order(2200, 55000);

    const r = await kirim({ ...notif(id), signature_key: 'a'.repeat(128) });
    expect(r.status).toBe(401);

    expect(await saldo()).toEqual({ cache: 0, ledger: 0 });
    const o = await db
      .selectFrom('orders')
      .select('status')
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    expect(o.status).toBe('pending');

    const jejak = await db
      .selectFrom('audit_log')
      .select(['action', 'subject_id'])
      .where('action', '=', 'payment.bad_signature')
      .execute();
    expect(jejak).toHaveLength(1);
    expect(jejak[0]?.subject_id).toBe(id);

    // Dan TIDAK ada baris `payments`: tanda tangan diperiksa sebelum apa pun.
    const p = await db.selectFrom('payments').selectAll().where('order_id', '=', id).execute();
    expect(p).toHaveLength(0);
  });

  it('kunci server KOSONG menolak semuanya, bukan menerima semuanya', async () => {
    if (!reachable) return;
    const id = await order(2200, 55000);
    // Tanda tangan dihitung dengan kunci kosong — persis yang bisa dilakukan
    // siapa pun yang tahu URL-nya, karena seluruh bahannya ada di badan
    // request. Ini kegagalan konfigurasi yang paling mungkin terjadi sungguhan.
    const palsu = { ...notif(id), signature_key: hitungTandaTangan(id, '200', '55000.00', '') };
    process.env['MIDTRANS_SERVER_KEY'] = '';

    expect((await kirim(palsu)).status).toBe(401);
    expect(await saldo()).toEqual({ cache: 0, ledger: 0 });
  });

  it('tanda tangan sah untuk jumlah LAIN tidak berlaku untuk order ini', async () => {
    if (!reachable) return;
    const id = await order(2200, 55000);
    // Ditandatangani benar, tapi untuk gross_amount berbeda. Tanda tangannya
    // sah secara matematis untuk pesan itu — dan tetap harus ditolak, karena
    // pesannya bukan yang dikirimkan.
    const r = await kirim({ ...notif(id, 'settlement', '999.00'), gross_amount: '55000.00' });
    expect(r.status).toBe(401);
    expect(await saldo()).toEqual({ cache: 0, ledger: 0 });
  });

  // ── AC-PA-3 ────────────────────────────────────────────────────────────

  it('AC-PA-3: tanpa webhook, saldo tidak bertambah sama sekali', async () => {
    if (!reachable) return;
    await order(2200, 55000);
    // Order dibuat; halaman "pembayaran berhasil" bisa dibuka siapa saja.
    expect(await saldo()).toEqual({ cache: 0, ledger: 0 });
  });

  // ── Status lain ────────────────────────────────────────────────────────

  it('deny dan cancel → order failed, tanpa koin', async () => {
    if (!reachable) return;
    for (const status of ['deny', 'cancel']) {
      const id = await order(2200, 55000);
      expect((await kirim(notif(id, status))).status).toBe(200);
      const o = await db
        .selectFrom('orders')
        .select('status')
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      expect(o.status, status).toBe('failed');
    }
    expect(await saldo()).toEqual({ cache: 0, ledger: 0 });
  });

  it('expire → order expired, tanpa koin', async () => {
    if (!reachable) return;
    const id = await order(2200, 55000);
    expect((await kirim(notif(id, 'expire'))).status).toBe(200);
    const o = await db
      .selectFrom('orders')
      .select('status')
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    expect(o.status).toBe('expired');
    expect(await saldo()).toEqual({ cache: 0, ledger: 0 });
  });

  it('expire yang tiba SETELAH settlement tidak membatalkan pembayaran', async () => {
    if (!reachable) return;
    const id = await order(2200, 55000);
    await kirim(notif(id, 'settlement'));
    expect((await kirim(notif(id, 'expire'))).status).toBe(200);

    // Urutan notifikasi tidak dijamin. Menurunkan order yang sudah lunas akan
    // membuat pembayaran hilang dari pembukuan sementara koinnya sudah di
    // tangan pengguna — selisih yang baru terlihat saat rekonsiliasi.
    const o = await db
      .selectFrom('orders')
      .select('status')
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    expect(o.status).toBe('paid');
    expect(await saldo()).toEqual({ cache: 2200, ledger: 2200 });
  });

  it('status yang tidak ditangani dicatat, bukan didiamkan', async () => {
    if (!reachable) return;
    const id = await order(2200, 55000);
    expect((await kirim(notif(id, 'capture'))).status).toBe(200);

    const jejak = await db
      .selectFrom('audit_log')
      .select('action')
      .where('action', '=', 'payment.unhandled_status')
      .execute();
    expect(jejak).toHaveLength(1);
    expect(await saldo()).toEqual({ cache: 0, ledger: 0 });
  });

  // ── Badan yang tidak wajar ─────────────────────────────────────────────

  it('order yang tidak dikenal → 200 (bukan 404) dan tercatat', async () => {
    if (!reachable) return;
    const hantu = randomUUID();
    expect((await kirim(notif(hantu))).status).toBe(200);

    // 404 membuat Midtrans mengirim ulang selamanya untuk sesuatu yang tidak
    // akan pernah ada.
    const jejak = await db
      .selectFrom('audit_log')
      .select('action')
      .where('action', '=', 'payment.unknown_order')
      .execute();
    expect(jejak).toHaveLength(1);
  });

  it('badan tidak lengkap ditolak sebelum menyentuh apa pun', async () => {
    if (!reachable) return;
    const busukTapiObjek = [
      {},
      { order_id: 'x' },
      {
        order_id: 123,
        status_code: '200',
        gross_amount: '1.00',
        signature_key: 'a',
        transaction_status: 's',
      },
      { order_id: 'x', status_code: '200', gross_amount: '1.00', transaction_status: 's' },
    ];
    for (const busuk of busukTapiObjek) {
      const r = await kirim(busuk);
      // 200: badan yang salah bentuk tidak akan menjadi benar kalau dikirim
      // ulang, dan Midtrans mengulang apa pun yang bukan 200.
      expect(r.status, JSON.stringify(busuk)).toBe(200);
    }
    const jejak = await db
      .selectFrom('audit_log')
      .select('action')
      .where('action', '=', 'payment.malformed')
      .execute();
    expect(jejak).toHaveLength(busukTapiObjek.length);
    expect(await saldo()).toEqual({ cache: 0, ledger: 0 });
  });

  it('badan yang bukan objek JSON ditolak parser, sebelum kode kita jalan', async () => {
    if (!reachable) return;
    // `express.json()` berjalan `strict`, jadi `null` dan string telanjang
    // ditolak 400 tanpa pernah menyentuh controller. Dicatat di sini supaya
    // jelas itu perilaku yang diketahui, bukan lubang: yang penting uangnya
    // tidak bergerak, dan badan seperti ini tidak pernah datang dari Midtrans.
    for (const busuk of [null, 'bukan objek']) {
      const r = await kirim(busuk);
      expect(r.status, JSON.stringify(busuk)).toBe(400);
    }
    expect(await saldo()).toEqual({ cache: 0, ledger: 0 });
  });

  it('gross_amount sebagai ANGKA (bukan string) ditolak', async () => {
    if (!reachable) return;
    const id = await order(2200, 55000);
    const r = await kirim({ ...notif(id), gross_amount: 55000 });
    // Midtrans selalu mengirim string. Menerima number berarti menerima badan
    // yang bukan dari Midtrans — dan tanda tangannya tidak akan pernah cocok.
    expect(r.status).toBe(200);
    expect(await saldo()).toEqual({ cache: 0, ledger: 0 });
  });
});
