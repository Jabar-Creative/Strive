import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { CurrentUserId, Roles, RolesGuard, SessionGuard } from '../../common/guards';
import type { HistoryPage } from '../../common/cursor';
import { type ReceivedReview, ReviewHistoryService } from './review-history.service';
import { type ReviewQueueItem, ReviewService, type SubmitReviewResult } from './review.service';

/** Bentuk body `POST /reviews/:id`. Divalidasi di service, bukan hanya di sini. */
interface SubmitBody {
  rubric_scores?: unknown;
  comment?: unknown;
}

/**
 * `GET /reviews/queue` dan `POST /reviews/:id` — PRD §10.3, `PR-02`.
 *
 * ── `reviewerId` SELALU dari guard, tidak pernah dari body ──
 *
 * Kalau reviewer bisa dikirim klien, siapa pun bisa menulis review atas nama
 * orang lain — dan karena review menghasilkan poin, itu artinya mencetak poin
 * untuk akun mana pun. Batas ini yang membuat seluruh aturan `PR-*` di service
 * ada gunanya.
 *
 * ── Superadmin DITOLAK, sengaja ──
 *
 * Peer review adalah pekerjaan student dan mentor (PRD §2.4). Superadmin yang
 * ikut menilai bukan "admin boleh segalanya", itu orang yang tidak ada di
 * squad mana pun ikut menentukan poin orang lain.
 */
@UseGuards(SessionGuard, RolesGuard)
@Roles('student', 'mentor')
@Controller('reviews')
export class ReviewController {
  constructor(
    private readonly reviews: ReviewService,
    private readonly riwayat: ReviewHistoryService,
  ) {}

  /**
   * `GET /reviews/mine` — review yang pemanggilnya **terima** (`F-14`).
   *
   * Didaftarkan sebelum `POST :id`; keduanya metode berbeda jadi tidak
   * bertabrakan, tapi `mine` tetap ditaruh di atas supaya terbaca sebagai
   * rute tetap, bukan nilai `:id`.
   *
   * Respons tidak memuat identitas reviewer — `ReceivedReview` tidak punya
   * field-nya. Arti "mine" diputuskan di isu #100: yang saya TERIMA, mengikuti
   * PRD §10.3.
   */
  @Get('mine')
  async mine(
    @CurrentUserId() userId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ): Promise<HistoryPage<ReceivedReview>> {
    return this.riwayat.receivedBy(userId, { cursor, limit });
  }

  /**
   * Antrean review milik si pemanggil.
   *
   * Respons TIDAK memuat identitas penulis di mana pun — bukan karena dibuang
   * di sini, tapi karena `ReviewQueueItem` tidak punya field-nya (PR-2).
   */
  @Get('queue')
  async queue(@CurrentUserId() reviewerId: string): Promise<ReviewQueueItem[]> {
    return this.reviews.queueFor(reviewerId);
  }

  /**
   * Mengirim penilaian rubrik untuk satu attempt.
   *
   * `:id` adalah `attempt_id`, bukan id review — review-nya belum ada sampai
   * request ini berhasil (PRD §10.3).
   */
  @Post(':id')
  async submit(
    @CurrentUserId() reviewerId: string,
    @Param('id') attemptId: string,
    @Body() body: SubmitBody,
  ): Promise<SubmitReviewResult> {
    const skor = body?.rubric_scores;
    if (typeof skor !== 'object' || skor === null || Array.isArray(skor)) {
      throw new BadRequestException({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'rubric_scores harus objek { kriteria: nilai }',
          details: { received: skor === null ? 'null' : typeof skor },
        },
      });
    }

    const comment = body?.comment;
    if (comment !== undefined && comment !== null && typeof comment !== 'string') {
      throw new BadRequestException({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'comment harus string',
          details: { received: typeof comment },
        },
      });
    }

    return this.reviews.submit({
      reviewerId,
      attemptId,
      // Nilainya sendiri divalidasi `totalRubrik()` di service — di situ, bukan
      // di sini, supaya jalur non-HTTP (worker, skrip perbaikan data) tidak
      // bisa melewatinya.
      rubricScores: skor as Record<string, number>,
      comment: comment ?? undefined,
    });
  }
}
