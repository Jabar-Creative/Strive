import { Module } from '@nestjs/common';

import { KyselyModule } from '../../infra/kysely';
import { WalletModule } from '../wallet';

import { AdminPricingController } from './admin-pricing.controller';
import { CheckoutService } from './checkout.service';
import { OrderReadService } from './order-read.service';
import { OrdersController } from './orders.controller';
import { PaymentWebhookController } from './payment-webhook.controller';
import { PaymentWebhookService } from './payment-webhook.service';
import { SnapClient } from './snap.client';
import { PricingConfigService } from './pricing-config.service';
import { PricingController } from './pricing.controller';

/**
 * E6 · Payment — docs/PRD.md §7 E6, §12.1
 *
 * P-01 (Dev B, W4) SELESAI: pricing_config berversi + `GET /pricing`.
 * P-02 (checkout Midtrans) selesai; kodenya ter-merge, sebagian AC-nya
 * menunggu kredensial vendor. P-03 (webhook) selesai — dan ia yang memegang
 * SATU-SATUNYA jalur penambahan koin berbayar di produk ini (PA-5).
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
  imports: [KyselyModule, WalletModule],
  controllers: [
    PricingController,
    AdminPricingController,
    OrdersController,
    PaymentWebhookController,
  ],
  providers: [
    PricingConfigService,
    CheckoutService,
    SnapClient,
    OrderReadService,
    PaymentWebhookService,
  ],
  exports: [PricingConfigService, CheckoutService, OrderReadService],
})
export class PaymentModule {}
