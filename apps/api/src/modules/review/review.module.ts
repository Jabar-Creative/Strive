import { Module } from '@nestjs/common';

import { ReviewHistoryService } from './review-history.service';
import { ReviewController } from './review.controller';
import { ReviewService } from './review.service';

/**
 * E11 · Peer Review — PRD §7 E11.
 *
 * PR-2 ("identitas penulis disembunyikan") ditegakkan oleh BENTUK DATA:
 * `ReviewQueueItem` tidak punya `author_id`. Tidak ada tempat untuk lupa
 * membuangnya, karena ia tidak pernah ada di sana.
 */
@Module({
  controllers: [ReviewController],
  providers: [ReviewService, ReviewHistoryService],
  exports: [ReviewService, ReviewHistoryService],
})
export class ReviewModule {}
