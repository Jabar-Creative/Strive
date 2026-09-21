import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';

import { CurrentUserId, Roles, RolesGuard, SessionGuard } from '../../common/guards';
import type { HistoryPage } from '../../common/cursor';
import { type CvResult, CareerReadService, type PromptRunItem } from './career-read.service';

/**
 * `GET /career/cv/:id` + `GET /career/prompt-lab/history` — PRD §10.3, `F-14`.
 *
 * Hanya BACA. `POST /career/cv` dan `POST /career/prompt-lab/run` membuat
 * `ai_jobs` dan itu item `AI-06` — aturan 8: Node tidak pernah memanggil LLM
 * langsung.
 */
@UseGuards(SessionGuard, RolesGuard)
@Roles('student', 'mentor')
@Controller('career')
export class CareerController {
  constructor(private readonly karir: CareerReadService) {}

  /**
   * `prompt-lab/history` didaftarkan SEBELUM `cv/:id` supaya tidak ada
   * kemungkinan rute parameter menelannya. Keduanya berbeda segmen pertama,
   * jadi sebenarnya aman — tapi urutan ini yang tetap benar kalau nanti ada
   * `cv/history`.
   */
  @Get('prompt-lab/history')
  async promptHistory(
    @CurrentUserId() userId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ): Promise<HistoryPage<PromptRunItem>> {
    return this.karir.promptHistory(userId, { cursor, limit });
  }

  @Get('cv/:id')
  async cvById(@CurrentUserId() userId: string, @Param('id') cvId: string): Promise<CvResult> {
    return this.karir.cvById(userId, cvId);
  }
}
