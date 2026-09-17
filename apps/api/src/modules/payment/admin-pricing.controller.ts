import { Body, Controller, Patch, UseGuards } from '@nestjs/common';

import { CurrentUserId, Roles, RolesGuard, SessionGuard } from '../../common/guards';
import { PricingConfigService, type PublishPricingInput } from './pricing-config.service';

/**
 * `PATCH /admin/pricing` — PRD §2.4: **superadmin saja**.
 *
 * Namanya `PATCH` tapi perilakunya **menerbitkan versi baru**, bukan mengubah
 * baris yang ada. `pricing_config` append-only dalam semangat yang sama dengan
 * `coin_ledger`: order lama menyimpan `pricing_version`-nya sendiri, dan
 * mengubah baris lama akan diam-diam mengubah harga order yang sudah dibayar.
 *
 * `SA-2`: ini SATU-SATUNYA jalur tulis harga. Koneksi Retool memakai role
 * read-only yang tidak bisa menulis apa pun (migrasi 006).
 */
@UseGuards(SessionGuard, RolesGuard)
@Roles('superadmin')
@Controller('admin/pricing')
export class AdminPricingController {
  constructor(private readonly pricing: PricingConfigService) {}

  @Patch()
  async publish(@CurrentUserId() actorId: string, @Body() body: PublishPricingInput) {
    // `actorId` datang dari GUARD, tidak pernah dari body. Pelaku yang bisa
    // dikirim klien adalah pelaku yang bisa dipalsukan — dan seluruh guna
    // audit ini bergantung pada satu field itu.
    return this.pricing.publishNewVersion(body, actorId);
  }
}
