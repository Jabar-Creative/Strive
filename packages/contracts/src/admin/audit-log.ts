import { z } from 'zod';
import { cursorPaginatedSchema, cursorQuerySchema, isoDateTimeSchema, uuidSchema } from '../common';

/**
 * GET /admin/audit-log?cursor= — docs/PRD.md §9.3 tabel `audit_log`
 * (`id bigserial, actor_id, action, subject_type, subject_id, before jsonb,
 * after jsonb, ip inet, created_at`).
 *
 * `id` sebagai string — alasan sama dengan `coinLedgerEntrySchema` (bigserial
 * bisa melewati presisi aman JS number). `ip` SENGAJA tidak diekspos di
 * response publik/Retool-facing kontrak ini — data PII operasional, di luar
 * cakupan yang diminta task (§7 E9 hanya menyebut "Aksi istimewa, webhook,
 * hasil rekonsiliasi", tidak menyebut IP perlu tampil di UI admin).
 */
export const auditLogEntrySchema = z.object({
  id: z.string(),
  actor_id: uuidSchema.nullable(),
  action: z.string(),
  subject_type: z.string().nullable(),
  subject_id: z.string().nullable(),
  before: z.record(z.unknown()).nullable(),
  after: z.record(z.unknown()).nullable(),
  created_at: isoDateTimeSchema,
});
export type AuditLogEntry = z.infer<typeof auditLogEntrySchema>;

export const auditLogQuerySchema = cursorQuerySchema;
export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;

export const auditLogResponseSchema = cursorPaginatedSchema(auditLogEntrySchema);
export type AuditLogResponse = z.infer<typeof auditLogResponseSchema>;
