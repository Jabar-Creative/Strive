import { Module } from '@nestjs/common';

import { MasteryService } from './mastery.service';

/**
 * E12 · Mastery Track — PRD §7 E12.
 *
 * Node TIDAK memanggil LLM langsung (aturan 8). Umpan balik AI datang lewat
 * `ai_jobs` + AI service, dan itu item `MT-02`.
 */
@Module({
  providers: [MasteryService],
  exports: [MasteryService],
})
export class MasteryModule {}
