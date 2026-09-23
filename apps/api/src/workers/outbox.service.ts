import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Kysely } from 'kysely';

import { DATABASE, type DB } from '../infra/kysely';
import { LeaderboardService } from '../modules/league';
import { RealtimeEmitter } from '../realtime/realtime.emitter';

/** `Q-03` AC: event gagal 5× masuk `audit_log`, dan antrean tidak macet. */
export const MAX_ATTEMPTS = 5;
export const BATCH_SIZE = 50;

export interface OutboxRunResult {
  processed: number;
  failed: number;
  deadLettered: number;
}

interface OutboxRow {
  id: string;
  topic: string;
  payload: unknown;
  attempts: number;
}

type Handler = (payload: Record<string, unknown>) => Promise<void>;

/**
 * Worker outbox — `Q-03`, PRD §8.3 aturan 3 & §9.
 *
 * > **Transactional outbox untuk semua efek lintas-sistem.** Event ikut
 * > ter-commit bersama datanya; pengantaran **at-least-once**, konsumen
 * > **wajib idempoten**.
 *
 * ── Dua instance paralel tidak memproses event yang sama ──
 *
 * `FOR UPDATE SKIP LOCKED`: baris yang sedang dikunci worker lain DILEWATI,
 * bukan ditunggu. Tanpa `SKIP LOCKED` instance kedua menunggu kunci dilepas
 * lalu memproses baris yang SAMA begitu instance pertama commit — karena
 * pemeriksaan `processed_at IS NULL`-nya sudah lewat sebelum ia menunggu.
 *
 * ── Menulis Redis sambil memegang transaksi Postgres — kenapa itu TIDAK
 *    melanggar aturan keras 6 ──
 *
 * Aturan 6 melarang menulis ke Redis nilai yang berasal dari transaksi yang
 * belum commit: kalau transaksinya rollback, cache berisi angka yang tidak
 * pernah ada. Di sini nilai yang ditulis (`weekly_points`) sudah di-commit
 * PRODUSER-nya (`L-03`) jauh sebelum worker ini jalan. Transaksi worker hanya
 * memegang kunci dan mencatat pembukuan (`processed_at`, `attempts`); kalau
 * ia rollback, nilai Redis-nya tetap benar, dan event diproses ulang —
 * aman, karena konsumennya idempoten (`LeaderboardService.syncMember`).
 *
 * ── Kenapa handler membaca lewat koneksi SENDIRI, bukan lewat `trx` ──
 *
 * Galat Postgres di dalam transaksi membuat SELURUH transaksi batal
 * (`current transaction is aborted`) — pembukuan event yang gagal ikut
 * hilang, `attempts`-nya tidak pernah bertambah, dan event yang sama gagal
 * lagi selamanya di posisi terdepan antrean. Persis "antrean macet" yang
 * dilarang acceptance criteria. Handler membaca data yang SUDAH ter-commit,
 * jadi koneksinya sendiri memang yang benar.
 *
 * ── Topik tanpa konsumen tidak diambil sama sekali ──
 *
 * `streak.updated` dan `wallet.updated` ditulis sejak `S-01`/`C-01`, tapi
 * konsumennya WebSocket (`RT-01`), yang belum ada. Mengambilnya lalu
 * melewatinya akan menyumbat batch: kalau 50 event tertua semuanya topik tanpa
 * konsumen, event `points.awarded` di belakangnya tidak pernah tercapai.
 * Menandainya selesai tanpa diproses akan MEMBUANG-nya. Jadi mereka tidak
 * disentuh — tetap menunggu konsumennya, di indeks parsial yang tetap kecil.
 */
@Injectable()
export class OutboxWorkerService {
  private readonly log = new Logger(OutboxWorkerService.name);
  private readonly handlers: Record<string, Handler>;

  constructor(
    @Inject(DATABASE) private readonly db: Kysely<DB>,
    private readonly leaderboard: LeaderboardService,
    private readonly realtime: RealtimeEmitter,
  ) {
    this.handlers = {
      'points.awarded': (p) => this.pointsAwarded(p),
    };
  }

  /** Topik yang punya konsumen di worker ini. */
  get topics(): string[] {
    return Object.keys(this.handlers);
  }

  /** Satu putaran: ambil satu batch, proses, catat. */
  async runOnce(limit = BATCH_SIZE): Promise<OutboxRunResult> {
    const hasil: OutboxRunResult = { processed: 0, failed: 0, deadLettered: 0 };

    await this.db.transaction().execute(async (trx) => {
      const rows = (await trx
        .selectFrom('outbox_events')
        .select(['id', 'topic', 'payload', 'attempts'])
        .where('processed_at', 'is', null)
        .where('topic', 'in', this.topics)
        .orderBy('id')
        .limit(limit)
        .forUpdate()
        .skipLocked()
        .execute()) as OutboxRow[];

      for (const row of rows) {
        try {
          await this.handlers[row.topic]!(asRecord(row.payload));
          await trx
            .updateTable('outbox_events')
            .set({ processed_at: new Date() })
            .where('id', '=', row.id)
            .execute();
          hasil.processed += 1;
        } catch (err) {
          const attempts = row.attempts + 1;
          const pesan = err instanceof Error ? err.message : String(err);

          if (attempts >= MAX_ATTEMPTS) {
            // Dead-letter: KELUAR dari antrean (processed_at diisi) supaya
            // yang di belakangnya tidak tertahan selamanya, tapi jejaknya
            // tinggal di audit_log — bukan dibuang diam-diam.
            await trx
              .insertInto('audit_log')
              .values({
                actor_id: null,
                action: 'outbox.dead_letter',
                subject_type: 'outbox_event',
                subject_id: String(row.id),
                before: JSON.stringify({ topic: row.topic, payload: row.payload }),
                after: JSON.stringify({ attempts, error: pesan }),
              })
              .execute();
            await trx
              .updateTable('outbox_events')
              .set({ attempts, processed_at: new Date() })
              .where('id', '=', row.id)
              .execute();
            this.log.error(
              `Outbox ${row.id} (${row.topic}) gagal ${attempts}× dan dipindah ke audit_log: ${pesan}`,
            );
            hasil.deadLettered += 1;
          } else {
            await trx
              .updateTable('outbox_events')
              .set({ attempts })
              .where('id', '=', row.id)
              .execute();
            this.log.warn(`Outbox ${row.id} (${row.topic}) gagal percobaan ${attempts}: ${pesan}`);
            hasil.failed += 1;
          }
        }
      }
    });

    return hasil;
  }

  /**
   * `points.awarded` → selaraskan papan squad dengan Postgres.
   *
   * `squad_id`/`season_id` dibaca dari PAYLOAD — squad pengguna saat event
   * ditulis — bukan dicari ulang sekarang: pengguna yang pindah squad di
   * antaranya akan membuat papan squad yang SALAH yang diselaraskan.
   */
  private async pointsAwarded(p: Record<string, unknown>): Promise<void> {
    const userId = p['user_id'];
    const squadId = p['squad_id'];
    const seasonId = p['season_id'];

    if (typeof userId !== 'string') {
      throw new Error('payload points.awarded tanpa user_id');
    }
    // Pengguna tanpa squad — belum dibentuk job mingguan (Q-01). Tidak ada
    // papan untuk diselaraskan, dan itu keadaan sah, bukan kegagalan.
    if (typeof squadId !== 'string' || typeof seasonId !== 'string') return;

    await this.leaderboard.syncMember(seasonId, squadId, userId);

    // RT-1/RT-4: kabar ke kanal squad, SETELAH papan diselaraskan — klien
    // yang bereaksi dengan membaca ulang papan harus menemukan angka baru.
    //
    // Payload-nya cuma penanda, bukan skor: WS adalah pelengkap, dan REST
    // yang memberi keadaan (PRD §7 E15). Skor di dalam event akan jadi SUMBER
    // KEDUA untuk satu angka — dan event yang tiba tidak berurutan akan
    // menimpa skor baru dengan yang lama di layar pengguna.
    this.realtime.toSquad(squadId, 'score.updated', { squad_id: squadId, user_id: userId });
  }
}

/** `jsonb` datang sebagai objek dari pg; string kalau ditulis sebagai teks. */
function asRecord(payload: unknown): Record<string, unknown> {
  if (typeof payload === 'string') {
    const parsed: unknown = JSON.parse(payload);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  }
  return typeof payload === 'object' && payload !== null
    ? (payload as Record<string, unknown>)
    : {};
}
