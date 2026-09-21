import { Module } from '@nestjs/common';

import { KyselyModule } from '../../infra/kysely';
import { AdminUsersController } from './admin-users.controller';
import { UserRoleService } from './user-role.service';

/**
 * E9 · Panel Superadmin — docs/PRD.md §7 E9
 *
 * Controller & service menyusul di item: SA-01, SA-03.
 * `SA-02` (`PATCH /admin/pricing`) tinggal di modul `payment` bersama
 * `PricingConfigService` — harga dimiliki modul harga, bukan modul admin.
 *
 * DIBELI: Retool di atas view SQL read-only. Jangan bangun UI admin React.
 * Perubahan harga MENERBITKAN versi baru pricing_config, tidak pernah menimpa.
 */
@Module({
  imports: [KyselyModule],
  controllers: [AdminUsersController],
  providers: [UserRoleService],
  exports: [UserRoleService],
})
export class AdminModule {}
