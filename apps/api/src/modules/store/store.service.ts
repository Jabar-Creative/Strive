import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Kysely } from 'kysely';

import { DATABASE, type DB } from '../../infra/kysely';
import { CoinLedgerService } from '../wallet';

/** Satu baris etalase. `asset_key` SENGAJA tidak ada — lihat catatan kelas. */
export interface StoreItemView {
  id: string;
  slug: string;
  title: string;
  kind: string;
  price_coins: number;
  is_active: boolean;
  /** Sudah dibeli pengguna yang bertanya. SR-2: satu item sekali per orang. */
  owned: boolean;
}

export interface PurchaseResult {
  purchase_id: string;
  item_id: string;
  price_coins: number;
  /** Saldo SESUDAH debit, dari entri ledger — bukan dibaca ulang. */
  balance: number;
}

/**
 * Strive Store — `ST-01`, PRD §7 E14 (`SR-1` … `SR-6`).
 *
 * ── `refType: 'purchase'` menunjuk BARIS PEMBELIAN, bukan ITEM ──
 *
 * Ini keputusan yang paling mudah salah di seluruh berkas, dan salahnya tidak
 * terlihat sampai pengguna KEDUA datang.
 *
 * `coin_ledger_ref_uniq` adalah `UNIQUE (ref_type, ref_id, entry_type)` —
 * **tanpa `user_id`**. Dan `CoinLedgerService.findExisting()` mencari dengan
 * kunci yang sama, juga tanpa `user_id`.
 *
 * Jadi kalau `refId` diisi id ITEM, akibatnya bukan pembeli kedua ditolak.
 * Akibatnya **pembeli kedua mendapat itemnya GRATIS**: lapis idempotensi
 * menemukan entri milik pembeli PERTAMA, menyimpulkan "sudah pernah ditulis",
 * dan mengembalikannya tanpa mendebit siapa pun. Saldo pembeli kedua utuh,
 * hak aksesnya terbit, dan tidak ada satu pun galat.
 *
 * Diverifikasi: `refId` diganti id item, dan test "dua pengguna membeli item
 * yang sama" merah dengan saldo pembeli kedua **tetap 1000**.
 *
 * Yang ditunjuk karena itu `('purchase', purchase.id)` — baris
 * `store_purchases` yang memang unik per (pengguna, item), dan yang
 * keunikannya justru ditegakkan `store_purchases_once`. PRD §9.3 memisahkan
 * `'purchase'` (pembelian store) dari `'order'` (top-up koin).
 *
 * Kelas jebakan yang sama sudah menggigit `S-05`: di sana `('streak', userId)`
 * akan membatasi pembelian kredit freeze jadi sekali seumur hidup. Bedanya, di
 * sini lingkupnya lintas-PENGGUNA, bukan cuma lintas-waktu.
 *
 * ── Urutan: baris pembelian DULU, baru debit ──
 *
 * Terbalik dari yang terasa wajar, dan alasannya poin di atas: `refId` harus
 * sudah ada sebelum ledger ditulis.
 *
 * `SR-4` ("saldo kurang → ditolak sebelum entri apa pun ditulis") tetap benar,
 * dan yang menjaminnya **rollback**, bukan urutan pemanggilan. Kalau debit
 * gagal, baris `store_purchases` yang sudah disisipkan ikut hilang bersama
 * transaksinya. Ada test yang memeriksa nol baris tersisa — bukan mengandaikan.
 *
 * ── `asset_key` tidak pernah keluar dari service ini ──
 *
 * `SR-5`: unduhan lewat signed URL 15 menit, dan **pengguna yang belum membeli
 * tidak bisa menebak URL aset**. Mengirim `asset_key` di etalase membatalkan
 * kalimat itu seluruhnya — kunci objeknya jadi diketahui semua orang sebelum
 * membayar. Rute unduhnya sendiri milik `ST-02`.
 */
@Injectable()
export class StoreService {
  constructor(
    @Inject(DATABASE) private readonly db: Kysely<DB>,
    private readonly coins: CoinLedgerService,
  ) {}

  /**
   * Etalase, dengan penanda "sudah dimiliki" untuk si penanya.
   *
   * Item nonaktif TIDAK ditampilkan — kecuali yang sudah ia beli. `SR-6`:
   * item yang dinonaktifkan tetap bisa diunduh oleh yang sudah membeli, dan
   * menyembunyikannya dari etalase berarti menyembunyikan pintu unduhnya.
   */
  async items(userId: string): Promise<StoreItemView[]> {
    const rows = await this.db
      .selectFrom('store_items as i')
      .leftJoin('store_purchases as p', (j) =>
        j.onRef('p.item_id', '=', 'i.id').on('p.user_id', '=', userId),
      )
      .select([
        'i.id',
        'i.slug',
        'i.title',
        'i.kind',
        'i.price_coins',
        'i.is_active',
        'p.id as pid',
      ])
      .where((eb) => eb.or([eb('i.is_active', '=', true), eb('p.id', 'is not', null)]))
      .orderBy('i.price_coins')
      .orderBy('i.slug')
      .execute();

    return rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      title: r.title,
      kind: r.kind,
      price_coins: r.price_coins,
      is_active: r.is_active,
      owned: r.pid !== null,
    }));
  }

  async purchase(input: {
    userId: string;
    itemId: string;
    idempotencyKey?: string | undefined;
  }): Promise<PurchaseResult> {
    const { userId, itemId, idempotencyKey } = input;

    return this.db.transaction().execute(async (trx) => {
      const item = await trx
        .selectFrom('store_items')
        .select(['id', 'price_coins', 'is_active'])
        .where('id', '=', itemId)
        .executeTakeFirst();

      // Item nonaktif menjawab sama dengan item yang tidak ada: `SR-6` hanya
      // menjanjikan UNDUHAN tetap jalan untuk yang sudah membeli — bukan
      // bahwa ia masih bisa dibeli orang baru.
      if (!item || !item.is_active) {
        throw new NotFoundException({
          error: {
            code: 'NOT_FOUND',
            message: 'Item store tidak ditemukan atau sudah tidak dijual',
            details: { item_id: itemId },
          },
        });
      }

      const sudah = await trx
        .selectFrom('store_purchases')
        .select('id')
        .where('user_id', '=', userId)
        .where('item_id', '=', itemId)
        .executeTakeFirst();

      // `store_purchases_once` akan menolaknya juga, tapi sebagai galat
      // database — 500. Pengguna yang mengklik dua kali pantas mendapat
      // jawaban yang menjelaskan.
      if (sudah) {
        throw new ConflictException({
          error: {
            code: 'ALREADY_PURCHASED',
            message: 'Item ini sudah kamu beli',
            details: { item_id: itemId, purchase_id: sudah.id },
          },
        });
      }

      // Harga DISALIN ke baris pembelian. Harga item boleh berubah nanti, dan
      // riwayat yang ikut berubah bersamanya adalah riwayat yang tidak bisa
      // dipakai menelusuri apa pun.
      const purchase = await trx
        .insertInto('store_purchases')
        .values({ user_id: userId, item_id: itemId, price_coins: item.price_coins })
        .returning('id')
        .executeTakeFirstOrThrow();

      const entry = await this.coins.write(trx, {
        userId,
        entryType: 'spend_store',
        amount: -item.price_coins,
        // `'purchase'` menunjuk baris `store_purchases`, BUKAN item. Lihat
        // catatan kelas: ref ke item akan membatasi tiap item jadi sekali
        // dibeli di SELURUH sistem. (`'order'` yang dipakai top-up koin —
        // PRD §9.3 memisahkan keduanya.)
        refType: 'purchase',
        refId: purchase.id,
        ...(idempotencyKey ? { idempotencyKey } : {}),
      });

      await trx
        .updateTable('store_purchases')
        .set({ ledger_id: entry.id })
        .where('id', '=', purchase.id)
        .execute();

      return {
        purchase_id: purchase.id,
        item_id: itemId,
        price_coins: item.price_coins,
        balance: entry.balanceAfter,
      };
    });
  }
}
