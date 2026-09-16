import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from '../common';

/** docs/PRD.md §7 E13 PL-1: prompt disusun dari 5 bagian tetap. */
export const promptLabSectionsSchema = z.object({
  role: z.string().min(1),
  context: z.string().min(1),
  task: z.string().min(1),
  format: z.string().min(1),
  constraints: z.string().min(1),
});
export type PromptLabSections = z.infer<typeof promptLabSectionsSchema>;

/**
 * POST /career/prompt-lab/run — docs/PRD.md §10.3 ("Sinkron, timeout 30 dtk")
 * + PL-2/PL-3 (20 koin dipotong langsung, bukan hold — tidak ada yang bisa
 * gagal setelah respons diterima).
 */
export const promptLabRunRequestSchema = z.object({
  sections: promptLabSectionsSchema,
});
export type PromptLabRunRequest = z.infer<typeof promptLabRunRequestSchema>;

export const promptLabRunResponseSchema = z.object({
  id: uuidSchema,
  output: z.string(),
  balance: z.number().int(),
});
export type PromptLabRunResponse = z.infer<typeof promptLabRunResponseSchema>;

/**
 * GET /career/prompt-lab/history — docs/PRD.md §10.3 ("Riwayat run") TANPA
 * `?cursor=` di path, beda dengan endpoint riwayat lain (mis. /wallet/ledger).
 * Karena itu SENGAJA tidak memakai `cursorPaginatedSchema` di sini — kalau
 * nanti dibuktikan perlu paginasi, ini jadi perubahan kontrak yang disengaja,
 * bukan salah tebak dari awal.
 */
export const promptLabHistoryItemSchema = z.object({
  id: uuidSchema,
  structure: promptLabSectionsSchema,
  output: z.string(),
  self_rating: z.number().int().nullable(),
  created_at: isoDateTimeSchema,
});
export type PromptLabHistoryItem = z.infer<typeof promptLabHistoryItemSchema>;

export const promptLabHistoryResponseSchema = z.array(promptLabHistoryItemSchema);
export type PromptLabHistoryResponse = z.infer<typeof promptLabHistoryResponseSchema>;
