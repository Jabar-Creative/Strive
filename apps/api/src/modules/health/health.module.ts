import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { ReadinessService } from './readiness.service';

@Module({
  controllers: [HealthController],
  providers: [HealthService, ReadinessService],
  exports: [HealthService, ReadinessService],
})
export class HealthModule {}
