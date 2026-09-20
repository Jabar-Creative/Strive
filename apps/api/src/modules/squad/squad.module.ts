import { Module } from '@nestjs/common';

import { LeagueModule } from '../league';

import { SquadController } from './squad.controller';
import { SquadReadService } from './squad-read.service';
import { SquadService } from './squad.service';

/**
 * E5 · Squad — docs/PRD.md §7 E5
 *
 * PK `squad_members` surrogate + partial unique index
 * `(user_id) WHERE left_at IS NULL` — bukan PK (squad_id, user_id), agar
 * pengguna yang keluar bisa bergabung ulang ke squad yang sama.
 *
 * `SquadService` diekspor supaya job mingguan (workers/) dan transaksi
 * POST /attempts bisa memanggilnya.
 *
 * `Q-06` menambahkan permukaan HTTP-nya: `GET /squads/me` dan
 * `GET /squads/:id/leaderboard`. Keduanya tercantum di PRD §10.3 dan di
 * `ACCESS_MATRIX` sejak awal, tapi tidak ada item yang membangunnya sampai
 * isu #79 — `Q-02` membuat `LeaderboardService` dan AC-nya memang tidak
 * pernah menyebut HTTP.
 *
 * `LeagueModule` diimpor untuk `LeaderboardService`: papan dilayani dari ZSET
 * Redis (PRD §10.3), bukan dihitung ulang dari Postgres tiap request.
 */
@Module({
  imports: [LeagueModule],
  controllers: [SquadController],
  providers: [SquadService, SquadReadService],
  exports: [SquadService, SquadReadService],
})
export class SquadModule {}
