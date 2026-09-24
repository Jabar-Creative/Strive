import { Module } from '@nestjs/common';

import { KyselyModule } from '../infra/kysely';
import { SquadModule } from '../modules/squad';
import { RealtimeEmitter } from './realtime.emitter';
import { SquadGateway } from './squad.gateway';

/**
 * Gateway WebSocket — hanya untuk `MODE=api`.
 *
 * Worker tidak mengimpor modul ini: ia hanya butuh `RealtimeEmitter`, yang
 * disediakan `RealtimeEmitterModule`. Gateway di proses tanpa HTTP tidak
 * mendengarkan apa pun, tapi tetap menarik `SquadModule` dan seluruh
 * dependensinya — beban tanpa guna, dan kelas kesalahan wiring yang sama
 * dengan isu #86.
 */
@Module({
  imports: [KyselyModule, SquadModule],
  providers: [SquadGateway],
})
export class RealtimeModule {}

/** Pengirim event dari proses mana pun — dipakai worker outbox (RT-4). */
@Module({
  providers: [RealtimeEmitter],
  exports: [RealtimeEmitter],
})
export class RealtimeEmitterModule {}
