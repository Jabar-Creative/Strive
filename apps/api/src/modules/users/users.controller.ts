import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';

import { CurrentUserId, Roles, RolesGuard, SessionGuard } from '../../common/guards';
import { ProfileService, type PatchProfileInput } from './profile.service';

/**
 * `GET /me` + `PATCH /me` — `A-05` (isu #88), PRD §10.3: **semua peran**.
 *
 * Tidak ada `:id` di rute ini, dan itu disengaja. "Profil siapa" dijawab
 * SESI, bukan parameter — rute `/users/:id` yang mengembalikan profil sendiri
 * kalau id-nya cocok adalah rute yang menunggu seseorang lupa memeriksanya.
 */
@UseGuards(SessionGuard, RolesGuard)
@Roles('student', 'mentor', 'superadmin')
@Controller('me')
export class UsersController {
  constructor(private readonly profil: ProfileService) {}

  @Get()
  async me(@CurrentUserId() userId: string) {
    return this.profil.me(userId);
  }

  @Patch()
  async update(@CurrentUserId() userId: string, @Body() body: PatchProfileInput) {
    return this.profil.updateMe(userId, body ?? {});
  }
}
