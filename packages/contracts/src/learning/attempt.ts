import { z } from 'zod';
import { cursorPaginatedSchema, isoDateTimeSchema, localDateSchema, uuidSchema } from '../common';

/**
 * Satu jawaban di request POST /attempts — docs/PRD.md §10.3 contoh payload.
 * `answer` bertipe union: string (id opsi, mis. `multiple_choice`) ATAU
 * boolean (`swipe_binary`, contoh PRD: `"answer": true`).
 */
export const attemptAnswerRequestSchema = z.object({
  card_id: uuidSchema,
  answer: z.union([z.string().max(200), z.boolean()]),
  ms: z.number().int().nonnegative(),
});
export type AttemptAnswerRequest = z.infer<typeof attemptAnswerRequestSchema>;

/**
 * POST /attempts — docs/PRD.md §10.3 + §7 E2. Inti sistem: satu transaksi
 * attempt+streak+koin+quest+poin squad+outbox (LE-6). Kasus tepi LE (client
 * kirim jawaban parsial) divalidasi di server, BUKAN di sini — skema ini
 * hanya memastikan minimal satu jawaban dikirim.
 *
 * `.max(5)` — koreksi audit F-08 (T-4): PRD LE-1 mengunci 3-5 kartu per
 * lesson, jadi satu attempt tidak pernah butuh jawaban lebih dari itu. Tanpa
 * batas atas, satu request bisa membawa jutaan elemen langsung ke transaksi
 * enam-langkah `POST /attempts` (CLAUDE.md "Pola wajib").
 */
export const createAttemptRequestSchema = z.object({
  lesson_id: uuidSchema,
  answers: z.array(attemptAnswerRequestSchema).min(1).max(5),
  duration_ms: z.number().int().nonnegative(),
});
export type CreateAttemptRequest = z.infer<typeof createAttemptRequestSchema>;

/**
 * `kind` transisi streak akibat attempt ini — docs/PRD.md §7 E3 aturan SK-4/SK-6.
 * ASUMSI (PRD hanya mencontohkan nilai `"extended"` di §10.3): keempat nilai
 * ini mengikuti aturan bisnis SK-4 (gap=1 → extended, gap>1 → reset ke 1),
 * SK-3 (task kedua di hari sama → unchanged), dan SK-6 (freeze dipakai →
 * ditangani terpisah lewat POST /streak/freeze, bukan lewat attempt). Perlu
 * dikonfirmasi ke Dev A saat attempts.service.ts diimplementasikan.
 */
export const streakUpdateKindSchema = z.enum(['extended', 'reset', 'unchanged']);
export const streakUpdateSchema = z.object({
  kind: streakUpdateKindSchema,
  current: z.number().int(),
  longest: z.number().int(),
  is_new_record: z.boolean(),
});
export type StreakUpdate = z.infer<typeof streakUpdateSchema>;

export const dailyQuestProgressSchema = z.object({
  done_tasks: z.number().int(),
  target_tasks: z.number().int(),
  completed: z.boolean(),
});
export type DailyQuestProgress = z.infer<typeof dailyQuestProgressSchema>;

/**
 * Feedback per kartu SETELAH attempt dinilai — BUKAN kebocoran kunci jawaban.
 * Beda dengan `lessonCardResponseSchema` (sebelum dijawab): di sini
 * `correct`/`why` sah ditampilkan karena pengguna sudah mengirim jawabannya
 * dan sedang melihat hasil penilaiannya sendiri (docs/PRD.md §10.3 contoh
 * response `POST /attempts`).
 */
export const attemptFeedbackItemSchema = z.object({
  card_id: uuidSchema,
  correct: z.boolean(),
  why: z.string(),
});
export type AttemptFeedbackItem = z.infer<typeof attemptFeedbackItemSchema>;

export const createAttemptResponseSchema = z.object({
  attempt_id: uuidSchema,
  rewarded: z.boolean(),
  score: z.number().int().min(0).max(100),
  points: z.number().int(),
  coins: z.number().int(),
  balance: z.number().int(),
  streak: streakUpdateSchema,
  quest: dailyQuestProgressSchema,
  feedback: z.array(attemptFeedbackItemSchema),
});
export type CreateAttemptResponse = z.infer<typeof createAttemptResponseSchema>;

/** GET /attempts?cursor= — riwayat attempt milik sendiri. docs/PRD.md §9.3 `lesson_attempts`. */
export const attemptSummarySchema = z.object({
  id: uuidSchema,
  lesson_id: uuidSchema,
  attempt_date: localDateSchema,
  score: z.number().int(),
  points: z.number().int(),
  coins: z.number().int(),
  duration_ms: z.number().int(),
  completed_at: isoDateTimeSchema,
});
export type AttemptSummary = z.infer<typeof attemptSummarySchema>;

export const attemptListResponseSchema = cursorPaginatedSchema(attemptSummarySchema);
export type AttemptListResponse = z.infer<typeof attemptListResponseSchema>;
