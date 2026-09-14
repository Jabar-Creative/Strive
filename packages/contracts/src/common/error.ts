import { z } from 'zod';

/**
 * Bentuk error API, dikunci di docs/PRD.md §10.1.
 *
 * `code` adalah KONTRAK; `message` bukan. Client SELALU bercabang pada `code`
 * dan tidak pernah mem-parsing `message`.
 */
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.unknown()).optional(),
  }),
});

export type ApiError = z.infer<typeof apiErrorSchema>;

/**
 * Kode error standar — docs/PRD.md §10.2.
 * Daftar ini adalah bagian dari kontrak API; menambah kode berarti mengubah
 * kontrak, jadi lewat PR terpisah (CLAUDE.md §Kepemilikan file).
 */
export const API_ERROR_CODES = [
  'UNAUTHENTICATED',
  'FORBIDDEN_ROLE',
  'NOT_OWNER',
  'EMAIL_NOT_VERIFIED',
  'EMAIL_TAKEN',
  'INSUFFICIENT_COINS',
  'DAILY_AI_QUOTA_EXCEEDED',
  'DAILY_SCAN_QUOTA_EXCEEDED',
  'ALREADY_PURCHASED',
  'NO_FREEZE_CREDITS',
  'SELF_REVIEW_FORBIDDEN',
  'UNSUPPORTED_FILE_TYPE',
  'FILE_TOO_LARGE',
  'DOCUMENT_TOO_LONG',
  'SOURCE_TOO_SHORT',
  'RATE_LIMITED',
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];
