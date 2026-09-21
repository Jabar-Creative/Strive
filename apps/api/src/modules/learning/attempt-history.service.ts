import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';

import {
  type HistoryPage,
  clampLimit,
  decodeCursor,
  potongHalaman,
  setelahCursor,
  waktuCursor,
} from '../../common/cursor';
import { DATABASE, type DB } from '../../infra/kysely';

/** Prefiks cursor rute ini — lihat `common/cursor.ts`. */
const PREFIX = 'at';

export interface AttemptHistoryItem {
  id: string;
  lesson_id: string;
  lesson_title: string;
  /** Tanggal LOKAL pengguna saat attempt dibuat, `YYYY-MM-DD`. */
  attempt_date: string;
  score: number;
  points: number;
  coins: number;
  duration_ms: number;
  completed_at: Date;
}

/**
 * `GET /attempts` — `F-14` (isu #88), PRD §10.3: *"Riwayat attempt milik sendiri"*.
 *
 * ── `card_results` sengaja TIDAK dikirim ──
 *
 * Kolomnya memuat jawaban per kartu, dan riwayat adalah daftar — satu halaman
 * 20 attempt akan membawa ratusan objek jawaban yang tidak dipakai layar
 * riwayat mana pun. Kalau nanti ada layar "lihat detail attempt", ia butuh
 * rutenya sendiri, dan di situlah keputusan soal apa yang boleh terlihat
 * (aturan 9: kunci jawaban dibuang serializer) dibuat sekali lagi.
 *
 * ── Diurutkan `completed_at`, bukan `attempt_date` ──
 *
 * `attempt_date` adalah tanggal LOKAL pengguna dan tidak unik: satu hari bisa
 * punya banyak attempt. `completed_at` yang memberi urutan sesungguhnya, dan
 * indeks `lesson_attempts_user_idx (user_id, completed_at DESC)` memang
 * dibuat untuk itu.
 */
@Injectable()
export class AttemptHistoryService {
  constructor(@Inject(DATABASE) private readonly db: Kysely<DB>) {}

  async historyFor(
    userId: string,
    opts: { cursor?: string | undefined; limit?: unknown } = {},
  ): Promise<HistoryPage<AttemptHistoryItem>> {
    const limit = clampLimit(opts.limit);

    let q = this.db
      .selectFrom('lesson_attempts as a')
      .innerJoin('lessons as l', 'l.id', 'a.lesson_id')
      .select([
        'a.id',
        'a.lesson_id',
        'l.title as lesson_title',
        'a.attempt_date',
        'a.score',
        'a.points',
        'a.coins',
        'a.duration_ms',
        'a.completed_at',
        waktuCursor('a.completed_at').as('cursor_ts'),
      ])
      // Kepemilikan di WHERE, bukan diperiksa setelah baris diambil.
      .where('a.user_id', '=', userId)
      .orderBy('a.completed_at', 'desc')
      .orderBy('a.id', 'desc')
      .limit(limit + 1);

    if (opts.cursor) {
      q = q.where(setelahCursor('a.completed_at', 'a.id', decodeCursor(PREFIX, opts.cursor)));
    }

    return potongHalaman(await q.execute(), limit, PREFIX, (row) => ({
      id: row.id,
      lesson_id: row.lesson_id,
      lesson_title: row.lesson_title,
      attempt_date: row.attempt_date,
      score: row.score,
      points: row.points,
      coins: row.coins,
      duration_ms: row.duration_ms,
      completed_at: row.completed_at,
    }));
  }
}
