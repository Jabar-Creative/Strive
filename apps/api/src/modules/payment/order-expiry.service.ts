import { Inject, Injectable, Logger } from '@nestjs/common';
import { type Kysely, sql } from 'kysely';

import { DATABASE, type DB } from '../../infra/kysely';

/**
 * Umur maksimum order `pending` sebelum kedaluwarsa — PRD §7 E6 `PA-9`.
 *
 * Angkanya dari PRD, bukan pilihanku: *"Order `pending` lebih dari 24 jam →
 * status `expired`"*.
 */
export const BATAS_PENDING_JAM = 24;

/**
 * `PA-9` — order `pending` lebih dari 24 jam jadi `expired`. Isu #121.
 *
 * ── Kenapa aturan ini perlu dijalankan sesuatu ──
 *
 * `checkout.service.ts` sudah BERGANTUNG padanya secara eksplisit: order
 * `pending` milik pengguna yang sama dipakai ulang alih-alih membuat yang baru,
 * dan tanpa ada yang pernah mengedaluwarsakannya, satu order `pending` yang
 * transaksi Snap-nya sudah mati akan **menghalangi pengguna membeli lagi
 * selamanya**. Jadi PA-9 bukan kebersihan data; ia bagian dari jalur beli.
 *
 * `PA-9` tidak dimiliki item backlog mana pun (isu #121) — ia tertulis di PRD
 * sebagai aturan, dan tidak pernah dijadwalkan. Sebelum #203 tidak ada
 * penjadwal untuk job apa pun, jadi menulisnya lebih dulu akan menghasilkan
 * `runOnce()` tanpa pemanggil.
 *
 * ── Tiap JAM, bukan tiap hari ──
 *
 * PRD menulis "job harian". Itu diikuti sebagai ATURAN (batasnya 24 jam) dan
 * tidak sebagai irama: dengan sapuan harian, order bisa bertahan `pending`
 * sampai **48 jam** — yang membuat aturannya sendiri tidak benar separuh
 * waktu. Tiap jam membuat batas 24 jam akurat dalam satu jam.
 *
 * Pola yang sama dengan `partition` di `PenjadwalService`: job idempoten yang
 * dijalankan lebih sering tidak mengubah hasilnya, dan satu jalan yang gagal
 * tidak berarti menunggu satu periode penuh.
 *
 * ── Nol efek pada uang ──
 *
 * Top-up tidak menahan koin: pengguna membayar uang dan MENERIMA koin, jadi
 * tidak ada hold yang perlu dilepas (aturan keras 4 tidak berlaku di sini).
 * Order yang kedaluwarsa karena itu murni perubahan status — dan `paid_at`
 * tidak disentuh, supaya order yang entah bagaimana sudah lunas tidak bisa
 * ikut tersapu.
 *
 * Penjagaannya ada di `WHERE status = 'pending'`: `paid`, `failed`, dan
 * `expired` tidak tersentuh. Order yang webhook-nya datang SETELAH sapuan
 * tetap diproses — `P-03` memeriksa `status === 'paid'` untuk duplikat, bukan
 * `!== 'pending'`, jadi settlement atas order `expired` tetap mengkreditkan
 * koinnya. Itu perilaku yang diinginkan: pengguna yang uangnya sudah diterima
 * Midtrans harus dapat koinnya, apa pun yang dikatakan jam kita.
 */
@Injectable()
export class OrderExpiryService {
  private readonly log = new Logger(OrderExpiryService.name);

  constructor(@Inject(DATABASE) private readonly db: Kysely<DB>) {}

  async run(): Promise<{ kedaluwarsa: number }> {
    const r = await this.db
      .updateTable('orders')
      .set({ status: 'expired' })
      .where('status', '=', 'pending')
      .where(
        'created_at',
        '<',
        sql<Date>`now() - ${sql.lit(BATAS_PENDING_JAM)} * interval '1 hour'`,
      )
      .returning('id')
      .execute();

    if (r.length > 0) {
      this.log.log(`${r.length} order pending > ${BATAS_PENDING_JAM} jam jadi expired (PA-9)`);
    }
    return { kedaluwarsa: r.length };
  }
}
