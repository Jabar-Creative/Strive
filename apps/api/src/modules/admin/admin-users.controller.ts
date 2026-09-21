import { Body, Controller, Param, Patch, UseGuards } from '@nestjs/common';

import { CurrentUserId, Roles, RolesGuard, SessionGuard } from '../../common/guards';
import { UserRoleService } from './user-role.service';

/**
 * `PATCH /admin/users/:id/role` — PRD §10.3: **superadmin saja**.
 *
 * `SA-2`: ini SATU-SATUNYA jalur tulis peran. Koneksi Retool memakai role
 * read-only yang tidak bisa menulis apa pun (migrasi 006), jadi sebelum
 * endpoint ini ada, menunjuk mentor pertama hanya mungkin lewat SQL langsung.
 */
@UseGuards(SessionGuard, RolesGuard)
@Roles('superadmin')
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly roles: UserRoleService) {}

  @Patch(':id/role')
  async changeRole(
    @CurrentUserId() actorId: string,
    @Param('id') targetUserId: string,
    @Body() body: { role?: unknown },
  ) {
    // `actorId` datang dari GUARD, tidak pernah dari body — pelaku yang bisa
    // dikirim klien adalah pelaku yang bisa dipalsukan, dan seluruh guna audit
    // ini bergantung pada satu field itu. Ia juga yang dipakai menolak
    // perubahan atas diri sendiri; dari body, larangan itu tinggal dilewati
    // dengan mengirim id orang lain.
    return this.roles.changeRole({ targetUserId, role: body?.role, actorId });
  }
}
