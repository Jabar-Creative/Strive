import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { CurrentUserId, Roles, RolesGuard, SessionGuard } from '../../common/guards';
import type { HistoryPage } from '../../common/cursor';
import { type CvResult, CareerReadService, type PromptRunItem } from './career-read.service';
import { PromptLabService, type PromptRunSections } from './prompt-lab.service';

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
  constructor(
    private readonly karir: CareerReadService,
    private readonly promptLab: PromptLabService,
  ) {}

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

  /**
   * `POST /career/prompt-lab/run` (⚡) — PL-01. Sinkron dengan batas 30 dtk
   * (PL-2); uangnya hold→settle|release (keputusan #245). `Idempotency-Key`
   * WAJIB dan ditolak di controller — seperti checkout #243, menolaknya di
   * sini memberi galat yang menunjuk ke penyebabnya, bukan 500 dari unique
   * index di dalam transaksi.
   */
  @Post('prompt-lab/run')
  async runPrompt(
    @CurrentUserId() userId: string,
    @Headers('idempotency-key') idempotencyKey?: string,
    @Body() body?: { sections?: unknown },
  ): Promise<{ id: string; output: string; balance: number }> {
    if (!idempotencyKey || idempotencyKey.length === 0) {
      throw new BadRequestException({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Header Idempotency-Key wajib untuk run prompt lab',
          details: { header: 'idempotency-key' },
        },
      });
    }
    return this.promptLab.run(userId, (body?.sections ?? {}) as PromptRunSections, idempotencyKey);
  }
}
