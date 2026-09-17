import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { ROLES_KEY, type UserRole } from './roles.decorator';
import type { SessionRequest } from './session.guard';

/**
 * Menjawab **"peran ini boleh masuk rute ini?"** — dan tidak lebih.
 *
 * Guard TIDAK menjawab "sumber daya ini milik siapa?" (PRD §2.5). Kepemilikan
 * dicek di service, karena hanya service yang tahu bentuk relasinya: student
 * hanya boleh barisnya sendiri, mentor hanya squad yang ia bimbing. Menaruh
 * pemeriksaan itu di guard berarti guard harus tahu skema setiap modul.
 *
 * Dua sifat yang sengaja dipilih, dan keduanya bisa salah dengan mudah:
 *
 * 1. **Keanggotaan daftar, bukan urutan.** `allow.includes(role)`, tidak pernah
 *    `role >= minimum`. Superadmin bukan mentor tingkat lanjut.
 * 2. **Default TERTUTUP.** Rute tanpa `@Roles()` DITOLAK untuk semua peran,
 *    bukan dibuka. Rute publik harus menyatakan dirinya publik lewat
 *    `@Public()`. Lupa menulis dekorator adalah kesalahan yang berakhir 403,
 *    bukan kebocoran.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const allow = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest<SessionRequest>();
    const role = request.user?.role;

    if (!allow || allow.length === 0 || !role || !allow.includes(role)) {
      throw new ForbiddenException({
        error: {
          code: 'FORBIDDEN_ROLE',
          message: 'Peran tidak diizinkan di rute ini',
          details: { role: role ?? null },
        },
      });
    }

    return true;
  }
}
