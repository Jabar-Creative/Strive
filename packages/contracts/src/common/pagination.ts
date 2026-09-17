import { z } from 'zod';

/**
 * Wrapper generik untuk respons cursor-paginated — docs/PRD.md §10.1
 * ("Cursor, bukan offset ... `{ data, next_cursor }`"). Dipakai berulang di
 * banyak domain (wallet/ledger, learning/attempts, scan, mastery/sessions,
 * admin/transactions, admin/audit-log), jadi dibuat SATU factory di sini
 * alih-alih meng-copy-paste bentuk yang sama di tiap domain (DRY — bentuknya
 * memang identik di semua endpoint, bukan kemiripan kebetulan yang nanti
 * bisa berubah beda arah per domain).
 *
 * `next_cursor` bertipe `string | null`: `null` berarti tidak ada halaman
 * berikutnya.
 */
export function cursorPaginatedSchema<ItemSchema extends z.ZodTypeAny>(itemSchema: ItemSchema) {
  return z.object({
    data: z.array(itemSchema),
    next_cursor: z.string().nullable(),
  });
}

/**
 * Skema query string generik untuk endpoint `GET ...?cursor=&limit=`.
 * Endpoint yang butuh filter tambahan (mis. `/admin/transactions`) meng-extend
 * ini, bukan menulis ulang `cursor`/`limit`.
 */
export const cursorQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});
export type CursorQuery = z.infer<typeof cursorQuerySchema>;
