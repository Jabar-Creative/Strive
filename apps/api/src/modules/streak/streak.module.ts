import { Module } from '@nestjs/common';

/**
 * E3 · Career Streak — docs/PRD.md §7 E3
 *
 * KERANGKA KOSONG. Controller & service menyusul di item: S-01, S-02, S-04.
 *
 * "Hari ini" SELALU zona waktu pengguna, dihitung di Postgres:
 *   (now() AT TIME ZONE users.timezone)::date
 * JANGAN PERNAH ::date atas timestamptz UTC (CLAUDE.md aturan 5).
 */
@Module({})
export class StreakModule {}
