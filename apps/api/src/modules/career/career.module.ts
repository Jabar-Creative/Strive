import { Module } from '@nestjs/common';

import { KyselyModule } from '../../infra/kysely';
import { StorageModule } from '../../infra/storage';
import { CareerController } from './career.controller';
import { CareerReadService } from './career-read.service';

/**
 * E8 · ATS CV + E13 · Prompt Lab — docs/PRD.md §7 E8, E13
 *
 * `F-14` memasang sisi BACA-nya: `GET /career/cv/:id` dan
 * `GET /career/prompt-lab/history`. Sisi TULIS (`POST /career/cv`,
 * `POST /career/prompt-lab/run`) menyusul di `AI-06`.
 *
 * PROXY TIPIS ke AI service. Node TIDAK PERNAH memanggil LLM langsung —
 * selalu lewat `ai_jobs` + AI service (CLAUDE.md aturan 8).
 * Skor ATS DETERMINISTIK, tanpa LLM (CV-6).
 */
@Module({
  imports: [KyselyModule, StorageModule],
  controllers: [CareerController],
  providers: [CareerReadService],
  exports: [CareerReadService],
})
export class CareerModule {}
