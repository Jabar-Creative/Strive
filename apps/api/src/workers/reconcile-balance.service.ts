import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Kysely } from 'kysely';

import { DATABASE, type DB } from '../infra/kysely';
import { CoinLedgerService, type DriftRow } from '../modules/wallet';

export interface ReconcileResult {
  checked_at: string;
  drift_count: number;
  drifts: DriftRow[];
}

/**
 * Job rekonsiliasi harian — PRD §9 `CO-11`.
 *
 * Membandingkan cache `users.coin_balance` dengan kebenarannya,
 * `SUM(coin_ledger.amount)`. **Selisih apa pun** — bukan selisih di atas
 * ambang — masuk `audit_log` dan memicu alert (PRD §20: ambangnya *"apa pun
 * ≠ 0"*).
 *
 * ── Dua keputusan yang membentuk seluruh berkas ini ──
 *
 * **1 · Job ini TIDAK memperbaiki apa pun.** Ia hanya membaca, mencatat, dan
 * berteriak. Memperbaiki selisih secara otomatis menghapus satu-satunya bukti
 * tentang APA yang menyebabkannya — dan penyebabnya selalu lebih penting
 * daripada angkanya, karena selisih berarti ada kode yang menulis saldo di
 * luar `CoinLedgerService` (CLAUDE.md aturan 3). Menambal angkanya membuat bug
 * itu tidak terlihat sampai ia terjadi lagi.
 *
 * **2 · Baris audit ditulis MESKI nol selisih.** "Tidak ada selisih hari ini"
 * adalah fakta yang berguna saat menelusuri insiden. Tanpa baris itu,
 * "rekonsiliasi bersih" tidak bisa dibedakan dari "rekonsiliasi tidak pernah
 * berjalan" — dan kedua keadaan itu butuh tindakan yang sangat berbeda.
 */
@Injectable()
export class ReconcileBalanceService {
  private readonly logger = new Logger(ReconcileBalanceService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Kysely<DB>,
    private readonly coins: CoinLedgerService,
  ) {}

  async run(): Promise<ReconcileResult> {
    const drifts = await this.db.transaction().execute((trx) => this.coins.findDrift(trx));
    const checked_at = new Date().toISOString();

    await this.db
      .insertInto('audit_log')
      .values({
        action: 'coin.reconcile',
        subject_type: 'system',
        subject_id: null,
        after: JSON.stringify({
          checked_at,
          drift_count: drifts.length,
          // Seluruh selisih disimpan, bukan ringkasannya. Saat ada yang
          // menelusuri ini berbulan-bulan kemudian, daftar user_id yang
          // terdampak adalah hal pertama yang ia cari.
          drifts: drifts.map((d) => ({
            user_id: d.userId,
            cached: d.cachedBalance,
            ledger: d.ledgerSum,
            drift: d.drift,
          })),
        }),
      })
      .execute();

    if (drifts.length > 0) {
      // Alert. Levelnya `error`, bukan `warn`: PRD §20 menetapkan ambangnya
      // "apa pun bukan nol", dan peringatan yang biasa dilihat lalu diabaikan
      // adalah peringatan yang berhenti bekerja.
      this.logger.error(
        `REKONSILIASI KOIN: ${drifts.length} pengguna saldonya menyimpang dari ledger. ` +
          `Cache users.coin_balance ditulis di luar CoinLedgerService — cari penyebabnya, ` +
          `JANGAN tambal angkanya. ` +
          drifts
            .slice(0, 10)
            .map((d) => `${d.userId}: cache ${d.cachedBalance} vs ledger ${d.ledgerSum}`)
            .join(' · '),
      );
    } else {
      this.logger.log(`Rekonsiliasi koin bersih (${checked_at}).`);
    }

    return { checked_at, drift_count: drifts.length, drifts };
  }
}
