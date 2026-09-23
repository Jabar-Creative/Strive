import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';

import { DATABASE, type DB } from '../../infra/kysely';
import { CoinLedgerService } from '../wallet';
import { tandaTanganSah } from './midtrans-signature';

/** Apa yang terjadi pada satu webhook — dipakai test dan log, bukan respons. */
export interface WebhookResult {
  /** `true` kalau webhook ini yang menambah koin. Duplikat → `false`. */
  credited: boolean;
  orderStatus: string | null;
  /** Kenapa tidak ada yang berubah, kalau memang begitu. */
  alasan?: 'order_tidak_dikenal' | 'sudah_paid' | 'status_tidak_ditangani' | 'badan_tidak_sah';
}

/** Bidang notifikasi Midtrans yang dipakai. Sisanya tetap tersimpan utuh. */
interface Notifikasi {
  order_id: string;
  status_code: string;
  gross_amount: string;
  signature_key: string;
  transaction_status: string;
}

/**
 * `POST /webhooks/payment` — PRD §7 E6 `PA-5` … `PA-8`, §12.1.
 *
 * > **Koin HANYA ditambahkan dari webhook bertanda tangan.** Tidak pernah dari
 * > redirect client.
 *
 * Itu satu-satunya alasan berkas ini ada. `CheckoutService` sengaja tidak
 * menyentuh koin sama sekali; seluruh pertambahan saldo berbayar di produk ini
 * melewati satu fungsi di bawah.
 *
 * ── Urutan yang tidak boleh dibalik ──
 *
 * Tanda tangan diperiksa **sebelum apa pun yang lain** (PRD §16 checklist:
 * *"Webhook memverifikasi signature sebelum memproses apa pun"*). Konsekuensi
 * yang sengaja diterima: webhook bertanda tangan palsu **tidak** meninggalkan
 * baris di `payments`, hanya di `audit_log`. Memang tidak bisa: `payments.order_id`
 * adalah FK NOT NULL, dan `order_id` dari badan yang belum diverifikasi bukan
 * sesuatu yang layak dipakai untuk menulis baris. Jejak pemalsuan ada di
 * `audit_log`; `payments` adalah jejak webhook SAH — termasuk yang sah tapi
 * duplikat, yang justru diminta `AC-PA-1`.
 *
 * ── Kenapa hampir semuanya dijawab 200 ──
 *
 * Midtrans mengirim ulang notifikasi yang tidak dijawab 200. Untuk keadaan
 * yang **tidak akan berubah kalau dicoba lagi** — order tidak dikenal, status
 * yang tidak kita tangani — mengulang hanya menambah beban tanpa hasil, jadi
 * dijawab 200 dan dicatat di `audit_log` (PRD §7 E6 catatan). Hanya tanda
 * tangan salah yang dijawab 401, dan itu memang bukan sesuatu yang pantas
 * dijawab "diterima".
 *
 * ── Idempotensi berlapis (`PA-7`) ──
 *
 * 1. Baris order dikunci `FOR UPDATE` — dua webhook bersamaan berbaris, tidak
 *    saling menimpa. Tanpa ini keduanya membaca `pending` lalu keduanya
 *    menambah koin.
 * 2. `orders.status = 'paid'` diperiksa di dalam kunci itu.
 * 3. `coin_ledger.idempotency_key` UNIQUE (`webhook:<order_id>`).
 * 4. Partial unique `(ref_type, ref_id, entry_type)` = `('order', id, 'purchase')`.
 *
 * **Mana yang sebenarnya menjaga apa — diukur, bukan diduga.** Dugaan pertama
 * saya terbalik. Mencabut lapis 1 ATAU lapis 2 membuat pengiriman ulang
 * BERURUTAN (`AC-PA-1`, tiga kali) tetap benar: `CoinLedgerService.write`
 * mengenali `idempotency_key` yang sudah ada dan mengembalikan entri lama
 * alih-alih menulis yang kedua. Jadi lapis 3–4 yang memegang kasus berurutan —
 * yang justru bentuk paling umum pengiriman ulang Midtrans.
 *
 * Lapis 1–2 memegang kasus BERSAMAAN, dan di sana bedanya bukan saldo
 * melainkan bentuk kegagalannya: tanpa keduanya, dua webhook serentak
 * berlomba melewati pengecekan `idempotency_key` lalu satu menabrak unique
 * index — saldo tetap benar, tapi satu webhook dijawab 500 dan Midtrans
 * mengirimkannya ulang. Keempat lapis nyata; tidak ada yang bisa dicabut
 * tanpa memerahkan test.
 */
@Injectable()
export class PaymentWebhookService {
  private readonly log = new Logger(PaymentWebhookService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Kysely<DB>,
    private readonly coins: CoinLedgerService,
  ) {}

  private get serverKey(): string {
    return process.env['MIDTRANS_SERVER_KEY'] ?? '';
  }

  async handle(body: unknown): Promise<WebhookResult> {
    const n = bacaNotifikasi(body);

    if (!n) {
      await this.catat('payment.malformed', null, { alasan: 'bidang wajib tidak lengkap' });
      this.log.warn('Webhook pembayaran dengan badan tidak dikenali ditolak tanpa diproses.');
      return { credited: false, orderStatus: null, alasan: 'badan_tidak_sah' };
    }

    // ── Gerbang uang. Tidak ada satu pun pembacaan order sebelum baris ini. ──
    if (
      !tandaTanganSah({
        orderId: n.order_id,
        statusCode: n.status_code,
        grossAmount: n.gross_amount,
        signatureKey: n.signature_key,
        serverKey: this.serverKey,
      })
    ) {
      const sebab = this.serverKey.length === 0 ? 'MIDTRANS_SERVER_KEY kosong' : 'tanda tangan';
      await this.catat('payment.bad_signature', n.order_id, { sebab });
      // Badan request TIDAK ikut di-log: kalau ini serangan, isinya dikendalikan
      // penyerang, dan log kita bukan tempat menyimpannya.
      this.log.warn(
        `Webhook pembayaran ditolak (${sebab}). Kalau sering muncul, ada yang tahu URL webhook kita.`,
      );
      throw new UnauthorizedException({
        error: {
          code: 'INVALID_SIGNATURE',
          message: 'Tanda tangan webhook tidak sah',
          details: {},
        },
      });
    }

    return this.db.transaction().execute(async (trx) => {
      // `FOR UPDATE`: dua notifikasi settlement yang tiba bersamaan berbaris di
      // sini. Tanpanya keduanya membaca `pending` dan keduanya menambah koin —
      // lapis unique di ledger akan menyelamatkan saldonya, tapi dengan galat
      // 500 dan satu webhook yang dijawab gagal lalu dikirim ulang selamanya.
      const order = await trx
        .selectFrom('orders')
        .select(['id', 'user_id', 'coins', 'status'])
        .where('id', '=', n.order_id)
        .forUpdate()
        .executeTakeFirst();

      if (!order) {
        // 200, bukan 404: order yang tidak ada hari ini tidak akan ada besok,
        // dan retry Midtrans hanya menambah beban.
        await this.catat('payment.unknown_order', n.order_id, {
          transaction_status: n.transaction_status,
        });
        this.log.warn(`Webhook pembayaran untuk order tidak dikenal: ${n.order_id}`);
        return { credited: false, orderStatus: null, alasan: 'order_tidak_dikenal' as const };
      }

      // PA-8: catatan webhook, perubahan status, dan penambahan koin satu transaksi.
      // Baris ini ditulis untuk SETIAP webhook sah — termasuk duplikat, karena
      // jejak itu yang dipakai menelusuri pembayaran ganda (AC-PA-1).
      await trx
        .insertInto('payments')
        .values({
          order_id: order.id,
          provider: 'midtrans',
          event_type: n.transaction_status,
          raw_payload: JSON.stringify(body),
          signature_ok: true,
        })
        .execute();

      if (n.transaction_status === 'settlement') {
        if (order.status === 'paid') {
          // PA-7: sudah dibayar — 200 tanpa aksi. Bukan galat: Midtrans memang
          // mengirim ulang notifikasi yang sama.
          return { credited: false, orderStatus: 'paid', alasan: 'sudah_paid' as const };
        }

        await this.coins.write(trx, {
          userId: order.user_id,
          entryType: 'purchase',
          amount: order.coins,
          refType: 'order',
          refId: order.id,
          idempotencyKey: `webhook:${order.id}`,
          note: 'Top-up koin',
        });

        await trx
          .updateTable('orders')
          .set({ status: 'paid', paid_at: sql`now()` })
          .where('id', '=', order.id)
          .execute();

        return { credited: true, orderStatus: 'paid' };
      }

      const gagal = STATUS_GAGAL[n.transaction_status];
      if (gagal) {
        // Order yang SUDAH lunas tidak pernah diturunkan. Notifikasi `expire`
        // yang tiba setelah `settlement` (urutan yang tidak dijamin Midtrans)
        // akan menghapus pembayaran yang sudah diterima — dan koinnya sudah
        // terlanjur di tangan pengguna.
        if (order.status === 'paid') {
          await this.catat('payment.late_failure_ignored', order.id, {
            transaction_status: n.transaction_status,
          });
          return { credited: false, orderStatus: 'paid', alasan: 'sudah_paid' as const };
        }
        await trx.updateTable('orders').set({ status: gagal }).where('id', '=', order.id).execute();
        return { credited: false, orderStatus: gagal };
      }

      // `pending`, `capture`, `authorize`, `refund` … — tidak ditangani, dan
      // dicatat KERAS supaya kesenjangannya terlihat. PA-1 membatasi metode ke
      // QRIS, yang hanya memakai settlement/expire/deny/cancel; kalau metode
      // lain diaktifkan di dasbor Midtrans, baris audit inilah yang memberi
      // tahu — bukan pengguna yang koinnya tidak pernah masuk.
      await this.catat('payment.unhandled_status', order.id, {
        transaction_status: n.transaction_status,
      });
      this.log.warn(
        `Webhook pembayaran status '${n.transaction_status}' tidak ditangani (order ${order.id}).`,
      );
      return {
        credited: false,
        orderStatus: order.status,
        alasan: 'status_tidak_ditangani' as const,
      };
    });
  }

  /** Jejak di `audit_log`. Pelakunya sistem, jadi `actor_id` null. */
  private async catat(
    action: string,
    orderId: string | null,
    after: Record<string, unknown>,
  ): Promise<void> {
    await this.db
      .insertInto('audit_log')
      .values({
        actor_id: null,
        action,
        subject_type: 'order',
        subject_id: orderId,
        after: JSON.stringify(after),
      })
      .execute();
  }
}

/** `transaction_status` yang mengakhiri order tanpa koin — PRD §7 E6. */
const STATUS_GAGAL: Record<string, 'failed' | 'expired' | undefined> = {
  deny: 'failed',
  cancel: 'failed',
  expire: 'expired',
};

/**
 * Bidang wajib, semuanya string.
 *
 * Bukan zod: yang diperiksa di sini bukan bentuk data untuk dipakai, melainkan
 * bahan tanda tangan. `gross_amount` harus tetap string APA ADANYA (lihat
 * `midtrans-signature.ts`), dan skema yang mengizinkan number akan diam-diam
 * mengubahnya.
 */
function bacaNotifikasi(body: unknown): Notifikasi | null {
  if (typeof body !== 'object' || body === null) return null;
  const b = body as Record<string, unknown>;
  const wajib = ['order_id', 'status_code', 'gross_amount', 'signature_key', 'transaction_status'];
  for (const k of wajib) {
    if (typeof b[k] !== 'string' || (b[k] as string).length === 0) return null;
  }
  return {
    order_id: b['order_id'] as string,
    status_code: b['status_code'] as string,
    gross_amount: b['gross_amount'] as string,
    signature_key: b['signature_key'] as string,
    transaction_status: b['transaction_status'] as string,
  };
}
