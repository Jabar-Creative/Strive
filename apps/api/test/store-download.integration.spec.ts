import { NotFoundException } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase, type DB } from '../src/infra/kysely';
import { StorageService, createS3FromEnv } from '../src/infra/storage';
import { CoinLedgerService } from '../src/modules/wallet';
import { StoreService } from '../src/modules/store';

/**
 * `ST-02` terhadap DATABASE NYATA — dua AC yang tidak bisa dilihat dari kode:
 *
 *   SR-5: "Unduhan lewat signed URL 15 menit. Pengguna yang belum membeli
 *         tidak bisa menebak URL aset."
 *   SR-6: "Item yang dinonaktifkan tetap bisa diunduh oleh yang sudah
 *         membeli."
 *
 * Penandatanganan URL S3 LOKAL (presigner menghitung tanda tangan di proses,
 * tanpa memanggil MinIO), jadi test ini tak bergantung container MinIO —
 * yang diuji bentuk + jangka waktu + KEPEMILIKAN, bukan kecepatan jaringan.
 */

const URL_DEV = 'postgres://strive:strive_dev_only@localhost:55432/strive';
const url = process.env['DATABASE_URL_TEST'] ?? process.env['DATABASE_URL'] ?? URL_DEV;

const PEMBELI = '00000000-0000-4000-8000-00000005a201';
const LAIN = '00000000-0000-4000-8000-00000005a202';
const ITEM_AKTIF = '00000000-0000-4000-8000-00000005b201';
const ITEM_MATI = '00000000-0000-4000-8000-00000005b202';
const BELI_AKTIF = '00000000-0000-4000-8000-00000005c201';
const BELI_MATI = '00000000-0000-4000-8000-00000005c202';

let db: Kysely<DB>;
let store: StoreService;
let reachable = false;

const koinPalsu = {
  write: async () => ({ entryId: 'x', balanceAfter: 0 }),
  hold: async () => ({ holdId: 'x' }),
  settle: async () => undefined,
  release: async () => undefined,
} as unknown as CoinLedgerService;

beforeAll(async () => {
  db = createDatabase(url);
  // S3Client sungguhan dari env (presign LOKAL, tanpa jaringan).
  store = new StoreService(db, koinPalsu, new StorageService(createS3FromEnv()));
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
  await sql`TRUNCATE users, store_items, store_purchases RESTART IDENTITY CASCADE`.execute(db);
  await db
    .insertInto('users')
    .values([
      { id: PEMBELI, email: 'st02-a@uji.test', display_name: 'Pembeli' },
      { id: LAIN, email: 'st02-b@uji.test', display_name: 'Lain' },
    ])
    .execute();
  await db
    .insertInto('store_items')
    .values([
      {
        id: ITEM_AKTIF,
        slug: 'pustaka-prompt',
        title: 'Pustaka Prompt',
        kind: 'prompt_library',
        price_coins: 400,
        is_active: true,
        asset_key: 'aset/pustaka-prompt.zip',
      },
      {
        id: ITEM_MATI,
        slug: 'template-skripsi',
        title: 'Template Skripsi',
        kind: 'workspace_template',
        price_coins: 700,
        is_active: false, // SR-6: nonaktif tapi sudah dibeli → tetap bisa diunduh
        asset_key: 'aset/template-skripsi.docx',
      },
    ])
    .execute();
  await db
    .insertInto('store_purchases')
    .values([
      { id: BELI_AKTIF, user_id: PEMBELI, item_id: ITEM_AKTIF, price_coins: 400 },
      { id: BELI_MATI, user_id: PEMBELI, item_id: ITEM_MATI, price_coins: 700 },
    ])
    .execute();
});

describe('GET /store/purchases/:id/download (SR-5 + SR-6)', () => {
  it('database siap dipakai', () => {
    expect(reachable, `DATABASE_URL tidak bisa dipakai (${url})`).toBe(true);
  });

  it('SR-5: pembeli menerima signed URL berjangka 15 MENIT', async () => {
    if (!reachable) return;
    const hasil = await store.downloadUrl(PEMBELI, BELI_AKTIF);

    expect(hasil.url).toContain('X-Amz-Expires=900');
    expect(hasil.url).toContain('/aset/pustaka-prompt.zip');
    // Jangka waktu di metadata respons konsisten dengan tanda tangan:
    // ~15 menit dari sekarang (toleransi 60 dtk eksekusi test).
    const sisaDetik = (Date.parse(hasil.expires_at) - Date.now()) / 1000;
    expect(sisaDetik).toBeGreaterThan(840);
    expect(sisaDetik).toBeLessThanOrEqual(900);
  });

  it('SR-5: yang BELUM membeli tidak bisa menebak — id pembelian orang lain → NOT_FOUND', async () => {
    if (!reachable) return;
    await expect(store.downloadUrl(LAIN, BELI_AKTIF)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('bentuk non-UUID → NOT_FOUND yang sama, bukan 500 (audit ST-02)', async () => {
    if (!reachable) return;
    await expect(store.downloadUrl(PEMBELI, 'bukan-uuid')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(store.downloadUrl(PEMBELI, '../../etc/passwd')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('id pembelian yang tidak ada → NOT_FOUND yang sama (tanpa bocor keberadaan)', async () => {
    if (!reachable) return;
    await expect(
      store.downloadUrl(PEMBELI, '00000000-0000-4000-8000-00000005cfff'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('SR-6: item yang DINONAKTIFKAN tetap bisa diunduh oleh pembelinya', async () => {
    if (!reachable) return;
    const hasil = await store.downloadUrl(PEMBELI, BELI_MATI);
    expect(hasil.url).toContain('X-Amz-Expires=900');
  });
});
