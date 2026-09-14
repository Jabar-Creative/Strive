import { Module } from '@nestjs/common';

/**
 * Antrean BullMQ: outbox · scan · ai · notify.
 * `queue.add()` TIDAK PERNAH di dalam db.transaction() — enqueue setelah commit
 * (docs/PRD.md §8.3 aturan 5).
 *
 * KERANGKA — provider menyusul di item Q-03 (docs/BACKLOG.md).
 */
@Module({})
export class BullmqModule {}
