import { Module } from '@nestjs/common';

/**
 * E5 · Liga & musim — docs/PRD.md §7 E5
 *
 * KERANGKA KOSONG. Controller & service menyusul di item: Q-02, Q-04.
 *
 * Kunci ZSET DIROTASI per musim (lb:sq:{season}:{squad_id}), bukan di-reset.
 * Rollup penutupan musim wajib IDEMPOTEN (SQ-9).
 */
@Module({})
export class LeagueModule {}
