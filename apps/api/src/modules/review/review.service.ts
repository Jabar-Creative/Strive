import { ConflictException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { type Kysely, sql } from 'kysely';

import { DATABASE, type DB } from '../../infra/kysely';

/** PR-1: setiap submission dialokasikan ke 2 reviewer dari squad berbeda. */
export const REVIEWERS_PER_ATTEMPT = 2;

/**
 * Satu item antrean review — **tanpa identitas penulis**.
 *
 * Bentuk ini yang menegakkan PR-2. Tidak ada `author_id`, tidak ada nama,
 * tidak ada avatar. Bukan disembunyikan di UI — memang tidak ada di sini.
 */
export interface ReviewQueueItem {
  attempt_id: string;
  attempt_date: string;
  lesson_id: string;
  lesson_title: string;
  card_results: unknown;
  /** Berapa review yang sudah masuk untuk attempt ini (0 atau 1). */
  reviews_so_far: number;
}

export interface SubmitReviewInput {
  reviewerId: string;
  attemptId: string;
  rubricScores: Record<string, number>;
  comment?: string | undefined;
}

/**
 * Peer review — PRD §7 E11 `PR-1` … `PR-3`.
 *
 * ── Kenapa tidak ada tabel "penugasan" ──
 *
 * `peer_reviews.rubric_scores` bertipe `NOT NULL`, jadi barisnya baru ada
 * setelah review DIKERJAKAN. Alokasi karena itu dihitung saat antrean dibaca,
 * bukan disimpan: attempt yang belum punya 2 review, bukan dari squad si
 * reviewer, dan bukan miliknya sendiri.
 *
 * Menyimpan penugasan akan menambah tabel di luar PRD §9 — dan menambah satu
 * keadaan yang bisa basi (reviewer keluar squad setelah ditugaskan).
 *
 * ── PR-2 ditegakkan oleh BENTUK DATA, bukan oleh kehati-hatian ──
 *
 * `ReviewQueueItem` tidak punya `author_id`. Tidak ada tempat untuk lupa
 * membuangnya, karena ia tidak pernah ada di sana. Serializer yang membuang
 * field bisa dilewati; tipe yang tidak punya field itu tidak bisa.
 */
@Injectable()
export class ReviewService {
  constructor(@Inject(DATABASE) private readonly db: Kysely<DB>) {}

  /**
   * Antrean review untuk satu reviewer — `GET /reviews/queue`.
   *
   * Empat penyaring, dan tiga di antaranya adalah aturan produk:
   *   1. attempt belum punya 2 review              (PR-1)
   *   2. bukan karya si reviewer sendiri           (PR-3)
   *   3. penulisnya BUKAN dari squad yang sama     (PR-1)
   *   4. reviewer ini belum menilainya             (UNIQUE attempt_id,reviewer_id)
   */
  async queueFor(reviewerId: string, limit = 20): Promise<ReviewQueueItem[]> {
    const r = await sql<{
      attempt_id: string;
      attempt_date: string;
      lesson_id: string;
      lesson_title: string;
      card_results: unknown;
      reviews_so_far: string;
    }>`
      WITH squad_reviewer AS (
        SELECT m.squad_id FROM squad_members m
        WHERE m.user_id = ${reviewerId} AND m.left_at IS NULL
      )
      SELECT a.id AS attempt_id,
             to_char(a.attempt_date, 'YYYY-MM-DD') AS attempt_date,
             a.lesson_id,
             l.title AS lesson_title,
             a.card_results,
             (SELECT count(*) FROM peer_reviews pr WHERE pr.attempt_id = a.id)::text
               AS reviews_so_far
      FROM lesson_attempts a
      JOIN lessons l ON l.id = a.lesson_id
      WHERE a.user_id <> ${reviewerId}
        AND (SELECT count(*) FROM peer_reviews pr WHERE pr.attempt_id = a.id)
            < ${sql.lit(REVIEWERS_PER_ATTEMPT)}
        AND NOT EXISTS (
          SELECT 1 FROM peer_reviews pr
          WHERE pr.attempt_id = a.id AND pr.reviewer_id = ${reviewerId}
        )
        -- PR-1: penulis TIDAK boleh dari squad yang sama. Reviewer tanpa squad
        -- melihat semuanya; penulis tanpa squad terlihat oleh semua orang.
        AND NOT EXISTS (
          SELECT 1
          FROM squad_members penulis
          JOIN squad_reviewer sr ON sr.squad_id = penulis.squad_id
          WHERE penulis.user_id = a.user_id AND penulis.left_at IS NULL
        )
      ORDER BY a.completed_at NULLS LAST, a.id
      LIMIT ${sql.lit(0)} + ${limit}
    `.execute(this.db);

    return r.rows.map((x) => ({
      attempt_id: x.attempt_id,
      attempt_date: x.attempt_date,
      lesson_id: x.lesson_id,
      lesson_title: x.lesson_title,
      card_results: x.card_results,
      reviews_so_far: Number(x.reviews_so_far),
    }));
  }

  /**
   * Menyimpan satu review — `POST /reviews/:id`.
   *
   * Setiap penyaring antrean diperiksa ULANG di sini. Antrean adalah tampilan;
   * ia bisa basi sejak halaman dibuka, dan klien bisa mengirim `attempt_id`
   * apa pun. Yang menentukan adalah pemeriksaan di jalur tulis.
   */
  async submit(input: SubmitReviewInput): Promise<{ id: string }> {
    const attempt = await this.db
      .selectFrom('lesson_attempts')
      .select(['id', 'user_id', 'attempt_date'])
      .where('id', '=', input.attemptId)
      .executeTakeFirst();

    if (!attempt) {
      throw new ConflictException({
        error: { code: 'NOT_FOUND', message: 'Attempt tidak ditemukan', details: {} },
      });
    }

    // PR-3, lapis service. Lapis kedua ada di CHECK `no_self_review`.
    if (attempt.user_id === input.reviewerId) {
      throw new ForbiddenException({
        error: {
          code: 'SELF_REVIEW_FORBIDDEN',
          message: 'Tidak boleh menilai karya sendiri',
          details: {},
        },
      });
    }

    const seSquad = await this.sameSquad(input.reviewerId, attempt.user_id);
    if (seSquad) {
      throw new ForbiddenException({
        error: {
          code: 'FORBIDDEN_ROLE',
          message: 'Reviewer tidak boleh dari squad yang sama dengan penulis',
          details: {},
        },
      });
    }

    const sudah = await this.db
      .selectFrom('peer_reviews')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('attempt_id', '=', input.attemptId)
      .executeTakeFirst();

    if (Number(sudah?.n ?? 0) >= REVIEWERS_PER_ATTEMPT) {
      throw new ConflictException({
        error: {
          code: 'ALREADY_PURCHASED',
          message: 'Attempt ini sudah punya dua review',
          details: { max: REVIEWERS_PER_ATTEMPT },
        },
      });
    }

    const row = await this.db
      .insertInto('peer_reviews')
      .values({
        attempt_id: input.attemptId,
        // Wajib sejak migrasi 003 — bagian dari FK majemuk. Diambil DARI BARIS
        // attempt-nya, tidak pernah dibentuk di Node: ini tanggal lokal
        // pengguna, dan Date milik proses Node akan meleset satu hari.
        attempt_date: attempt.attempt_date,
        reviewer_id: input.reviewerId,
        author_id: attempt.user_id,
        rubric_scores: JSON.stringify(input.rubricScores),
        comment: input.comment ?? null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    return { id: row.id };
  }

  private async sameSquad(a: string, b: string): Promise<boolean> {
    const r = await this.db
      .selectFrom('squad_members as x')
      .innerJoin('squad_members as y', 'y.squad_id', 'x.squad_id')
      .select('x.squad_id')
      .where('x.user_id', '=', a)
      .where('y.user_id', '=', b)
      .where('x.left_at', 'is', null)
      .where('y.left_at', 'is', null)
      .executeTakeFirst();
    return r !== undefined;
  }
}
