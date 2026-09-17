import { z } from 'zod';

/** docs/PRD.md §9.2 ENUM `league_tier`. Dipakai juga oleh domain `squad`/`mentor`. */
export const leagueTierSchema = z.enum(['bronze', 'silver', 'gold']);
export type LeagueTier = z.infer<typeof leagueTierSchema>;
