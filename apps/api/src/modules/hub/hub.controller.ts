import { Controller, Get, UseGuards } from '@nestjs/common';

import { CurrentUserId, Roles, RolesGuard, SessionGuard } from '../../common/guards';
import { HubService } from './hub.service';
import type { HubResponse } from './hub.types';

/**
 * PRD §2.4: `GET /hub` → student & mentor. Superadmin DITOLAK.
 */
@UseGuards(SessionGuard, RolesGuard)
@Roles('student', 'mentor')
@Controller('hub')
export class HubController {
  constructor(private readonly hub: HubService) {}

  @Get()
  async get(@CurrentUserId() userId: string): Promise<HubResponse> {
    return this.hub.forUser(userId);
  }
}
