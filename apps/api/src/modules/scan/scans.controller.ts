import { Controller, Get, Query, UseGuards } from '@nestjs/common';

import { CurrentUserId, Roles, RolesGuard, SessionGuard } from '../../common/guards';
import type { HistoryPage } from '../../common/cursor';
import { type ScanHistoryItem, ScanHistoryService } from './scan-history.service';

/**
 * `GET /scans` — PRD §10.3, item `F-14`.
 *
 * `POST /scans` dan `GET /scans/:id` sudah tercatat di `ACCESS_MATRIX` sejak
 * `A-02` tapi **belum punya controller**: `K-02` membangun `ScanService` dan
 * webhook-nya, bukan rute pengunggahannya. Keduanya bukan milik item ini.
 */
@UseGuards(SessionGuard, RolesGuard)
@Roles('student', 'mentor')
@Controller('scans')
export class ScansController {
  constructor(private readonly riwayat: ScanHistoryService) {}

  @Get()
  async history(
    @CurrentUserId() userId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ): Promise<HistoryPage<ScanHistoryItem>> {
    return this.riwayat.historyFor(userId, { cursor, limit });
  }
}
