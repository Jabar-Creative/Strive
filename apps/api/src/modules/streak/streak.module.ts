import { Module } from '@nestjs/common';

import { StreakService } from './streak.service';

/**
 * E3 · Career Streak — docs/PRD.md §7 E3
 *
 * "Hari ini" SELALU zona waktu pengguna, dihitung di Postgres:
 *   (now() AT TIME ZONE users.timezone)::date
 * JANGAN PERNAH ::date atas timestamptz UTC (CLAUDE.md aturan 5).
 *
 * Diekspor supaya transaksi POST /attempts (L-03) bisa memanggilnya di dalam
 * transaksinya sendiri.
 */
@Module({
  providers: [StreakService],
  exports: [StreakService],
})
export class StreakModule {}
