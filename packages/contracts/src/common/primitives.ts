import { z } from 'zod';

/**
 * UUID — dipakai untuk seluruh primary key / foreign key di response API.
 * `users.id`, `lessons.id`, dst semuanya `uuid PK` (docs/PRD.md §9.3).
 */
export const uuidSchema = z.string().uuid();

/**
 * Timestamp ISO 8601 DENGAN offset — docs/PRD.md §10.1 ("Tanggal selalu ISO
 * 8601 dengan offset"). `{ offset: true }` tetap menerima sufiks `Z` (offset
 * nol), jadi kompatibel dengan `timestamptz` yang di-serialize sebagai UTC.
 */
export const isoDateTimeSchema = z.string().datetime({ offset: true });

/**
 * Tanggal LOKAL pengguna (`YYYY-MM-DD`), dikirim terpisah dari timestamp UTC.
 * CLAUDE.md aturan #5: "hari ini" selalu dihitung di zona waktu pengguna,
 * bukan `::date` dari timestamptz. Field seperti `attempt_date` dan
 * `last_activity_date` memakai skema ini, bukan `isoDateTimeSchema`.
 */
export const localDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal lokal harus YYYY-MM-DD');

/**
 * Uang dan koin SELALU integer, tidak pernah float — CLAUDE.md konvensi umum.
 * Dipakai untuk field koin (mis. `coins`, `balance`) maupun rupiah
 * (mis. `amount_idr`) — keduanya bilangan bulat di skema database.
 */
export const coinAmountSchema = z.number().int();
