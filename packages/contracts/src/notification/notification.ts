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
 * Bentuk satu notifikasi — docs/PRD.md §9.3 tabel `notifications`
 * (`id, user_id, kind, title, body, data, read_at, sent_at`).
 *
 * CATATAN F-08 (gap dokumentasi, lihat laporan item): §10.3 TIDAK punya
 * endpoint eksplisit untuk domain ini (mis. `GET /notifications`,
 * `PATCH /notifications/:id/read`) — N-01 sedang membangun API-nya secara
 * paralel di worktree lain. Karena itu di sini HANYA skema bentuk (dipakai
 * nanti oleh N-01), BUKAN skema request/response endpoint.
 *
 * PENYIMPANGAN dari daftar field yang diberikan di instruksi delegasi
 * (yang menyebut `created_at`): tabel `notifications` di PRD §9.3 memakai
 * kolom `sent_at`, BUKAN `created_at` — tidak ada kolom `created_at` di
 * tabel ini. Dipakai `sent_at` di sini karena PRD adalah sumber kebenaran
 * untuk bentuk skema database (CLAUDE.md header dokumen). Perlu dikonfirmasi
 * ke orchestrator/N-01 kalau ternyata field ini disengaja beda nama.
 */
export const notificationSchema = z.object({
  id: uuidSchema,
  kind: notificationKindSchema,
  title: z.string(),
  body: z.string(),
  data: z.record(z.unknown()).nullable(),
  read_at: isoDateTimeSchema.nullable(),
  sent_at: isoDateTimeSchema,
});
export type Notification = z.infer<typeof notificationSchema>;
