import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from '../common';

/**
 * POST /career/cv — docs/PRD.md §10.3 + §7 E8 CV-1 ("Sumber: CV lama
 * (PDF/DOCX) ATAU profil Strive Academy. Salah satu wajib ada").
 *
 * ── Koreksi AI-07 atas draf F-08 (5 Nov 2026) ──
 *
 * Draf pertama memakai `upload_id` yang menunjuk unggahan terpisah. Tabel
 * `uploads` tidak pernah ada di §9, jadi asumsi itu tidak bisa diimplementasi;
 * sejak AI-07 dokumen dikirim INLINE sebagai `document_base64` (batas body
 * parser 11 MB, ukuran terdekripsi maksimum 8 MB di sisi Node — penjaga
 * dekompresi #207 tetap di layanan AI). `target_role` dirapatkan 200 → 120
 * karakter menyamai `BagianCv` layanan AI (`services/ai/app/routers/cv.py`),
 * dan `cvJobStatus` dikoreksi `'processing'` → `'running'` menyamai constraint
 * `ai_jobs_status_valid` di migrasi 001 — dua nilai itu tertulis dari dugaan,
 * dan keduanya salah terhadap kode yang benar-benar berjalan.
 */
/** Kontak dalam profil CV — seluruhnya opsional, sesuai `Kontak` layanan AI. */
export const cvKontakSchema = z.object({
  email: z.string().max(320).optional(),
  telepon: z.string().max(40).optional(),
  linkedin: z.string().max(200).optional(),
  website: z.string().max(200).optional(),
});

/** Satu pengalaman kerja dalam profil CV. */
export const cvPengalamanSchema = z.object({
  judul: z.string().min(1).max(200),
  perusahaan: z.string().min(1).max(200),
  mulai: z.string().min(1).max(20),
  selesai: z.string().max(20).optional(),
  deskripsi: z.string().max(2000).optional(),
});

/** Satu riwayat pendidikan dalam profil CV. */
export const cvPendidikanSchema = z.object({
  gelar: z.string().min(1).max(200),
  institusi: z.string().min(1).max(200),
  mulai: z.string().min(1).max(20),
  selesai: z.string().max(20).optional(),
  jurusan: z.string().max(200).optional(),
});

export const cvProfileSchema = z.object({
  nama: z.string().min(1).max(200),
  headline: z.string().max(200).optional(),
  ringkasan: z.string().max(2000).optional(),
  kontak: cvKontakSchema.optional(),
  pengalaman: z.array(cvPengalamanSchema).max(50).optional(),
  pendidikan: z.array(cvPendidikanSchema).max(50).optional(),
  keterampilan: z.array(z.string().min(1).max(100)).max(100).optional(),
});
export type CvProfile = z.infer<typeof cvProfileSchema>;

export const cvGenerateRequestSchema = z
  .object({
    target_role: z.string().min(1).max(120),
    language: z.enum(['id', 'en']),
    source: z.enum(['profile', 'upload']),
    /** Wajib saat `source='profile'` — bentuk sama dengan `ProfilCv` layanan AI. */
    profile: cvProfileSchema.optional(),
    /** Wajib saat `source='upload'` — PDF/DOCX base64. */
    document_base64: z.string().max(11_000_000).optional(),
  })
  .refine((b) => (b.source === 'profile' ? b.profile !== undefined : true), {
    message: "source 'profile' wajib memuat field profile",
  })
  .refine((b) => (b.source === 'upload' ? b.document_base64 !== undefined : true), {
    message: "source 'upload' wajib memuat field document_base64",
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

/**
 * Satu temuan skor ATS — bentuk SAMA dengan `TemuanAts` layanan AI
 * (`services/ai/app/pipelines/ats_score.py`): `pesan` untuk pengguna,
 * `aturan` bernama §13.3 supaya UI bisa mencabang per aturan, `penalti`
 * menjelaskan berapa poin yang hilang.
 */
export const atsFindingSchema = z.object({
  severity: atsFindingSeveritySchema,
  pesan: z.string(),
  aturan: z.string(),
  penalti: z.number().int(),
});
export type AtsFinding = z.infer<typeof atsFindingSchema>;

/** `ai_jobs.status` — nilai eksplisit constraint `ai_jobs_status_valid` (migrasi 001). */
export const cvJobStatusSchema = z.enum(['queued', 'running', 'done', 'failed']);
export type CvJobStatus = z.infer<typeof cvJobStatusSchema>;

/**
 * GET /career/cv/:id — docs/PRD.md §10.3 ("Hasil + temuan + URL PDF").
 * `pdf_url` adalah signed URL turunan dari `cv_documents.pdf_key` (bukan
 * key mentahnya — key internal tidak boleh bocor ke client).
 */
export const cvDocumentResponseSchema = z.object({
  id: uuidSchema,
  job_id: uuidSchema.nullable(),
  structured: z.unknown(),
  ats_score: z.number().int().min(0).max(100).nullable(),
  ats_findings: z.array(atsFindingSchema).nullable(),
  pdf_url: z.string().url().nullable(),
  created_at: isoDateTimeSchema,
});
export type CvDocumentResponse = z.infer<typeof cvDocumentResponseSchema>;

/**
 * GET /career/cv/jobs/:jobId — status job untuk polling (AI-07). `cv` terisi
 * saat `status='done'`. `failure.code` HANYA kode §10.2: kode `ai_jobs`
 * di luar daftar tertutup itu dipetakan `INTERNAL_ERROR` di batas server
 * (isu #197) — kolom diagnosis mentah tidak pernah dikirim ke client.
 */
export const cvJobResponseSchema = z.object({
  job_id: uuidSchema,
  status: cvJobStatusSchema,
  created_at: isoDateTimeSchema,
  completed_at: isoDateTimeSchema.nullable(),
  cv: cvDocumentResponseSchema.nullable(),
  failure: z.object({ code: z.string() }).nullable(),
});
export type CvJobResponse = z.infer<typeof cvJobResponseSchema>;
