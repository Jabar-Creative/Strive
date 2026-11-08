import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { CurrentUserId, Roles, RolesGuard, SessionGuard } from '../../common/guards';
import type { HistoryPage } from '../../common/cursor';
import { type CvGenerateInput, CvBuilderService } from './cv-builder.service';
import {
  type CvJobResult,
  type CvResult,
  CareerReadService,
  type PromptRunItem,
} from './career-read.service';
import { PromptLabService, type PromptRunSections } from './prompt-lab.service';

/**
 * `GET /career/cv/:id` + `GET /career/prompt-lab/history` — PRD §10.3, `F-14`.
 * `POST /career/cv` + `GET /career/cv/jobs/:id` — AI-07. LLM tetap TIDAK
 * PERNAH dipanggil dari sini (aturan 8): pekerjaan hidup sebagai baris
 * `ai_jobs` yang dikerjakan dispatcher.
 */
@UseGuards(SessionGuard, RolesGuard)
@Roles('student', 'mentor')
@Controller('career')
export class CareerController {
  constructor(
    private readonly karir: CareerReadService,
    private readonly builder: CvBuilderService,
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

  /**
   * `cv/jobs/:id` SEBELUM `cv/:id` — alasan sama dengan
   * `prompt-lab/history` di atas: `cv/:id` satu segmen tidak menelan tiga
   * segmen `cv/jobs/:id`, tapi urutan ini tetap benar kalau suatu hari
   * ada `cv/jobs` tanpa parameter.
   */
  @Get('cv/jobs/:id')
  async cvJobStatus(
    @CurrentUserId() userId: string,
    @Param('id') jobId: string,
  ): Promise<CvJobResult> {
    return this.karir.jobStatus(userId, jobId);
  }

  @Get('cv/:id')
  async cvById(@CurrentUserId() userId: string, @Param('id') cvId: string): Promise<CvResult> {
    return this.karir.cvById(userId, cvId);
  }

  /**
   * `POST /career/cv` (⚡, AI-07) — `202 {job_id}` (PRD §13.2 tahap 1).
   * Asinkron: ekstraksi + LLM + render PDF tidak boleh menahan koneksi HTTP,
   * jadi respons hanya id job yang dipoll UI lewat `cv/jobs/:id`.
   * `Idempotency-Key` WAJIB, ditolak di controller — pola `prompt-lab/run`
   * dan checkout #243: galat yang menunjuk penyebab, bukan 500 dari
   * unique index di dalam transaksi.
   */
  @Post('cv')
  @HttpCode(202)
  async generateCv(
    @CurrentUserId() userId: string,
    @Headers('idempotency-key') idempotencyKey?: string,
    @Body()
    body?: {
      target_role?: unknown;
      language?: unknown;
      source?: unknown;
      profile?: unknown;
      document_base64?: unknown;
    },
  ): Promise<{ job_id: string }> {
    if (!idempotencyKey || idempotencyKey.length === 0) {
      throw new BadRequestException({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Header Idempotency-Key wajib untuk generate CV',
          details: { header: 'idempotency-key' },
        },
      });
    }
    const jobId = await this.builder.buat(userId, body as CvGenerateInput, idempotencyKey);
    return { job_id: jobId };
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
