import { z } from 'zod';
import { localDateSchema } from '../common';

/**
 * Status UI streak — docs/PRD.md §7 E3 aturan SK-9/SK-10.
 * SK-10: `broken` TIDAK PERNAH memakai warna merah di UI — itu keputusan
 * desain (packages/ui), tapi dicatat di sini karena nilai enum-nya sendiri
 * adalah bagian dari kontrak.
 */
export const streakStatusSchema = z.enum(['active', 'at_risk', 'frozen', 'broken']);
export type StreakStatus = z.infer<typeof streakStatusSchema>;

/** GET /streak — docs/PRD.md §10.3 ("Status, sisa jam hari ini (lokal), kredit freeze"). */
export const streakResponseSchema = z.object({
  status: streakStatusSchema,
  current_streak: z.number().int(),
  longest_streak: z.number().int(),
  freeze_credits: z.number().int(),
  /** Sisa jam sebelum tengah malam LOKAL pengguna — dihitung di server. */
  hours_remaining_today: z.number().int(),
  last_activity_date: localDateSchema.nullable(),
});
export type StreakResponse = z.infer<typeof streakResponseSchema>;

/**
 * POST /streak/freeze — docs/PRD.md §7 E3 SK-6/AC-SK-4. Tidak ada request
 * body: aksi selalu terhadap hari berjalan milik pengguna yang login.
 */
export const useFreezeResponseSchema = z.object({
  freeze_credits: z.number().int(),
  last_activity_date: localDateSchema,
  current_streak: z.number().int(),
});
export type UseFreezeResponse = z.infer<typeof useFreezeResponseSchema>;

/**
 * POST /streak/freeze/purchase — docs/PRD.md §10.3 ("Beli 1 kredit seharga
 * 200 koin, maks 1×/bulan"). Tidak ada request body: harga & batas bulanan
 * ditentukan server dari `pricing_config` + `streaks.freeze_purchased_month`.
 */
export const purchaseFreezeResponseSchema = z.object({
  freeze_credits: z.number().int(),
  balance: z.number().int(),
});
export type PurchaseFreezeResponse = z.infer<typeof purchaseFreezeResponseSchema>;
