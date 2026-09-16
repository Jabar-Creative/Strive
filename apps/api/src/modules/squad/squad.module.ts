import { Module } from '@nestjs/common';

import { SquadService } from './squad.service';

/**
 * E5 · Squad — docs/PRD.md §7 E5
 *
 * PK `squad_members` surrogate + partial unique index
 * `(user_id) WHERE left_at IS NULL` — bukan PK (squad_id, user_id), agar
 * pengguna yang keluar bisa bergabung ulang ke squad yang sama.
 *
 * Diekspor supaya job mingguan (workers/) dan transaksi POST /attempts bisa
 * memanggilnya.
 */
@Module({
  providers: [SquadService],
  exports: [SquadService],
})
export class SquadModule {}
