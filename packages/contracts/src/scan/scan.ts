import { z } from 'zod';
import { coinAmountSchema, cursorPaginatedSchema, isoDateTimeSchema, uuidSchema } from '../common';

/** docs/PRD.md §9.3 `plagiarism_scans.status`. */
export const scanStatusSchema = z.enum(['queued', 'running', 'done', 'failed', 'released']);
export type ScanStatus = z.infer<typeof scanStatusSchema>;

/**
 * Bentuk umum satu scan, dipakai di response POST /scans, GET /scans (list),
 * dan sebagai basis GET /scans/:id (yang menambah `report_url`+`error_message`).
 *
 * CATATAN F-08: POST /scans adalah `multipart/form-data` (upload file), dan
 * PRD tidak mendokumentasikan field non-file lain di body-nya (§10.3: "Upload
 * → SHA-256 → dedup → hold → enqueue" — tidak ada field tambahan yang
 * disebut). Karena itu TIDAK ADA skema request di file ini; scope F-08
 * eksplisit hanya minta metadata non-file kalau ada, dan tidak ada yang perlu
 * divalidasi zod di luar file itu sendiri (validasi tipe/ukuran file
 * dilakukan di layer upload NestJS, bukan zod).
 */
export const scanSummarySchema = z.object({
  id: uuidSchema,
  filename: z.string(),
  word_count: z.number().int().nullable(),
  status: scanStatusSchema,
  similarity_score: z.number().nullable(),
  cost_coins: coinAmountSchema,
  created_at: isoDateTimeSchema,
  completed_at: isoDateTimeSchema.nullable(),
});
export type ScanSummary = z.infer<typeof scanSummarySchema>;

/** POST /scans → response 200/202 berisi scan yang baru dibuat (status `queued` atau `done` kalau dedup — KL-2/KL-3). */
export const createScanResponseSchema = scanSummarySchema;
export type CreateScanResponse = z.infer<typeof createScanResponseSchema>;

export const scanListResponseSchema = cursorPaginatedSchema(scanSummarySchema);
export type ScanListResponse = z.infer<typeof scanListResponseSchema>;

/**
 * GET /scans/:id — docs/PRD.md §10.3 ("Status + skor + URL laporan (signed,
 * 15 menit)"). `report_url` nullable karena hanya terisi setelah `status='done'`.
 */
export const scanDetailResponseSchema = scanSummarySchema.extend({
  report_url: z.string().url().nullable(),
  error_message: z.string().nullable(),
});
export type ScanDetailResponse = z.infer<typeof scanDetailResponseSchema>;
