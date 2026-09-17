import { Module } from '@nestjs/common';

import { CheckoutService } from './checkout.service';
import { SnapClient } from './snap.client';
import { PricingConfigService } from './pricing-config.service';
import { PricingController } from './pricing.controller';

/**
 * E6 · Payment — docs/PRD.md §7 E6, §12.1
 *
 * P-01 (Dev B, W4) SELESAI: pricing_config berversi + `GET /pricing`.
 * P-02 (checkout Midtrans) dan P-03 (webhook) MASIH KERANGKA KOSONG —
 * menyusul di item itu, milik Dev A, W5.
 *
 * `PricingConfigService` diekspor supaya modul lain (mis. `admin` untuk
 * `PATCH /admin/pricing` — SA-02, Dev A W7) bisa memanggil
 * `publishNewVersion()` tanpa menembus file di dalam modul ini.
 *
 * DIBELI: Midtrans Snap hosted checkout. Jangan buat halaman checkout sendiri.
 * Koin HANYA ditambahkan dari webhook BERTANDA TANGAN — tidak pernah dari
 * redirect client (PA-5).
 */
@Module({
  controllers: [PricingController],
  providers: [PricingConfigService, CheckoutService, SnapClient],
  exports: [PricingConfigService, CheckoutService],
})
export class PaymentModule {}
