import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Kysely } from 'kysely';

import { DATABASE, type DB } from '../../infra/kysely';

export interface OrderStatus {
  id: string;
  coins: number;
  amount_idr: number;
  status: string;
  pricing_version: number;
  paid_at: Date | null;
  created_at: Date;
}

/**
 * `GET /payments/orders/:id` — `F-14` (isu #88), PRD §10.3:
 * *"Status order (untuk polling UI)"*.
 *
 * ── Ini rute POLLING, dan itu mengubah apa yang boleh ada di dalamnya ──
 *
 * Klien memanggilnya berulang-ulang selama pengguna menunggu Snap selesai.
 * Jadi ia sengaja hanya membaca SATU baris `orders` — tanpa join ke
 * `payments`, tanpa join ke ledger. Riwayat pembayaran punya tempatnya sendiri
 * di `/wallet/ledger` (`C-02`).
 *
 * ── Yang TIDAK dikirim ──
 *
 * `idempotency_key` adalah kunci yang, kalau bocor, membuat request orang lain
 * dianggap pengulangan request ini. `provider_ref` adalah id internal Midtrans
 * yang tidak berguna bagi klien dan berguna bagi orang yang menebak-nebak.
 *
 * ── Kepemilikan di WHERE ──
 *
 * Order orang lain dan order yang tidak ada menjawab **identik**. Ini rute
 * yang paling mengundang tebakan id — status pembayaran orang lain adalah
 * informasi yang berguna bagi orang yang salah.
 */
@Injectable()
export class OrderReadService {
  constructor(@Inject(DATABASE) private readonly db: Kysely<DB>) {}

  async byId(userId: string, orderId: string): Promise<OrderStatus> {
    const row = await this.db
      .selectFrom('orders')
      .select(['id', 'coins', 'amount_idr', 'status', 'pricing_version', 'paid_at', 'created_at'])
      .where('id', '=', orderId)
      .where('user_id', '=', userId)
      .executeTakeFirst();

    if (!row) {
      throw new NotFoundException({
        error: { code: 'NOT_FOUND', message: 'Order tidak ditemukan', details: { id: orderId } },
      });
    }
    return row;
  }
}
