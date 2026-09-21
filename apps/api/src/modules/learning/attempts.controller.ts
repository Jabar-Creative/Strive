import { Controller, Get, Query, UseGuards } from '@nestjs/common';

import { CurrentUserId, Roles, RolesGuard, SessionGuard } from '../../common/guards';
import { type AttemptHistoryItem, AttemptHistoryService } from './attempt-history.service';
import type { HistoryPage } from '../../common/cursor';

/**
 * `GET /attempts` — PRD §10.3, item `F-14`.
 *
 * Superadmin DITOLAK: riwayat belajar orang bukan urusan panel admin. Untuk
 * audit ada view `admin_*` yang dibaca Retool lewat role read-only (`SA-01`).
 *
 * `POST /attempts` TIDAK ada di sini — itu `L-03`, dan `CLAUDE.md` menandainya
 * milik satu pemilik (`attempts.service.ts`). Satu transaksi, satu pemilik.
 */
@UseGuards(SessionGuard, RolesGuard)
@Roles('student', 'mentor')
@Controller('attempts')
export class AttemptsController {
  constructor(private readonly riwayat: AttemptHistoryService) {}

  @Get()
  async history(
    @CurrentUserId() userId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ): Promise<HistoryPage<AttemptHistoryItem>> {
    // `userId` dari GUARD, tidak pernah dari query — itu satu-satunya batas
    // antara "riwayat saya" dan riwayat orang lain.
    return this.riwayat.historyFor(userId, { cursor, limit });
  }
}
