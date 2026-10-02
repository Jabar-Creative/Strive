import { z } from 'zod';

import { localDateSchema } from '../common';

/**
 * GET /hub — PRD §10.3: "satu panggilan untuk seluruh layar Hub".
 *
 * Skema ini menutup utang F-08 yang dicatat `hub.types.ts` di apps/api dan
 * isu #52: endpoint ini endpoint yang PALING sering dipanggil di produk,
 * tetapi selama ini tidak punya definisi kontrak. Bentuknya disalin dari
 * respons nyata S-02 (kode sumber kebenaran — tipe lokal di apps/api
 * diturunkan dari SQL yang sama) supaya penambahan ini bukan breaking.
 *
 * `streak.at_risk_today` dan `quest.date` dihitung SERVER dalam zona waktu
 * PENGGUNA (aturan keras 5) — client tidak pernah menurunkannya sendiri
 * dari jam prosesnya.
 */
export const hubQuestSchema = z.object({
  /** Tanggal LOKAL pengguna, `YYYY-MM-DD`. */
  date: localDateSchema,
  target_tasks: z.number().int(),
  done_tasks: z.number().int(),
  completed: z.boolean(),
});
export type HubQuest = z.infer<typeof hubQuestSchema>;

export const hubSquadSchema = z.object({
  squad_id: z.string().uuid(),
  name: z.string(),
  /** Peringkat pengguna di DALAM squad-nya, 1 = teratas. */
  rank: z.number().int(),
  members: z.number().int(),
  weekly_points: z.number().int(),
});
export type HubSquad = z.infer<typeof hubSquadSchema>;

export const hubNextCardSchema = z.object({
  lesson_id: z.string().uuid(),
  lesson_title: z.string(),
  track_title: z.string(),
});
export type HubNextCard = z.infer<typeof hubNextCardSchema>;

export const hubResponseSchema = z.object({
  streak: z.object({
    current_streak: z.number().int(),
    longest_streak: z.number().int(),
    freeze_credits: z.number().int(),
    last_activity_date: localDateSchema.nullable(),
    /** `true` kalau pengguna belum aktif di hari lokalnya sendiri. */
    at_risk_today: z.boolean(),
  }),
  quest: hubQuestSchema,
  squad: hubSquadSchema.nullable(),
  balance: z.number().int(),
  next_cards: z.array(hubNextCardSchema),
});
export type HubResponse = z.infer<typeof hubResponseSchema>;
