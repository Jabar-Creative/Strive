import { Module } from '@nestjs/common';

import { ContentController } from './content.controller';
import { ContentService } from './content.service';

/**
 * E2 · Learning Engine — docs/PRD.md §7 E2
 *
 * `attempts.service.ts` MILIK DEV A SEPENUHNYA (CLAUDE.md §Kepemilikan file).
 * Satu transaksi menulis ENAM hal; memecah kepemilikannya adalah cara tercepat
 * menciptakan bug konsistensi.
 *
 * Serializer WAJIB membuang `correct` dan `why` sebelum respons (LE-3) —
 * dilakukan di ContentService supaya tidak ada jalur yang bisa melewatkannya.
 */
@Module({
  controllers: [ContentController],
  providers: [ContentService],
  exports: [ContentService],
})
export class LearningModule {}
