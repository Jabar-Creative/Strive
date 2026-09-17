import { z } from 'zod';
import { cursorPaginatedSchema, isoDateTimeSchema, uuidSchema } from '../common';

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
 * REKONSILIASI dengan N-01 (dikerjakan paralel, worktree lain, sama-sama
 * bercabang dari commit `origin/main` yang sama sebelum salah satu selesai):
 * N-01 menambahkan endpoint `GET /notifications` + `PATCH .../read` ke
 * docs/PRD.md §10.3 (gap yang tadinya belum ada) dan sempat mendefinisikan
 * skema query/response-nya sendiri langsung di `notification/index.ts`.
 * Orchestrator memindahkan skema endpoint itu ke sini (memakai
 * `cursorPaginatedSchema`/`uuidSchema`/`isoDateTimeSchema` yang sudah
 * konsisten dipakai 15 domain lain di paket ini) supaya HANYA ada satu
 * definisi kanonik, bukan dua yang harus dijaga tetap sinkron secara manual.
 * `notificationSchema` di bawah SEMANTIKNYA identik dengan versi N-01
 * (dikonfirmasi: field sama persis), cuma beda gaya penulisan primitif.
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

/** GET /notifications?cursor=&limit= — docs/PRD.md §10.3 "Notifikasi" (ditambahkan N-01). */
export const listNotificationsQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;

export const listNotificationsResponseSchema = cursorPaginatedSchema(notificationSchema);
export type ListNotificationsResponse = z.infer<typeof listNotificationsResponseSchema>;

/** PATCH /notifications/:id/read — docs/PRD.md §10.3 "Notifikasi" (ditambahkan N-01). */
export const markNotificationReadResponseSchema = z.object({
  id: uuidSchema,
  read_at: isoDateTimeSchema,
});
export type MarkNotificationReadResponse = z.infer<typeof markNotificationReadResponseSchema>;
