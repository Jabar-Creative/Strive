import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from '../common';
// Import (bukan re-export) — leagueTierSchema tetap satu-satunya sumber
// definisi di domain `league`, dipakai di sini hanya sebagai tipe field.
import { leagueTierSchema } from '../league';

export const squadMemberSchema = z.object({
  user_id: uuidSchema,
  display_name: z.string(),
  avatar_url: z.string().url().nullable(),
  weekly_points: z.number().int(),
  joined_at: isoDateTimeSchema,
});
export type SquadMember = z.infer<typeof squadMemberSchema>;

/** GET /squads/me — docs/PRD.md §10.3 ("Squad, anggota, poin mingguan, tier"). */
export const squadMeResponseSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  league_tier: leagueTierSchema,
  mentor_id: uuidSchema.nullable(),
  season_id: uuidSchema,
  members: z.array(squadMemberSchema),
});
export type SquadMeResponse = z.infer<typeof squadMeResponseSchema>;

export const leaderboardEntrySchema = z.object({
  rank: z.number().int(),
  user_id: uuidSchema,
  display_name: z.string(),
  weekly_points: z.number().int(),
});
export type LeaderboardEntry = z.infer<typeof leaderboardEntrySchema>;

/**
 * GET /squads/:id/leaderboard — docs/PRD.md §10.3 ("Dari ZSET Redis").
 * `Cache-Control: max-age=30` adalah header HTTP, bukan bagian body — tidak
 * dimodelkan di skema zod.
 */
export const squadLeaderboardResponseSchema = z.object({
  squad_id: uuidSchema,
  season_id: uuidSchema,
  entries: z.array(leaderboardEntrySchema),
});
export type SquadLeaderboardResponse = z.infer<typeof squadLeaderboardResponseSchema>;
