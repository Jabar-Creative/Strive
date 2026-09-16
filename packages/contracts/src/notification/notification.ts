import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from '../common';

/** docs/PRD.md §7 E16 NO-1. */
export const notificationKindSchema = z.enum([
  'streak_warning',
  'league_change',
  'job_done',
  'review_validated',
]);
export type NotificationKind = z.infer<typeof notificationKindSchema>;

/**
 * Bentuk satu notifikasi — kolom sungguhan dari `db/migrations/001_init.sql`
 * (`CREATE TABLE notifications`), BUKAN dari ringkasan PRD §9.3.
 *
 * KOREKSI ORCHESTRATOR setelah review F-08: draf pertama item ini memakai
 * daftar kolom dari tabel ringkasan PRD §9.3 (`id, user_id, kind, title,
 * body, data, read_at, sent_at`) dan menyimpulkan tidak ada `created_at`.
 * Itu keliru — tabel ringkasan PRD memang sengaja meringkas dan menghilangkan
 * kolom timestamp rutin di banyak baris, BUKAN daftar kolom lengkap. Migrasi
 * SQL adalah sumber kebenaran skema (CLAUDE.md §Perkakas: "SQL sumber
 * kebenaran, TypeScript turunannya"), dan di sana `notifications` PUNYA
 * `created_at timestamptz NOT NULL DEFAULT now()`.
 *
 * `sent_at` juga dikoreksi jadi nullable: kolomnya `timestamptz` TANPA
 * `NOT NULL` di migrasi — nullable sebelum terkirim, dan tetap NULL setelah
 * 3x retry gagal (komentar migrasi: "NULL setelah 3x retry gagal = tidak
 * hilang diam-diam", NO-4).
 *
 * CATATAN F-08 (gap dokumentasi, lihat laporan item): §10.3 TIDAK punya
 * endpoint eksplisit untuk domain ini (mis. `GET /notifications`,
 * `PATCH /notifications/:id/read`) — N-01 sedang membangun API-nya secara
 * paralel di worktree lain. Karena itu di sini HANYA skema bentuk (dipakai
 * nanti oleh N-01), BUKAN skema request/response endpoint.
 */
export const notificationSchema = z.object({
  id: uuidSchema,
  kind: notificationKindSchema,
  title: z.string(),
  body: z.string(),
  data: z.record(z.unknown()).nullable(),
  read_at: isoDateTimeSchema.nullable(),
  sent_at: isoDateTimeSchema.nullable(),
  created_at: isoDateTimeSchema,
});
export type Notification = z.infer<typeof notificationSchema>;
