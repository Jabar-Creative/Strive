import { z } from 'zod';

/**
 * Skema zod domain `notification` — item N-01 (Dev B).
 *
 * Bentuknya sengaja mengikuti pola `health` (satu-satunya contoh lengkap yang
 * ditinggalkan sesi fondasi): skema zod dulu, tipe TypeScript diturunkan
 * dengan `z.infer`, tidak pernah ditulis dua kali (docs/PRD.md §10.1).
 *
 * F-08 ("packages/contracts: skema zod SELURUH endpoint MVP") masih `todo` di
 * docs/BACKLOG.md — skema di sini HANYA mencakup dua endpoint N-01
 * (`GET /notifications`, `PATCH /notifications/:id/read`), bukan seluruh MVP.
 */

// docs/PRD.md §7 E16 NO-1 — kolom `notifications.kind` bertipe `text` polos di
// database (lihat komentar di db/migrations/001_init.sql), union ini adalah
// batasan sisi aplikasi.
export const NOTIFICATION_KINDS = [
  'streak_warning',
  'league_change',
  'job_done',
  'review_validated',
] as const;

export const notificationKindSchema = z.enum(NOTIFICATION_KINDS);

export type NotificationKind = z.infer<typeof notificationKindSchema>;

export const notificationSchema = z.object({
  id: z.string().uuid(),
  kind: notificationKindSchema,
  title: z.string(),
  body: z.string(),
  data: z.record(z.unknown()).nullable(),
  read_at: z.string().datetime().nullable(),
  // NULL berarti DUA hal berbeda (lihat NotificationsService.EMAIL_ENABLED_KINDS):
  // (1) kind ini memang tidak pernah mengirim email, atau
  // (2) email gagal 3x — kasus ini SELALU disertai baris di `audit_log`.
  sent_at: z.string().datetime().nullable(),
  created_at: z.string().datetime(),
});

export type Notification = z.infer<typeof notificationSchema>;

// docs/PRD.md §10.1 — paginasi cursor: `?cursor=&limit=` → `{ data, next_cursor }`.
export const listNotificationsQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;

export const listNotificationsResponseSchema = z.object({
  data: z.array(notificationSchema),
  next_cursor: z.string().nullable(),
});

export type ListNotificationsResponse = z.infer<typeof listNotificationsResponseSchema>;

export const markNotificationReadResponseSchema = z.object({
  id: z.string().uuid(),
  read_at: z.string().datetime(),
});

export type MarkNotificationReadResponse = z.infer<typeof markNotificationReadResponseSchema>;
