import { Module } from '@nestjs/common';

import { KyselyModule } from '../../infra/kysely';
import { AdminIntegrationsController } from './admin-integrations.controller';
import { AdminUsersController } from './admin-users.controller';
import { IntegrationsHealthService } from './integrations-health.service';
import { UserRoleService } from './user-role.service';

/**
 * E9 · Panel Superadmin — docs/PRD.md §7 E9
 *
 * `SA-01` (view admin_* + role read-only) ada di migrasi 006, bukan di sini —
 * Retool membaca database langsung. `SA-03` ada di sini: statusnya diturunkan
 * dari tabel kita sendiri, bukan dari ping ke vendor.
 * `SA-02` (`PATCH /admin/pricing`) tinggal di modul `payment` bersama
 * `PricingConfigService` — harga dimiliki modul harga, bukan modul admin.
 *
 * DIBELI: Retool di atas view SQL read-only. Jangan bangun UI admin React.
 * Perubahan harga MENERBITKAN versi baru pricing_config, tidak pernah menimpa.
 */
@Module({
  imports: [KyselyModule],
  controllers: [AdminUsersController, AdminIntegrationsController],
  providers: [UserRoleService, IntegrationsHealthService],
  // `IntegrationsHealthService` diekspor untuk MetricsService (R-04): satu
  // definisi lonjakan biaya, bukan dua yang bisa menyimpang.
  exports: [UserRoleService, IntegrationsHealthService],
})
export class AdminModule {}
