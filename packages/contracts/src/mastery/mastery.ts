import { z } from 'zod';
import { cursorPaginatedSchema, isoDateTimeSchema, uuidSchema } from '../common';

/** docs/PRD.md §7 E12 MT-2: bank soal untuk 3 program target. */
export const masteryProgramSchema = z.enum(['chevening', 'lpdp', 'fulbright']);
export type MasteryProgram = z.infer<typeof masteryProgramSchema>;

/**
 * `mastery_sessions.status` — ASUMSI nilai (§9.3 hanya menuliskan kolom
 * `status` tanpa enum literal). `ai_reviewed` diambil literal dari AC-MT-2.
 */
export const masterySessionStatusSchema = z.enum(['in_progress', 'ai_reviewed', 'failed']);
export type MasterySessionStatus = z.infer<typeof masterySessionStatusSchema>;

export const masteryTurnSchema = z.object({
  question: z.string(),
  answer: z.string().nullable(),
  feedback: z.string().nullable(),
});
export type MasteryTurn = z.infer<typeof masteryTurnSchema>;

/**
 * POST /mastery/interview — docs/PRD.md §7 E12 MT-3: 5 pertanyaan statis dari
 * bank soal program yang dipilih, satu putaran, TIDAK ADA pertanyaan lanjutan
 * adaptif.
 */
export const masteryInterviewRequestSchema = z.object({
  target: masteryProgramSchema,
});
export type MasteryInterviewRequest = z.infer<typeof masteryInterviewRequestSchema>;

export const masteryInterviewResponseSchema = z.object({
  id: uuidSchema,
  kind: z.literal('interview'),
  target: masteryProgramSchema,
  turns: z.array(masteryTurnSchema),
  status: masterySessionStatusSchema,
});
export type MasteryInterviewResponse = z.infer<typeof masteryInterviewResponseSchema>;

/**
 * POST /mastery/interview/:id/submit — docs/PRD.md §10.3 ("Kirim jawaban → feedback LLM").
 *
 * Batas `.max()` — koreksi audit F-08 (T-4): bank soal MT-3 cuma 5 pertanyaan
 * statis per sesi, jadi array jawaban tidak pernah butuh lebih dari itu;
 * `.max(10)` diberi sedikit ruang tapi tetap menutup kemungkinan mengirim
 * ribuan jawaban fiktif ke jalur feedback LLM berbayar. `answer.max(5000)`
 * mencegah satu jawaban raksasa membebani biaya token LLM tanpa batas.
 */
export const masteryInterviewSubmitRequestSchema = z.object({
  answers: z
    .array(
      z.object({
        index: z.number().int().nonnegative(),
        answer: z.string().min(1).max(5000),
      }),
    )
    .min(1)
    .max(10),
});
export type MasteryInterviewSubmitRequest = z.infer<typeof masteryInterviewSubmitRequestSchema>;

/**
 * MT-5: "Semua output AI ditandai sebagai saran, bukan penilaian resmi" —
 * `is_advisory` literal `true` membuat aturan ini bagian dari TIPE, bukan
 * cuma konvensi yang harus diingat orang saat menulis UI.
 */
export const masteryInterviewSubmitResponseSchema = z.object({
  id: uuidSchema,
  status: masterySessionStatusSchema,
  turns: z.array(masteryTurnSchema),
  is_advisory: z.literal(true),
});
export type MasteryInterviewSubmitResponse = z.infer<typeof masteryInterviewSubmitResponseSchema>;

/**
 * POST /mastery/statement — docs/PRD.md §7 E12 MT-4.
 * `.max(20000)` pada draft — koreksi audit F-08 (T-4): personal statement
 * wajar di kisaran 500-1000 kata (~5000 karakter); 20.000 karakter memberi
 * ruang lebih dari cukup sambil tetap menutup biaya LLM tak terbatas dari
 * draft yang sengaja dibuat raksasa.
 */
export const masteryStatementRequestSchema = z.object({
  target: masteryProgramSchema,
  draft: z.string().min(1).max(20_000),
});
export type MasteryStatementRequest = z.infer<typeof masteryStatementRequestSchema>;

export const masteryStatementFeedbackSchema = z.object({
  structure: z.string(),
  clarity: z.string(),
  evidence: z.string(),
  program_fit: z.string(),
});
export type MasteryStatementFeedback = z.infer<typeof masteryStatementFeedbackSchema>;

export const masteryStatementResponseSchema = z.object({
  id: uuidSchema,
  kind: z.literal('statement'),
  status: masterySessionStatusSchema,
  feedback: masteryStatementFeedbackSchema.nullable(),
  is_advisory: z.literal(true),
});
export type MasteryStatementResponse = z.infer<typeof masteryStatementResponseSchema>;

/** GET /mastery/sessions?cursor= — docs/PRD.md §10.3 ("Riwayat sesi milik sendiri"). */
export const masterySessionSummarySchema = z.object({
  id: uuidSchema,
  kind: z.enum(['interview', 'statement']),
  target: z.string(),
  status: masterySessionStatusSchema,
  created_at: isoDateTimeSchema,
});
export type MasterySessionSummary = z.infer<typeof masterySessionSummarySchema>;

export const masterySessionsResponseSchema = cursorPaginatedSchema(masterySessionSummarySchema);
export type MasterySessionsResponse = z.infer<typeof masterySessionsResponseSchema>;
