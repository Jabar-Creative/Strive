import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from '../common';
import { leagueTierSchema } from './tier';

/**
 * Hasil penutupan musim per squad — docs/PRD.md §7 E5 SQ-8 ("20% teratas
 * promosi, 20% terbawah degradasi. Gold tidak bisa promosi, Bronze tidak
 * bisa degradasi"). ASUMSI nilai enum (PRD tidak menuliskan nama kolomnya
 * secara literal, hanya perilakunya) — `league_standings.outcome` bertipe
 * `text` polos di §9.3, jadi ini kontrak yang perlu disepakati dengan Dev A.
 */
export const leagueOutcomeSchema = z.enum(['promoted', 'demoted', 'stayed']);
export type LeagueOutcome = z.infer<typeof leagueOutcomeSchema>;

export const leagueStandingEntrySchema = z.object({
  squad_id: uuidSchema,
  squad_name: z.string(),
  points: z.number().int(),
  rank: z.number().int(),
  /** `null` selagi musim masih berjalan — outcome hanya terisi setelah ditutup. */
  outcome: leagueOutcomeSchema.nullable(),
});
export type LeagueStandingEntry = z.infer<typeof leagueStandingEntrySchema>;

/** GET /leagues/:season/:tier — docs/PRD.md §10.3 ("Klasemen squad dalam satu tier"). */
export const leagueStandingsResponseSchema = z.object({
  /** `league_seasons.code`, format `YYYY-Www` (mis. `2026-W37`) — §9.3. */
  season_code: z.string(),
  tier: leagueTierSchema,
  closed_at: isoDateTimeSchema.nullable(),
  standings: z.array(leagueStandingEntrySchema),
});
export type LeagueStandingsResponse = z.infer<typeof leagueStandingsResponseSchema>;
