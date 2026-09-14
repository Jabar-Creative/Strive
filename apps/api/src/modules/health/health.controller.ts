import { Controller, Get } from '@nestjs/common';
import type { HealthResponse } from '@strive/contracts';
import { HealthService } from './health.service';

/**
 * Dikecualikan dari prefiks /api/v1 (lihat main.ts) supaya probe orkestrator
 * tidak ikut berubah saat versi API naik.
 */
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  check(): HealthResponse {
    return this.health.check();
  }
}
