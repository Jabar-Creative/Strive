import { Controller, Get, UseGuards } from '@nestjs/common';

import { Roles, RolesGuard, SessionGuard } from '../../common/guards';
import { IntegrationsHealthService, type IntegrationsHealth } from './integrations-health.service';

/**
 * `GET /admin/integrations/health` — PRD §10.3: **superadmin saja**, `SA-6`.
 *
 * Read-only dan tanpa efek samping: ia hanya membaca tabel kita sendiri, dan
 * TIDAK menembak vendor mana pun (alasannya di `IntegrationsHealthService`).
 * Itu yang membuatnya aman dipanggil sesering apa pun oleh dasbor.
 */
@UseGuards(SessionGuard, RolesGuard)
@Roles('superadmin')
@Controller('admin/integrations')
export class AdminIntegrationsController {
  constructor(private readonly health: IntegrationsHealthService) {}

  @Get('health')
  async get(): Promise<IntegrationsHealth> {
    return this.health.get();
  }
}
