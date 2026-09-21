import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { type Kysely, sql } from 'kysely';

import { DATABASE, type DB } from '../../infra/kysely';
import { PricingConfigService } from '../payment';
import { CoinLedgerService } from '../wallet';

/** `SK-7` / CHECK `streaks_freeze_credits_range`: maksimal simpan 2. */
export const MAX_FREEZE_CREDITS = 2;

export interface BuyFreezeResult {
  credits: number;
  costCoins: number;
  /** Bulan LOKAL pengguna saat pembelian, `YYYY-MM`. */
  purchasedMonth: string;
}

/**
 * `POST /streak/freeze/purchase` — `S-05` (isu #88), PRD §5 Q3.
 *
 * > **Bisa dibeli: 200 koin per kredit, maksimal 1 pembelian per bulan.**
 *
 * ── "Per bulan" adalah bulan LOKAL pengguna ──
 *
 * `streaks.freeze_purchased_month` bertipe `char(7)` dan diisi `YYYY-MM`
 * **yang dihitung Postgres dari `streaks.timezone`**, bukan dari jam proses
 * Node dan bukan dari UTC.
 *
 * Bedanya bukan teoretis. Pengguna WIB yang membeli pukul 06.00 tanggal 1
 * masih berada di bulan sebelumnya menurut UTC — ia akan kehilangan jatah
 * bulan baru, lalu ditolak lagi di hari-hari berikutnya karena catatannya
 * menunjuk bulan yang salah. Aturan keras 5, di satuan bulan.
 *
 * ── `spend_store` TANPA ref, dan kedua keputusan itu dipaksa skema ──
 *
 * Enum `coin_entry` tidak punya nilai untuk pembelian kredit freeze:
 * `spend_store`, `spend_scan`, `spend_ai` — tidak satu pun benar. Enum-nya
 * dikunci di migrasi 001, sebelum sistem yang dibangun selesai, sama seperti
 * daftar kode error §10.2 (isu #92). Dipakai yang paling tidak salah.
 *
 * **Tanpa `refType`/`refId`, dan itu BUKAN kelalaian.** Percobaan pertama
 * memakai `('streak', userId)`, lalu ketahuan bahwa partial unique index
 * `coin_ledger_ref_uniq (ref_type, ref_id, entry_type)` akan membuat setiap
 * pengguna hanya bisa membeli kredit freeze **sekali seumur hidup** —
 * pembelian bulan berikutnya ditolak database, bukan oleh aturan produk.
 *
 * Tidak ada baris yang bisa ditunjuk: pembelian freeze tidak punya tabel
 * sendiri. Yang menegakkan "1 per bulan" adalah `freeze_purchased_month`, dan
 * itu memang tempatnya.
 *
 * Konsekuensi yang perlu diketahui saat menghitung pendapatan store:
 * pembelian freeze muncul sebagai `spend_store` dengan `ref_id IS NULL`,
 * sementara pembelian store sungguhan SELALU menunjuk barisnya. Itu yang
 * memisahkan keduanya sampai enum-nya diperbaiki.
 */
@Injectable()
export class FreezePurchaseService {
  constructor(
    @Inject(DATABASE) private readonly db: Kysely<DB>,
    private readonly coins: CoinLedgerService,
    private readonly pricing: PricingConfigService,
  ) {}

  async buy(userId: string, idempotencyKey?: string): Promise<BuyFreezeResult> {
    const harga = await this.pricing.getCurrentVersion();
    if (!harga) {
      throw new ConflictException({
        error: {
          code: 'PRICING_NOT_CONFIGURED',
          message: 'Belum ada pricing_config aktif — jalankan `pnpm seed`',
          details: {},
        },
      });
    }

    return this.db.transaction().execute(async (trx) => {
      // Kunci baris streak DULU. Dua pembelian bersamaan akan sama-sama
      // membaca "belum beli bulan ini" dan keduanya lolos — batas 1/bulan
      // yang bocor tepat di batasnya adalah batas yang tidak ada.
      const streak = await trx
        .selectFrom('streaks')
        .select(['user_id', 'freeze_credits', 'freeze_purchased_month'])
        .where('user_id', '=', userId)
        .forUpdate()
        .executeTakeFirst();

      if (!streak) {
        // Baris `streaks` dibuat trigger saat registrasi (AU-6, migrasi 005).
        // Ketiadaannya berarti ada yang salah, bukan keadaan normal.
        throw new ConflictException({
          error: {
            code: 'NOT_FOUND',
            message: 'Baris streak tidak ditemukan',
            details: { user_id: userId },
          },
        });
      }

      // Bulan LOKAL pengguna, dihitung Postgres dari `streaks.timezone`.
      const bulan = await sql<{ bulan: string }>`
        SELECT to_char((now() AT TIME ZONE s.timezone)::date, 'YYYY-MM') AS bulan
        FROM streaks s WHERE s.user_id = ${userId}
      `.execute(trx);
      const bulanIni = bulan.rows[0]!.bulan;

      // `char(7)` di-pad Postgres; dibandingkan setelah trim supaya
      // '2026-09' dan '2026-09' tidak pernah beda karena spasi.
      if ((streak.freeze_purchased_month ?? '').trim() === bulanIni) {
        throw new ConflictException({
          error: {
            code: 'ALREADY_PURCHASED',
            message: 'Kredit freeze hanya bisa dibeli sekali per bulan',
            details: { month: bulanIni },
          },
        });
      }

      // CHECK `streaks_freeze_credits_range` menolak > 2, dan pelanggarannya
      // akan muncul sebagai 500. Diperiksa di sini supaya pengguna mendapat
      // jawaban yang menjelaskan, bukan galat database.
      if (streak.freeze_credits >= MAX_FREEZE_CREDITS) {
        throw new ConflictException({
          error: {
            code: 'ALREADY_PURCHASED',
            message: `Kredit freeze sudah penuh (maksimal ${MAX_FREEZE_CREDITS})`,
            details: { credits: streak.freeze_credits, max: MAX_FREEZE_CREDITS },
          },
        });
      }

      // Debit DULU. Kalau saldo kurang, `InsufficientCoinsError` membatalkan
      // seluruh transaksi dan kreditnya tidak pernah bertambah.
      await this.coins.write(trx, {
        userId,
        entryType: 'spend_store',
        amount: -harga.freeze_cost_coins,
        // TANPA ref — lihat catatan kelas. `('streak', userId)` akan membatasi
        // pembelian jadi sekali seumur hidup lewat `coin_ledger_ref_uniq`.
        ...(idempotencyKey ? { idempotencyKey } : {}),
        note: `beli kredit freeze ${bulanIni}`,
      });

      await trx
        .updateTable('streaks')
        .set({
          freeze_credits: streak.freeze_credits + 1,
          freeze_purchased_month: bulanIni,
          updated_at: new Date(),
        })
        .where('user_id', '=', userId)
        .execute();

      return {
        credits: streak.freeze_credits + 1,
        costCoins: harga.freeze_cost_coins,
        purchasedMonth: bulanIni,
      };
    });
  }
}
