import { Module } from '@nestjs/common';

import { KyselyModule } from '../../infra/kysely';
import { AiJobsService } from './ai-jobs.service';
import { AI_SERVICE_CLIENT, HttpAiServiceClient } from './ai-service.client';

/**
 * E8/E12/E13 berbagi satu jalur AI — `AI-06`.
 *
 * `career/` dan `mastery/` adalah proxy tipis (CLAUDE.md §Struktur repo); yang
 * mereka proxy-kan ada di sini. Dipisah karena `ai_jobs` dan pencatatan
 * biayanya milik ketiganya, dan menaruhnya di salah satu modul berarti dua
 * modul lain mengimpor tetangganya untuk sesuatu yang bukan miliknya.
 */
@Module({
  imports: [KyselyModule],
  providers: [AiJobsService, { provide: AI_SERVICE_CLIENT, useClass: HttpAiServiceClient }],
  exports: [AiJobsService, AI_SERVICE_CLIENT],
})
export class AiModule {}
