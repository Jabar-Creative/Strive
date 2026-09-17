import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { CoinLedgerEntry } from '@strive/contracts';

import { DATABASE, type DB } from '../../infra/kysely';

/** Batas keras `limit`, supaya satu request tidak bisa menarik seluruh riwayat. */
export const LEDGER_LIMIT_MAX = 50;
export const LEDGER_LIMIT_DEFAULT = 20;
/** `GET /wallet` — PRD §10.3: "Saldo + 20 entri terakhir". */
export const WALLET_RECENT = 20;

export class InvalidCursorError extends Error {
  constructor(readonly rawCursor: string) {
    super(`Cursor tidak bisa didekode: ${rawCursor}`);
    this.name = 'InvalidCursorError';
  }
}

/**
 * Pembacaan dompet. **Tidak menulis apa pun** — setiap perpindahan koin lewat
 * `CoinLedgerService` (CLAUDE.md aturan 3), dan service ini sengaja tidak
 * punya satu pun method yang bisa mengubah saldo.
 *
 * Saldo yang dikembalikan adalah `users.coin_balance`, yang **cache**. Itu
 * disengaja: `SUM(coin_ledger.amount)` atas riwayat penuh akan melambat
 * seiring pemakaian, dan yang menjaga cache-nya jujur adalah `C-04` (job
 * rekonsiliasi harian), bukan setiap pembacaan dompet.
 */
@Injectable()
export class WalletService {
  constructor(@Inject(DATABASE) private readonly db: Kysely<DB>) {}

  async balance(userId: string): Promise<number> {
    const row = await this.db
      .selectFrom('users')
      .select('coin_balance')
      .where('id', '=', userId)
      .executeTakeFirst();
    return row?.coin_balance ?? 0;
  }

  /** Halaman riwayat. `cursor` null = dari entri terbaru. */
  async ledger(
    userId: string,
    opts: { cursor?: string | undefined; limit?: number | undefined } = {},
  ): Promise<{ data: CoinLedgerEntry[]; next_cursor: string | null }> {
    const limit = Math.min(Math.max(opts.limit ?? LEDGER_LIMIT_DEFAULT, 1), LEDGER_LIMIT_MAX);

    let q = this.db
      .selectFrom('coin_ledger')
      .select([
        'id',
        'entry_type',
        'amount',
        'balance_after',
        'ref_type',
        'ref_id',
        'note',
        'created_at',
      ])
      .where('user_id', '=', userId)
      // `id` bigserial monotonik, jadi ia SEKALIGUS urutan dan kunci cursor.
      // Memakai `created_at` butuh tie-break karena dua entri bisa berbagi
      // timestamp yang sama — `id` tidak pernah.
      .orderBy('id', 'desc')
      // Satu lebih banyak dari limit: keberadaan baris ke-(limit+1) itulah
      // yang membuktikan masih ada halaman berikutnya, tanpa COUNT terpisah
      // atas riwayat yang bisa sangat panjang.
      .limit(limit + 1);

    if (opts.cursor) q = q.where('id', '<', decodeCursor(opts.cursor));

    const rows = await q.execute();
    const adaLagi = rows.length > limit;
    const halaman = adaLagi ? rows.slice(0, limit) : rows;

    return {
      data: halaman.map(serialize),
      next_cursor: adaLagi ? encodeCursor(halaman[halaman.length - 1]!.id) : null,
    };
  }

  /** `GET /wallet`: saldo + 20 entri terakhir, satu bentuk respons. */
  async overview(userId: string): Promise<{ balance: number; recent_entries: CoinLedgerEntry[] }> {
    const [balance, hal] = await Promise.all([
      this.balance(userId),
      this.ledger(userId, { limit: WALLET_RECENT }),
    ]);
    return { balance, recent_entries: hal.data };
  }
}

/**
 * Cursor dibuat BURAM (base64), bukan id mentah.
 *
 * Bukan demi keamanan — id ledger orang lain tidak berguna karena querynya
 * selalu dibatasi `user_id`. Alasannya kontrak: cursor mentah mengundang klien
 * menebak-nebak dan menghitung sendiri, dan begitu ada yang melakukannya,
 * bentuk internal kita berhenti bisa diubah.
 */
function encodeCursor(id: string | number | bigint): string {
  return Buffer.from(`cl:${String(id)}`, 'utf8').toString('base64url');
}

function decodeCursor(raw: string): string {
  let teks: string;
  try {
    teks = Buffer.from(raw, 'base64url').toString('utf8');
  } catch {
    throw new InvalidCursorError(raw);
  }
  // Prefiks `cl:` membuat cursor dari endpoint LAIN ditolak alih-alih
  // diam-diam dipakai sebagai id — itu akan mengembalikan halaman yang salah
  // tanpa ada error.
  if (!teks.startsWith('cl:')) throw new InvalidCursorError(raw);
  const id = teks.slice(3);
  if (!/^\d+$/.test(id)) throw new InvalidCursorError(raw);
  return id;
}

function serialize(row: {
  id: string | number | bigint;
  entry_type: string;
  amount: number;
  balance_after: number;
  ref_type: string | null;
  ref_id: string | null;
  note: string | null;
  created_at: Date;
}): CoinLedgerEntry {
  return {
    // `bigserial` bisa melewati Number.MAX_SAFE_INTEGER — string, bukan number.
    id: String(row.id),
    entry_type: row.entry_type as CoinLedgerEntry['entry_type'],
    amount: row.amount,
    balance_after: row.balance_after,
    ref_type: row.ref_type,
    ref_id: row.ref_id,
    note: row.note,
    created_at: row.created_at.toISOString(),
  };
}
