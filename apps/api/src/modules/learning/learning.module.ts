import { Module } from '@nestjs/common';

import { KyselyModule } from '../../infra/kysely';
import { AttemptHistoryService } from './attempt-history.service';
import { AttemptsController } from './attempts.controller';
import { ContentController } from './content.controller';
import { ContentService } from './content.service';
import { GradingService } from './grading.service';

/**
 * E2 · Learning Engine — docs/PRD.md §7 E2
 *
 * `attempts.service.ts` MILIK DEV A SEPENUHNYA (CLAUDE.md §Kepemilikan file).
 * Satu transaksi menulis ENAM hal; memecah kepemilikannya adalah cara tercepat
 * menciptakan bug konsistensi.
 *
 * `GradingService` (L-02) adalah bagian penilaian yang DIPAKAI transaksi itu:
 * dibaca di dalam transaksi pemanggil, tidak pernah membuka sendiri.
 *
 * Serializer WAJIB membuang `correct` dan `why` sebelum respons (LE-3) —
 * dilakukan di ContentService supaya tidak ada jalur yang bisa melewatkannya.
 */
@Module({
  imports: [KyselyModule],
  controllers: [ContentController, AttemptsController],
  providers: [ContentService, AttemptHistoryService, GradingService],
  exports: [ContentService, AttemptHistoryService, GradingService],
})
export class LearningModule {}
