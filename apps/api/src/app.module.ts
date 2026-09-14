import { Module } from '@nestjs/common';

import { KyselyModule } from './infra/kysely';
import { RedisModule } from './infra/redis';
import { BullmqModule } from './infra/bullmq';
import { StorageModule } from './infra/storage';

import { AuthModule } from './modules/auth';
import { UsersModule } from './modules/users';
import { LearningModule } from './modules/learning';
import { StreakModule } from './modules/streak';
import { SquadModule } from './modules/squad';
import { LeagueModule } from './modules/league';
import { WalletModule } from './modules/wallet';
import { PaymentModule } from './modules/payment';
import { StoreModule } from './modules/store';
import { ScanModule } from './modules/scan';
import { CareerModule } from './modules/career';
import { MasteryModule } from './modules/mastery';
import { MentorModule } from './modules/mentor';
import { AdminModule } from './modules/admin';
import { NotificationModule } from './modules/notification';
import { HealthModule } from './modules/health';

/**
 * Seluruh modul di CLAUDE.md "Struktur repo" sudah terdaftar sejak awal, meski
 * sebagian besar masih kosong. Daftar yang lengkap membuat batas modul terlihat
 * di satu tempat — dan batas itulah yang menggantikan pemecahan jadi
 * microservice (docs/PRD.md §8.2).
 */
@Module({
  imports: [
    // Infrastruktur
    KyselyModule,
    RedisModule,
    BullmqModule,
    StorageModule,

    // Domain
    AuthModule,
    UsersModule,
    LearningModule,
    StreakModule,
    SquadModule,
    LeagueModule,
    WalletModule,
    PaymentModule,
    StoreModule,
    ScanModule,
    CareerModule,
    MasteryModule,
    MentorModule,
    AdminModule,
    NotificationModule,
    HealthModule,
  ],
})
export class AppModule {}
