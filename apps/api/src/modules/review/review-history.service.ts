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

const PREFIX = 'rv';

/**
 * Satu review yang DITERIMA pemilik akun.
 *
 * Tidak ada `reviewer_id`, dan tidak ada nama reviewer. Bukan dibuang di
 * serializer — **tidak ada field-nya**, jadi tidak ada tempat untuk lupa
 * membuangnya. Bentuk yang sama dipakai `ReviewQueueItem` untuk arah
 * sebaliknya (PR-2).
 */
export interface ReceivedReview {
  id: string;
  attempt_id: string;
  rubric_scores: unknown;
  comment: string | null;
  weighted_points: number;
  mentor_checked: boolean;
  mentor_delta: number | null;
  created_at: Date;
}

/**
 * `GET /reviews/mine` — `F-14` (isu #88).
 *
 * ── PRD dan papan BERTENTANGAN soal rute ini ──
 *
 * `docs/PRD.md` §10.3 baris 1719: **"Review yang saya terima"**.
 * `docs/BACKLOG.md` tabel `F-14`: *"review yang kutulis"*.
 *
 * Keduanya tidak bisa benar — `author_id` dan `reviewer_id` adalah dua arah
 * yang berlawanan, dan `peer_reviews` punya indeks untuk masing-masing.
 *
 * Yang diikuti **PRD**, karena `CLAUDE.md` menetapkannya: *"PRD menang untuk
 * perilaku"*. Dan pembacaan itu juga yang lebih masuk akal — kalau
 * `/reviews/mine` berarti "yang kutulis", maka **umpan balik atas karya
 * sendiri tidak punya endpoint sama sekali** di seluruh §10.3, padahal itu
 * seluruh gunanya peer review bagi yang dinilai.
 *
 * Pertanyaannya tetap ditulis, bukan diputuskan diam-diam: isu #100.
 *
 * ── Reviewer tetap ANONIM di arah ini juga ──
 *
 * PR-2 menulis satu arah (identitas penulis disembunyikan dari reviewer), tapi
 * §14 dan §17 menyebut peer review "anonim" tanpa arah, dan kontrol
 * anti-kolusi di §17 berbunyi *"reviewer lintas squad & anonim"*. Mengirim
 * `reviewer_id` ke penulis membuka balas-membalas nilai antar-teman — persis
 * yang dicegah alokasi lintas squad.
 */
@Injectable()
export class ReviewHistoryService {
  constructor(@Inject(DATABASE) private readonly db: Kysely<DB>) {}

  async receivedBy(
    userId: string,
    opts: { cursor?: string | undefined; limit?: unknown } = {},
  ): Promise<HistoryPage<ReceivedReview>> {
    const limit = clampLimit(opts.limit);

    let q = this.db
      .selectFrom('peer_reviews')
      .select([
        'id',
        'attempt_id',
        'rubric_scores',
        'comment',
        'weighted_points',
        'mentor_checked',
        'mentor_delta',
        'created_at',
        waktuCursor('created_at').as('cursor_ts'),
      ])
      // `author_id`, bukan `reviewer_id` — lihat catatan kelas.
      .where('author_id', '=', userId)
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(limit + 1);

    if (opts.cursor) {
      q = q.where(setelahCursor('created_at', 'id', decodeCursor(PREFIX, opts.cursor)));
    }

    return potongHalaman(await q.execute(), limit, PREFIX, (row) => ({
      id: row.id,
      attempt_id: row.attempt_id,
      rubric_scores: row.rubric_scores,
      comment: row.comment,
      weighted_points: row.weighted_points,
      mentor_checked: row.mentor_checked,
      mentor_delta: row.mentor_delta,
      created_at: row.created_at,
    }));
  }
}
