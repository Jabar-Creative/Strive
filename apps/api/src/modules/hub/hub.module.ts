import { Module } from '@nestjs/common';

import { HubController } from './hub.controller';
import { HubService } from './hub.service';

/**
 * `GET /hub` — satu panggilan untuk seluruh layar Hub (PRD §10.3).
 *
 * Modulnya sendiri sengaja tipis: ia TIDAK memiliki data apa pun, hanya
 * membaca milik streak, quest, squad, wallet, dan learning. Menaruhnya di
 * salah satu modul itu akan membuat modul tersebut tahu tentang empat yang
 * lain — dan aturan lint batas antarmodul memang melarangnya.
 */
@Module({
  controllers: [HubController],
  providers: [HubService],
  exports: [HubService],
})
export class HubModule {}
