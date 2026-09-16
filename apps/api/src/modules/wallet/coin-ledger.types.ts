import type { Transaction } from 'kysely';

import type { DB } from '../../infra/kysely';

/** Transaksi Kysely. SEMUA method CoinLedgerService menerima ini. */
export type Trx = Transaction<DB>;

/** Jenis entri ledger — `coin_entry` di docs/PRD.md §9.2. */
export type CoinEntry = DB['coin_ledger']['entry_type'];

/** Apa yang dirujuk sebuah entri — docs/PRD.md §9.3 `coin_ledger.ref_type`. */
export type RefType = 'attempt' | 'order' | 'scan' | 'purchase' | 'streak' | 'ai_job' | 'review';

export interface WriteParams {
  userId: string;
  entryType: CoinEntry;
  /** Signed: + masuk, − keluar. Nol ditolak database (`amount <> 0`). */
  amount: number;
  refType?: RefType;
  refId?: string;
  idempotencyKey?: string;
  note?: string;
}

export interface HoldParams {
  userId: string;
  /** POSITIF — jumlah yang ditahan. Tandanya dibalik saat ditulis ke ledger. */
  amount: number;
  refType: RefType;
  refId: string;
  idempotencyKey?: string;
  note?: string;
}

export interface SettleParams {
  userId: string;
  refType: RefType;
  refId: string;
  /** Siapa yang menyetel. Null = sistem (worker). */
  actorId?: string;
  note?: string;
}

export interface ReleaseParams {
  userId: string;
  refType: RefType;
  refId: string;
  reason: string;
  actorId?: string;
}

export interface LedgerEntry {
  id: string;
  userId: string;
  entryType: CoinEntry;
  amount: number;
  balanceAfter: number;
  refType: string | null;
  refId: string | null;
  createdAt: Date;
}

export interface DriftRow {
  userId: string;
  cachedBalance: number;
  ledgerSum: number;
  /** cache − ledger. Positif = cache kelebihan, negatif = cache kekurangan. */
  drift: number;
}
