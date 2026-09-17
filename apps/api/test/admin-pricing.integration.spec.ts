import { Kysely, sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase, type DB } from '../src/infra/kysely';
import { PricingConfigService, type PublishPricingInput } from '../src/modules/payment';

/**
 * `SA-02` terhadap DATABASE NYATA.
 *
 * AC-nya dua kalimat, keduanya soal hal yang tidak bisa dilihat dari kode:
 *   "Perubahan harga tercatat di audit_log DENGAN PELAKUNYA"
 *   "Harga lama tetap terbaca untuk order lama"
 *
 * Yang kedua diuji dengan benar-benar membuat order di harga lama, lalu
 * menerbitkan harga baru, lalu membaca ulang order itu.
 */

const URL_DEV = 'postgres://strive:strive_dev_only@localhost:55432/strive';
const url = process.env['DATABASE_URL_TEST'] ?? process.env['DATABASE_URL'] ?? URL_DEV;

let db: Kysely<DB>;
let pricing: PricingConfigService;
let reachable = false;

const ADMIN = '00000000-0000-4000-8000-0000000ad001'.replace(/ad/, 'ef');
const USER = '00000000-0000-4000-8000-0000000ad002'.replace(/ad/, 'ef');

const harga = (coinPriceIdr: number): PublishPricingInput => ({
  coinPriceIdr,
  scanCostCoins: 2400,
  scanCachedCostCoins: 1200,
  lessonRewardCoins: 10,
  cvCostCoins: 1500,
  interviewCostCoins: 2000,
  statementCostCoins: 2000,
  promptRunCostCoins: 300,
  freezeCostCoins: 200,
  packages: [{ id: 'p1', name: 'Starter', coins: 2200, price_idr: coinPriceIdr * 2200 }],
});

beforeAll(async () => {
  db = createDatabase(url);
  pricing = new PricingConfigService(db);
  try {
    await db.selectFrom('pricing_config').select('version').limit(1).execute();
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
  await sql`TRUNCATE users, pricing_config, audit_log RESTART IDENTITY CASCADE`.execute(db);
  await db
    .insertInto('users')
    .values([
      {
        id: ADMIN,
        email: 'ad0@uji.test',
        password_hash: 'x',
        display_name: 'Admin',
        role: 'superadmin',
      },
      { id: USER, email: 'ad1@uji.test', password_hash: 'x', display_name: 'Beli' },
    ])
    .execute();
});

describe('PATCH /admin/pricing (database nyata)', () => {
  it('database siap dipakai', () => {
    expect(reachable, `DATABASE_URL tidak bisa dipakai (${url})`).toBe(true);
  });

  // ── AC 1 ────────────────────────────────────────────────────────────────
  it('AC: penerbitan harga tercatat di audit_log dengan PELAKUNYA', async () => {
    if (!reachable) return;
    const v = await pricing.publishNewVersion(harga(25), ADMIN);

    const a = await db
      .selectFrom('audit_log')
      .selectAll()
      .where('action', '=', 'pricing.publish')
      .executeTakeFirstOrThrow();

    expect(a.actor_id, 'pelaku tidak tercatat — audit tanpa pelaku tidak menjawab apa pun').toBe(
      ADMIN,
    );
    expect(a.subject_id).toBe(String(v.version));
    expect((a.after as { coin_price_idr: number }).coin_price_idr).toBe(25);
  });

  it('audit memuat versi SEBELUMNYA juga — "naik dari berapa" butuh dua angka', async () => {
    if (!reachable) return;
    await pricing.publishNewVersion(harga(25), ADMIN);
    const v2 = await pricing.publishNewVersion(harga(30), ADMIN);

    const a = await db
      .selectFrom('audit_log')
      .selectAll()
      .where('subject_id', '=', String(v2.version))
      .executeTakeFirstOrThrow();

    expect((a.before as { version: number | null }).version).toBe(1);
    expect((a.after as { version: number }).version).toBe(2);
  });

  it('audit ditulis DI DALAM transaksi yang sama — tidak ada versi tanpa jejak', async () => {
    if (!reachable) return;
    await pricing.publishNewVersion(harga(25), ADMIN);
    await pricing.publishNewVersion(harga(30), ADMIN);
    await pricing.publishNewVersion(harga(35), ADMIN);

    const versi = await db.selectFrom('pricing_config').select('version').execute();
    const jejak = await db
      .selectFrom('audit_log')
      .select('subject_id')
      .where('action', '=', 'pricing.publish')
      .execute();

    // Jumlahnya harus sama persis. Versi tanpa jejak adalah harga yang berubah
    // tanpa ada yang mengaku.
    expect(jejak).toHaveLength(versi.length);
    expect(new Set(jejak.map((x) => x.subject_id))).toEqual(
      new Set(versi.map((x) => String(x.version))),
    );
  });

  // ── AC 2 ────────────────────────────────────────────────────────────────
  it('AC: harga LAMA tetap terbaca untuk order lama setelah harga berubah', async () => {
    if (!reachable) return;
    const v1 = await pricing.publishNewVersion(harga(25), ADMIN);

    const order = await db
      .insertInto('orders')
      .values({
        user_id: USER,
        pricing_version: v1.version,
        coins: 2200,
        amount_idr: 55000,
        idempotency_key: 'ad-1',
        status: 'paid',
      })
      .returning(['id', 'pricing_version', 'amount_idr'])
      .executeTakeFirstOrThrow();

    // Harga naik 20%.
    await pricing.publishNewVersion(harga(30), ADMIN);

    const sesudah = await db
      .selectFrom('orders')
      .innerJoin('pricing_config', 'pricing_config.version', 'orders.pricing_version')
      .select(['orders.amount_idr', 'pricing_config.coin_price_idr', 'pricing_config.version'])
      .where('orders.id', '=', order.id)
      .executeTakeFirstOrThrow();

    // Order lama masih menunjuk versi 1, dan versi 1 masih ada dengan angka
    // aslinya. Kalau `publishNewVersion` mengUBAH baris alih-alih menambah,
    // order yang sudah DIBAYAR akan diam-diam berganti harga.
    expect(sesudah.version).toBe(v1.version);
    expect(sesudah.coin_price_idr).toBe(25);
    expect(sesudah.amount_idr).toBe(55000);
  });

  it('versi lama tidak pernah diubah — append-only seperti coin_ledger', async () => {
    if (!reachable) return;
    const v1 = await pricing.publishNewVersion(harga(25), ADMIN);
    const sebelum = await db
      .selectFrom('pricing_config')
      .selectAll()
      .where('version', '=', v1.version)
      .executeTakeFirstOrThrow();

    await pricing.publishNewVersion(harga(99), ADMIN);

    const sesudah = await db
      .selectFrom('pricing_config')
      .selectAll()
      .where('version', '=', v1.version)
      .executeTakeFirstOrThrow();
    expect(sesudah).toEqual(sebelum);
  });

  it('versi baru yang jadi aktif, bukan yang lama', async () => {
    if (!reachable) return;
    await pricing.publishNewVersion(harga(25), ADMIN);
    const v2 = await pricing.publishNewVersion(harga(30), ADMIN);

    const aktif = await pricing.getCurrentVersion();
    expect(aktif?.version).toBe(v2.version);
    expect(aktif?.coin_price_idr).toBe(30);
  });
});
