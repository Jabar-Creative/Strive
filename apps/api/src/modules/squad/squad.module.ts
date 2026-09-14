import { Module } from '@nestjs/common';

/**
 * E5 · Squad — docs/PRD.md §7 E5
 *
 * KERANGKA KOSONG. Controller & service menyusul di item: Q-01, Q-02.
 *
 * PK `squad_members` surrogate + partial unique index `user_id WHERE left_at
 * IS NULL` — bukan PK (squad_id, user_id), agar pengguna bisa bergabung ulang.
 */
@Module({})
export class SquadModule {}
