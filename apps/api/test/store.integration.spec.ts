import { ConflictException, NotFoundException } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase, type DB } from '../src/infra/kysely';
import { StoreService } from '../src/modules/store';
import { CoinLedgerService, InsufficientCoinsError } from '../src/modules/wallet';

/**
 * `ST-01` terhadap DATABASE NYATA — PRD §7 E14 `SR-1` … `SR-6`.
 *
 * Ini JALUR UANG. Aturan 2 (`users.coin_balance` = `SUM(coin_ledger)`)
 * diperiksa di SETIAP titik, termasuk setiap jalur yang ditolak — saldo yang
 * menyimpang saat request gagal jauh lebih sulit ditemukan daripada saat
 * request berhasil.
 */

const URL_DEV = 'postgres://strive:strive_dev_only@localhost:55432/strive';
const url = process.env['DATABASE_URL_TEST'] ?? process.env['DATABASE_URL'] ?? URL_DEV;

const AKU = '00000000-0000-4000-8000-0000000c7001';
const LAIN = '00000000-0000-4000-8000-0000000c7002';

let db: Kysely<DB>;
let store: StoreService;
let reachable = false;
let itemId: string;
let mahalId: string;

const saldo = async (id: string) =>
  (
    await db
      .selectFrom('users')
      .select('coin_balance')
      .where('id', '=', id)
      .executeTakeFirstOrThrow()
  ).coin_balance;

const jumlahPembelian = async () =>
  Number(
    (
      await db
        .selectFrom('store_purchases')
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .executeTakeFirstOrThrow()
    ).n,
  );

/** ATURAN 2 — dijalankan di setiap titik, bukan sekali di akhir. */
async function assertSaldoKonsisten(id = AKU) {
  const r = await sql<{ cache: number; ledger: string }>`
    SELECT u.coin_balance AS cache, COALESCE(SUM(l.amount), 0)::text AS ledger
    FROM users u LEFT JOIN coin_ledger l ON l.user_id = u.id
    WHERE u.id = ${id} GROUP BY u.coin_balance
  `.execute(db);
  const row = r.rows[0]!;
  expect(row.cache, `cache ${row.cache} vs ledger ${row.ledger}`).toBe(Number(row.ledger));
}

beforeAll(async () => {
  db = createDatabase(url);
  store = new StoreService(db, new CoinLedgerService());
  try {
    await db.selectFrom('store_items').select('id').limit(1).execute();
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
  await sql`TRUNCATE users, store_items RESTART IDENTITY CASCADE`.execute(db);
  await db
    .insertInto('users')
    .values([
      { id: AKU, email: 'st01a@uji.test', display_name: 'Aku', coin_balance: 1000 },
      { id: LAIN, email: 'st01b@uji.test', display_name: 'Lain', coin_balance: 1000 },
    ])
    .execute();
  for (const id of [AKU, LAIN]) {
    await db
      .insertInto('coin_ledger')
      .values({ user_id: id, entry_type: 'adjust', amount: 1000, balance_after: 1000 })
      .execute();
  }

  const rows = await db
    .insertInto('store_items')
    .values([
      {
        slug: 'prompt-pack',
        title: 'Prompt Pack',
        kind: 'prompt_library',
        price_coins: 300,
        asset_key: 'rahasia/prompt-pack.zip',
      },
      {
        slug: 'template-mahal',
        title: 'Template Mahal',
        kind: 'workspace_template',
        price_coins: 1500,
        asset_key: 'rahasia/template.zip',
      },
    ])
    .returning(['id', 'slug'])
    .execute();
  itemId = rows.find((r) => r.slug === 'prompt-pack')!.id;
  mahalId = rows.find((r) => r.slug === 'template-mahal')!.id;
});

describe('ST-01 — store: etalase & pembelian (database nyata)', () => {
  it('database siap dipakai', () => {
    expect(reachable, `DATABASE_URL tidak bisa dipakai (${url})`).toBe(true);
  });

  // ── SR-3: satu transaksi ───────────────────────────────────────────────

  it('AC: pembelian mendebit ledger dan menerbitkan hak akses, satu transaksi', async () => {
    if (!reachable) return;
    const r = await store.purchase({ userId: AKU, itemId });

    expect(r).toMatchObject({ item_id: itemId, price_coins: 300, balance: 700 });
    expect(await saldo(AKU)).toBe(700);
    await assertSaldoKonsisten();

    const p = await db
      .selectFrom('store_purchases')
      .selectAll()
      .where('id', '=', r.purchase_id)
      .executeTakeFirstOrThrow();

    expect(p.price_coins, 'harga tidak disalin ke baris pembelian').toBe(300);
    // `ledger_id` yang menyambungkan hak akses ke uangnya. Tanpa itu,
    // menelusuri "siapa membayar apa" butuh menebak lewat waktu.
    expect(p.ledger_id, 'pembelian tidak menunjuk entri ledger-nya').not.toBeNull();

    const entri = await db
      .selectFrom('coin_ledger')
      .selectAll()
      .where('id', '=', p.ledger_id!)
      .executeTakeFirstOrThrow();
    expect(entri).toMatchObject({
      user_id: AKU,
      entry_type: 'spend_store',
      amount: -300,
      balance_after: 700,
      ref_type: 'purchase',
      ref_id: r.purchase_id,
    });
  });

  // ── Jebakan yang paling mahal: ref ke ITEM, bukan ke PEMBELIAN ─────────

  it('DUA pengguna bisa membeli item yang SAMA', async () => {
    if (!reachable) return;
    // `coin_ledger_ref_uniq (ref_type, ref_id, entry_type)` TIDAK memuat
    // `user_id` — dan `CoinLedgerService.findExisting()` mencari dengan kunci
    // yang sama.
    //
    // Kalau `refId` diisi id ITEM, pembeli kedua tidak ditolak: ia mendapat
    // itemnya GRATIS. Lapis idempotensi menemukan entri milik pembeli pertama,
    // menyimpulkan "sudah ditulis", dan mengembalikannya tanpa mendebit siapa
    // pun. Diverifikasi: assert saldo di bawah merah dengan nilai 1000.
    await store.purchase({ userId: AKU, itemId });
    const kedua = await store.purchase({ userId: LAIN, itemId });

    expect(kedua.price_coins).toBe(300);
    expect(await saldo(LAIN)).toBe(700);
    await assertSaldoKonsisten(AKU);
    await assertSaldoKonsisten(LAIN);
    expect(await jumlahPembelian()).toBe(2);
  });

  // ── SR-2 ───────────────────────────────────────────────────────────────

  it('AC: item yang sama dua kali DITOLAK, saldo tidak berubah', async () => {
    if (!reachable) return;
    await store.purchase({ userId: AKU, itemId });
    const sesudah = await saldo(AKU);

    await expect(store.purchase({ userId: AKU, itemId })).rejects.toBeInstanceOf(ConflictException);

    expect(await saldo(AKU), 'koin terpotong untuk pembelian yang ditolak').toBe(sesudah);
    expect(await jumlahPembelian()).toBe(1);
    await assertSaldoKonsisten();
  });

  it('`store_purchases_once` menolak juga kalau service ditembus', async () => {
    if (!reachable) return;
    // Lapis kedua, di bawah pemeriksaan service. Yang ini yang menjaga Retool,
    // skrip perbaikan data, dan psql manual — jalur yang tidak lewat service.
    await store.purchase({ userId: AKU, itemId });

    await expect(
      db
        .insertInto('store_purchases')
        .values({ user_id: AKU, item_id: itemId, price_coins: 300 })
        .execute(),
    ).rejects.toThrow(/store_purchases_once|duplicate key/i);
  });

  // ── SR-4 ───────────────────────────────────────────────────────────────

  it('AC: saldo kurang → NOL baris tersisa di mana pun', async () => {
    if (!reachable) return;
    await expect(store.purchase({ userId: AKU, itemId: mahalId })).rejects.toBeInstanceOf(
      InsufficientCoinsError,
    );

    // Baris `store_purchases` disisipkan SEBELUM debit (ref-nya butuh idnya),
    // jadi yang menjamin SR-4 adalah rollback — bukan urutan pemanggilan.
    // Assert ini yang membedakan keduanya.
    expect(await jumlahPembelian(), 'baris pembelian tertinggal setelah debit gagal').toBe(0);
    expect(await saldo(AKU)).toBe(1000);
    await assertSaldoKonsisten();

    const entri = await db
      .selectFrom('coin_ledger')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('user_id', '=', AKU)
      .where('entry_type', '=', 'spend_store')
      .executeTakeFirstOrThrow();
    expect(Number(entri.n)).toBe(0);
  });

  it('saldo PERSIS harga: boleh, dan berakhir di nol', async () => {
    if (!reachable) return;
    // Batas yang paling mudah salah tanda. `balance_after < 0` yang ditulis
    // `<= 0` akan menolak pembelian yang sah.
    await db.updateTable('users').set({ coin_balance: 300 }).where('id', '=', AKU).execute();
    await db
      .insertInto('coin_ledger')
      .values({ user_id: AKU, entry_type: 'adjust', amount: -700, balance_after: 300 })
      .execute();

    const r = await store.purchase({ userId: AKU, itemId });
    expect(r.balance).toBe(0);
    expect(await saldo(AKU)).toBe(0);
    await assertSaldoKonsisten();
  });

  // ── Idempotensi ────────────────────────────────────────────────────────

  it('Idempotency-Key yang sama: pembelian tidak digandakan', async () => {
    if (!reachable) return;
    const kunci = 'st01-kunci-1';
    const a = await store.purchase({ userId: AKU, itemId, idempotencyKey: kunci });

    // Request kedua ditolak lapis KEDUA (`store_purchases_once`) sebelum
    // sempat menyentuh lapis pertama. Yang penting: koinnya tidak terpotong
    // dua kali, apa pun lapis yang menangkapnya.
    await expect(
      store.purchase({ userId: AKU, itemId, idempotencyKey: kunci }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(await saldo(AKU)).toBe(700);
    expect(await jumlahPembelian()).toBe(1);
    expect(a.balance).toBe(700);
    await assertSaldoKonsisten();
  });

  // ── Item tidak tersedia ────────────────────────────────────────────────

  it('item yang tidak ada → NOT_FOUND', async () => {
    if (!reachable) return;
    await expect(
      store.purchase({ userId: AKU, itemId: '00000000-0000-4000-8000-0000000c70ff' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(await saldo(AKU)).toBe(1000);
  });

  it('item nonaktif tidak bisa DIBELI, tapi yang sudah beli tetap memilikinya', async () => {
    if (!reachable) return;
    await store.purchase({ userId: AKU, itemId });
    await db
      .updateTable('store_items')
      .set({ is_active: false })
      .where('id', '=', itemId)
      .execute();

    // SR-6 menjanjikan UNDUHAN tetap jalan — bukan bahwa item mati masih
    // bisa dibeli orang baru.
    await expect(store.purchase({ userId: LAIN, itemId })).rejects.toBeInstanceOf(
      NotFoundException,
    );

    const punyaku = await store.items(AKU);
    expect(
      punyaku.find((i) => i.id === itemId),
      'item nonaktif hilang dari etalase pemiliknya',
    ).toMatchObject({ owned: true, is_active: false });

    const punyaLain = await store.items(LAIN);
    expect(punyaLain.find((i) => i.id === itemId)).toBeUndefined();
  });

  // ── Etalase ────────────────────────────────────────────────────────────

  it('SR-5: etalase TIDAK PERNAH membawa `asset_key`', async () => {
    if (!reachable) return;
    const daftar = await store.items(AKU);

    // "Pengguna yang belum membeli tidak bisa menebak URL aset" — mengirim
    // kunci objeknya di etalase membatalkan kalimat itu seluruhnya.
    for (const i of daftar) {
      expect(i).not.toHaveProperty('asset_key');
    }
    expect(JSON.stringify(daftar)).not.toContain('rahasia/');
  });

  it('`owned` per PENANYA, bukan global', async () => {
    if (!reachable) return;
    await store.purchase({ userId: AKU, itemId });

    expect((await store.items(AKU)).find((i) => i.id === itemId)?.owned).toBe(true);
    // Kalau join-nya lupa `p.user_id = ?`, item yang dibeli SIAPA PUN akan
    // terbaca "dimiliki" oleh semua orang — dan etalase berhenti bisa dipakai.
    expect((await store.items(LAIN)).find((i) => i.id === itemId)?.owned).toBe(false);
  });

  it('etalase kosong bukan galat', async () => {
    if (!reachable) return;
    await sql`TRUNCATE store_items CASCADE`.execute(db);
    expect(await store.items(AKU)).toEqual([]);
  });
});
