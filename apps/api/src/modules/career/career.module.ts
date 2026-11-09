import { Module } from '@nestjs/common';

import { AiModule, PENYELESAI_JOB_AI } from '../ai';
import { PaymentModule } from '../payment';
import { WalletModule } from '../wallet';
import { KyselyModule } from '../../infra/kysely';
import { StorageModule } from '../../infra/storage';
import { CareerController } from './career.controller';
import { CareerReadService } from './career-read.service';
import { CvBuilderService } from './cv-builder.service';
import { CvFinalizeService } from './cv-finalize.service';
import { PromptLabService } from './prompt-lab.service';

/**
 * E8 · ATS CV + E13 · Prompt Lab — docs/PRD.md §7 E8, E13
 *
 * `F-14` memasang sisi BACA-nya: `GET /career/cv/:id` dan
 * `GET /career/prompt-lab/history`. Sisi TULIS Prompt Lab datang dari PL-01,
 * sisi TULIS CV builder dari AI-07 (`POST /career/cv`,
 * `GET /career/cv/jobs/:id`).
 *
 * PROXY TIPIS ke AI service. Node TIDAK PERNAH memanggil LLM langsung —
 * selalu lewat `ai_jobs` + AI service (CLAUDE.md aturan 8).
 * Skor ATS DETERMINISTIK, tanpa LLM (CV-6).
 *
 * `CvFinalizeService` didaftarkan SEKALIGUS sebagai penyedia token
 * `PENYELESAI_JOB_AI` kind `ats_cv`, dan binding itu WAJIB diekspor:
 * `AiDispatchService` hidup di WorkerModule, jadi tanpa `exports` tokennya
 * tidak pernah terlihat di sana — `@Optional()` dispatcher menjadikannya `[]`
 * dan job berjalan "sukses" tanpa finalisasi, hold koin menggantung diam-diam.
 * Bug persis ini lolos semua test unit dan baru ketahuan saat stack e2e
 * dijalankan sungguhan (verifikasi AI-07, 9 Nov).
 *
 * `useFactory` membungkus instance dalam ARRAY, karena kontrak dispatcher
 * (penyelesai-job-ai.ts) adalah `PenyelesaiJobAi[]` — `useExisting` akan
 * mengikat SATU instance dan `for..of` di dispatcher melempar. Kalau
 * penyedia KEDUA muncul (mis. mastery interview), binding sejenis di modul
 * lain akan MENIMPA satu ini saat keduanya diimpor bersama; saat itu
 * tokennya perlu berevolusi jadi registry pengumpul. Satu penyedia hari ini.
 */
@Module({
  imports: [KyselyModule, StorageModule, WalletModule, PaymentModule, AiModule],
  controllers: [CareerController],
  providers: [
    CareerReadService,
    PromptLabService,
    CvBuilderService,
    CvFinalizeService,
    {
      provide: PENYELESAI_JOB_AI,
      useFactory: (cv: CvFinalizeService) => [cv],
      inject: [CvFinalizeService],
    },
  ],
  exports: [CareerReadService, PENYELESAI_JOB_AI],
})
export class CareerModule {}
