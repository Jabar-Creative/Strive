import { Inject, Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { sql, type Kysely } from 'kysely';

import { AI_QUEUE } from '../infra/bullmq';
import { DATABASE, type DB } from '../infra/kysely';
import { barisLog } from '../common/observability';
import { IntegrationsHealthService } from '../modules/admin';

/** §17.2 — ambang yang bisa disetel tanpa mengubah logikanya. */
export const AMBANG = {
  antreanBullmq: 100,
  outboxPending: 500,
  selisihRekonsiliasi: 0,
  holdMenggantung: 0,
  webhookGagalPerJam: 3,
} as const;

export type StatusMetrik = 'ok' | 'breached' | 'butuh_agregator';

export interface Metrik {
  metric: string;
  status: StatusMetrik;
  value: number | null;
  threshold: number | null;
  note?: string;
}

/**
 * Evaluasi metrik §17.2 — `R-04`.
 *
 * > **Selesai berarti:** Insiden terdeteksi **sebelum pengguna melapor**.
 *
 * Kalimat itu yang menentukan bentuk berkas ini: yang dibutuhkan bukan dasbor
 * yang bisa dibuka, melainkan sesuatu yang **menghitung sendiri** dan
 * berteriak. Dasbor hanya terdeteksi kalau ada yang sedang menatapnya.
 *
 * ── Tujuh dari sembilan metrik dihitung dari data kita sendiri ──
 *
 * Dua sisanya — error rate 5xx dan p95 latensi `/hub` — hanya bisa dihitung
 * dari **agregasi log**, dan log itu tidak disimpan di Postgres (sengaja:
 * menulis satu baris per request ke database transaksional adalah cara
 * memastikan database mati lebih dulu daripada yang dipantaunya). Sumbernya
 * sudah ada sejak PR ini — `RequestLogInterceptor` mengeluarkan `route`,
 * `status`, dan `duration_ms` per request — tapi yang menghitungnya adalah
 * agregator di sisi deployment, dan deployment itu `F-05` yang masih blocked.
 *
 * Keduanya dilaporkan `butuh_agregator`, BUKAN `ok`. Metrik yang melaporkan
 * sehat karena tidak punya datanya adalah kebohongan yang paling mahal:
 * ia dipercaya justru saat insiden.
 *
 * ── Kenapa tidak ada ambang absolut untuk biaya LLM ──
 *
 * Keputusan Fatih, 23 Sep: hanya rasio (3× di atas dasar tujuh hari, dengan
 * lantai $0,50). Konsekuensinya diterima dengan sadar dan ditulis di sini
 * supaya tidak terbaca sebagai kelalaian: **biaya yang naik pelan-pelan tidak
 * akan pernah memicu alert.** Naik 10% sehari tidak pernah mencapai 3× dari
 * rata-rata bergeraknya, dan sebulan kemudian tagihannya sudah belasan kali
 * lipat tanpa satu pun alarm. Yang menahannya bukan alert melainkan
 * `last_7_days` di `SA-03`, yang membuat tren itu TERLIHAT di dasbor.
 */
@Injectable()
export class MetricsService {
  constructor(
    @Inject(DATABASE) private readonly db: Kysely<DB>,
    @Inject(AI_QUEUE) private readonly antrean: Queue,
    private readonly health: IntegrationsHealthService,
  ) {}

  async evaluate(): Promise<Metrik[]> {
    const [antrean, outbox, rekonsiliasi, hold, webhook, biaya] = await Promise.all([
      this.antreanBullmq(),
      this.outboxPending(),
      this.selisihRekonsiliasi(),
      this.holdMenggantung(),
      this.webhookGagal(),
      this.biayaLlm(),
    ]);

    return [
      {
        metric: 'error_rate_5xx',
        status: 'butuh_agregator',
        value: null,
        threshold: null,
        note: 'sumbernya log per-request (R-04 §17.1); agregatornya bagian F-05',
      },
      {
        metric: 'p95_latency_hub',
        status: 'butuh_agregator',
        value: null,
        threshold: null,
        note: 'sumbernya log per-request (R-04 §17.1); agregatornya bagian F-05',
      },
      antrean,
      outbox,
      rekonsiliasi,
      hold,
      webhook,
      biaya,
    ];
  }

  /**
   * Menjalankan evaluasi dan MENULIS satu baris `error` per ambang terlampaui.
   *
   * Baris itulah alert-nya sampai ada agregator: apa pun yang membaca log
   * bisa memicu notifikasi dari `level: error` + `alert: true` tanpa tahu
   * apa-apa tentang metrik kita.
   */
  async runOnce(): Promise<Metrik[]> {
    const hasil = await this.evaluate();
    for (const m of hasil) {
      if (m.status !== 'breached') continue;
      process.stderr.write(
        `${barisLog('error', `ambang metrik terlampaui: ${m.metric}`, {
          alert: true,
          metric: m.metric,
          value: m.value,
          threshold: m.threshold,
        })}\n`,
      );
    }
    return hasil;
  }

  private async antreanBullmq(): Promise<Metrik> {
    const n = await this.antrean.getJobCounts('waiting', 'delayed', 'prioritized');
    const value = (n.waiting ?? 0) + (n.delayed ?? 0) + (n.prioritized ?? 0);
    return metrik('bullmq_queue_depth', value, AMBANG.antreanBullmq);
  }

  private async outboxPending(): Promise<Metrik> {
    const r = await this.db
      .selectFrom('outbox_events')
      .select(sql<string>`count(*)`.as('n'))
      .where('processed_at', 'is', null)
      .executeTakeFirstOrThrow();
    return metrik('outbox_pending', Number(r.n), AMBANG.outboxPending);
  }

  /**
   * Selisih `users.coin_balance` vs `SUM(coin_ledger)` — aturan keras 2.
   *
   * Ambangnya **apa pun ≠ 0**, dan itu satu-satunya metrik di §17.2 yang
   * ambangnya nol: cache saldo yang menyimpang berarti ada kode yang menulis
   * di luar `CoinLedgerService`, dan itu tidak pernah "sedikit".
   */
  private async selisihRekonsiliasi(): Promise<Metrik> {
    const r = await this.db
      .selectFrom('users')
      .leftJoin('coin_ledger', 'coin_ledger.user_id', 'users.id')
      .select(sql<string>`count(*)`.as('n'))
      .groupBy(['users.id', 'users.coin_balance'])
      .having(sql<boolean>`users.coin_balance <> coalesce(sum(coin_ledger.amount), 0)`)
      .execute()
      .then((rows) => ({ n: String(rows.length) }));
    return metrik('coin_reconcile_drift', Number(r.n), AMBANG.selisihRekonsiliasi);
  }

  private async holdMenggantung(): Promise<Metrik> {
    const r = await this.db
      .selectFrom('plagiarism_scans')
      .select(sql<string>`count(*)`.as('n'))
      .where('status', 'in', ['queued', 'running'])
      .where('created_at', '<', sql<Date>`now() - interval '30 minutes'`)
      .executeTakeFirstOrThrow();
    return metrik('stale_holds', Number(r.n), AMBANG.holdMenggantung);
  }

  private async webhookGagal(): Promise<Metrik> {
    const r = await this.db
      .selectFrom('audit_log')
      .select(sql<string>`count(*)`.as('n'))
      .where('action', '=', 'payment.bad_signature')
      .where('created_at', '>', sql<Date>`now() - interval '1 hour'`)
      .executeTakeFirstOrThrow();
    return metrik('payment_webhook_failures', Number(r.n), AMBANG.webhookGagalPerJam);
  }

  /** Dipinjam apa adanya dari `SA-03` — satu definisi lonjakan, bukan dua. */
  private async biayaLlm(): Promise<Metrik> {
    const h = await this.health.get();
    return {
      metric: 'llm_daily_cost',
      status: h.llm_cost.spike.alert ? 'breached' : 'ok',
      value: Number(h.llm_cost.today_usd),
      threshold: null,
      note: `rasio ${h.llm_cost.spike.ratio ?? 'n/a'} atas dasar ${h.llm_cost.spike.baseline_usd}`,
    };
  }
}

function metrik(nama: string, value: number, threshold: number): Metrik {
  return { metric: nama, status: value > threshold ? 'breached' : 'ok', value, threshold };
}
