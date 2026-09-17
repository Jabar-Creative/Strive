import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from '../common';

/**
 * GET /mentor/queue — docs/PRD.md §10.3 ("Review menunggu validasi") + §7 E11.
 * Bentuk mengikuti tabel `peer_reviews` (§9.3). PR-2 (identitas penulis
 * disembunyikan dari REVIEWER) tidak relevan di sini karena ini layar
 * MENTOR, bukan reviewer — tapi identitas `author_id` tetap TIDAK disertakan
 * supaya mentor pun tidak mengenali penulis dari daftar antrean (kolusi
 * antar-teman dicegah di serializer, bukan di UI — CLAUDE.md "Yang sering
 * salah di proyek ini").
 *
 * `rubric_scores` adalah `jsonb` tanpa bentuk field literal di PRD —
 * dimodelkan sebagai `record<string, number>` (skor per kriteria rubrik).
 */
export const mentorQueueItemSchema = z.object({
  review_id: uuidSchema,
  attempt_id: uuidSchema,
  reviewer_id: uuidSchema,
  rubric_scores: z.record(z.number()),
  comment: z.string().nullable(),
  weighted_points: z.number(),
  created_at: isoDateTimeSchema,
});
export type MentorQueueItem = z.infer<typeof mentorQueueItemSchema>;

export const mentorQueueResponseSchema = z.array(mentorQueueItemSchema);
export type MentorQueueResponse = z.infer<typeof mentorQueueResponseSchema>;

/**
 * POST /mentor/reviews/:id/validate — docs/PRD.md §10.3 ("Approve/tolak +
 * catatan") + PR-6 (approve memicu `earn_review` tepat sekali).
 */
// `.max(2000)` pada mentor_note — koreksi audit F-08 (T-4): catatan mentor
// wajar berupa beberapa kalimat, bukan dokumen; batas atas mencegah payload
// tak wajar tanpa mengganggu pemakaian normal.
export const validateReviewRequestSchema = z.object({
  approve: z.boolean(),
  mentor_note: z.string().max(2000).optional(),
});
export type ValidateReviewRequest = z.infer<typeof validateReviewRequestSchema>;

export const validateReviewResponseSchema = z.object({
  review_id: uuidSchema,
  mentor_checked: z.boolean(),
  mentor_delta: z.number().nullable(),
});
export type ValidateReviewResponse = z.infer<typeof validateReviewResponseSchema>;
