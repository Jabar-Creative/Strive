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

const PREFIX = 'sc';

export interface ScanHistoryItem {
  id: string;
  filename: string;
  word_count: number | null;
  status: string;
  /** `numeric(5,2)` — string, bukan number: lihat catatan serializer. */
  similarity_score: string | null;
  cost_coins: number;
  /** `true` kalau hasilnya diambil dari scan identik yang sudah pernah ada. */
  from_cache: boolean;
  error_message: string | null;
  created_at: Date;
  completed_at: Date | null;
}

/**
 * `GET /scans` — `F-14` (isu #88), PRD §10.3: *"Riwayat"*.
 *
 * ── Yang TIDAK dikirim, dan kenapa ──
 *
 * `document_key` dan `report_key` adalah kunci objek di storage. Keduanya
 * internal: URL yang boleh dipegang pengguna adalah URL **bertanda tangan**
 * berumur 15 menit dari `GET /scans/:id` (PRD §10.3), bukan kunci mentah yang
 * berlaku selamanya dan bisa dicoba di bucket lain.
 *
 * `document_sha256` juga tidak: ia kunci dedup lintas-pengguna, dan
 * membocorkannya berarti siapa pun bisa menguji apakah sebuah dokumen pernah
 * discan orang lain.
 *
 * `hold_ledger_id` tidak: id entri ledger bukan urusan layar riwayat scan.
 *
 * ── `cached_from` jadi boolean ──
 *
 * Kolomnya menunjuk scan **milik siapa pun** yang dokumennya identik
 * (`KL-2`). Mengirim id itu apa adanya membocorkan keberadaan scan orang lain.
 * Yang dibutuhkan pengguna cuma tahu kenapa tarifnya lebih murah.
 */
@Injectable()
export class ScanHistoryService {
  constructor(@Inject(DATABASE) private readonly db: Kysely<DB>) {}

  async historyFor(
    userId: string,
    opts: { cursor?: string | undefined; limit?: unknown } = {},
  ): Promise<HistoryPage<ScanHistoryItem>> {
    const limit = clampLimit(opts.limit);

    let q = this.db
      .selectFrom('plagiarism_scans')
      .select([
        'id',
        'filename',
        'word_count',
        'status',
        'similarity_score',
        'cost_coins',
        'cached_from',
        'error_message',
        'created_at',
        'completed_at',
        waktuCursor('created_at').as('cursor_ts'),
      ])
      .where('user_id', '=', userId)
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(limit + 1);

    if (opts.cursor) {
      q = q.where(setelahCursor('created_at', 'id', decodeCursor(PREFIX, opts.cursor)));
    }

    return potongHalaman(await q.execute(), limit, PREFIX, (row) => ({
      id: row.id,
      filename: row.filename,
      word_count: row.word_count,
      status: row.status,
      // `numeric` datang sebagai string dari pg, dan itu DIPERTAHANKAN:
      // mengubahnya jadi float di sini menukar presisi desimal dengan
      // kenyamanan, untuk angka yang ditampilkan apa adanya.
      similarity_score: row.similarity_score,
      cost_coins: row.cost_coins,
      from_cache: row.cached_from !== null,
      error_message: row.error_message,
      created_at: row.created_at,
      completed_at: row.completed_at,
    }));
  }
}
