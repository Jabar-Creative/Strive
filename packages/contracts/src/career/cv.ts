import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from '../common';

/**
 * POST /career/cv — docs/PRD.md §10.3 + §7 E8 CV-1 ("Sumber: CV lama
 * (PDF/DOCX) ATAU profil Strive Academy. Salah satu wajib ada").
 *
 * ASUMSI (perlu dikonfirmasi ke Dev A/PM): endpoint ini sinkron menerima
 * JSON berisi `target_role`+`language`+pilihan sumber. Kalau `source='upload'`,
 * `document_key` mengacu ke file yang SUDAH diunggah lebih dulu lewat alur
 * upload terpisah (pola sama seperti `POST /scans`, yang multipart) — F-08
 * tidak memodelkan multipart untuk endpoint ini karena PRD tidak menyebutnya
 * secara eksplisit sebagai multipart di §10.3.
 */
export const cvGenerateRequestSchema = z.object({
  target_role: z.string().min(1),
  language: z.enum(['id', 'en']),
  source: z.enum(['profile', 'upload']),
  document_key: z.string().optional(),
});
export type CvGenerateRequest = z.infer<typeof cvGenerateRequestSchema>;

/** → `202 {job_id}` — docs/PRD.md §13.2 tahap 1. */
export const cvGenerateResponseSchema = z.object({
  job_id: uuidSchema,
});
export type CvGenerateResponse = z.infer<typeof cvGenerateResponseSchema>;

/** docs/PRD.md §13.3 — severity temuan skor ATS. */
export const atsFindingSeveritySchema = z.enum(['error', 'warning', 'info']);
export type AtsFindingSeverity = z.infer<typeof atsFindingSeveritySchema>;

export const atsFindingSchema = z.object({
  field: z.string(),
  message: z.string(),
  severity: atsFindingSeveritySchema,
});
export type AtsFinding = z.infer<typeof atsFindingSchema>;

/**
 * `ai_jobs.status` — ASUMSI nilai (§9.3 hanya menuliskan kolom `status` tanpa
 * enum literal). Pola queued→processing→done|failed konsisten dengan
 * `plagiarism_scans.status` yang sudah punya nilai eksplisit di PRD.
 */
export const cvJobStatusSchema = z.enum(['queued', 'processing', 'done', 'failed']);
export type CvJobStatus = z.infer<typeof cvJobStatusSchema>;

/**
 * GET /career/cv/:id — docs/PRD.md §10.3 ("Hasil + temuan + URL PDF").
 * `pdf_url` adalah signed URL turunan dari `cv_documents.pdf_key` (bukan
 * key mentahnya — key internal tidak boleh bocor ke client).
 */
export const cvDocumentResponseSchema = z.object({
  id: uuidSchema,
  job_id: uuidSchema,
  status: cvJobStatusSchema,
  ats_score: z.number().int().min(0).max(100).nullable(),
  ats_findings: z.array(atsFindingSchema),
  pdf_url: z.string().url().nullable(),
  created_at: isoDateTimeSchema,
});
export type CvDocumentResponse = z.infer<typeof cvDocumentResponseSchema>;
