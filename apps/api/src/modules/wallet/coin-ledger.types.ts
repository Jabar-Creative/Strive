import type { Transaction } from 'kysely';

import type { DB } from '../../infra/kysely';

/** Transaksi Kysely. SEMUA method CoinLedgerService menerima ini. */
export type Trx = Transaction<DB>;

/** Jenis entri ledger — `coin_entry` di docs/PRD.md §9.2. */
export type CoinEntry = DB['coin_ledger']['entry_type'];

/** Apa yang dirujuk sebuah entri — docs/PRD.md §9.3 `coin_ledger.ref_type`. */
export type RefType =
  'attempt' | 'order' | 'scan' | 'purchase' | 'streak' | 'ai_job' | 'review' | 'prompt_run';
/**
 * `'prompt_run'` ditambahkan untuk `PL-01` (isu #238), dan alasannya bukan
 * idempotensi melainkan **aturan keras 4**.
 *
 * Run prompt lab SINKRON memotong 20 koin lalu memanggil LLM. Itu efek
 * samping BERBAYAR, jadi ia wajib `hold → settle | release` — dan
 * `HoldParams` menuntut `refType` + `refId` yang TIDAK opsional. Tanpa nilai
 * ini, satu-satunya jalan adalah debit langsung, yaitu "debit lalu refund
 * manual" yang aturan 4 ada untuk mencegah: refund manual berarti ada
 * manusia yang harus tahu refund dibutuhkan, dan itu tidak terjadi.
 *
 * Idempotensinya ikut selesai tanpa kolom baru. `refId` menunjuk BARIS
 * `prompt_runs` (pola `ST-01`: ref menunjuk baris pembelian, bukan item),
 * jadi:
 *
 * - `coin_ledger_user_idem_uniq (user_id, idempotency_key)` menjaga request
 *   yang DIULANG, dan entri yang dikembalikannya **membawa `ref_id`** —
 *   artinya ledger itu sendiri sudah jadi indeks dari Idempotency-Key ke
 *   baris `prompt_runs` jawabannya. Itu yang membuat usulan (b) di #238
 *   (kolom `prompt_runs.idempotency_key`) jadi sumber kebenaran KEDUA untuk
 *   fakta yang sudah dipegang ledger.
 * - `coin_ledger_ref_uniq (user_id, ref_type, ref_id, entry_type)` menjaga
 *   request BERBEDA dengan niat yang sama — satu potongan per baris
 *   `prompt_runs` per pengguna, sejak migrasi 010.
 *
 * Nol migrasi: `coin_ledger.ref_type` bertipe `text` polos. Komentar daftar
 * nilai di `001_init.sql:308` **tidak** bisa ikut diperbarui — migrasi yang
 * sudah jalan diperiksa checksum-nya, dan menyuntingnya ditolak runner.
 * Daftar yang berlaku adalah union di atas.
 */

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
