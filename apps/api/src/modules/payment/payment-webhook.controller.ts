import { Body, Controller, HttpCode, Post } from '@nestjs/common';

import { PaymentWebhookService } from './payment-webhook.service';

/**
 * `POST /webhooks/payment` — PRD §10.3, `P-03`.
 *
 * ── Tanpa guard, dan itu keputusan ──
 *
 * Midtrans tidak punya sesi dan tidak akan pernah punya. Yang membuktikan
 * request ini sah adalah **tanda tangannya**, sama seperti
 * `POST /webhooks/copyleaks`. `ACCESS_MATRIX` sudah menandainya `allow: []`
 * dengan catatan alasannya sejak penyisiran isu #88 — rute publik yang tidak
 * dijelaskan tidak bisa dibedakan dari rute yang lupa dijaga.
 *
 * Controller ini sengaja setipis mungkin: tidak ada cabang, tidak ada
 * keputusan. Seluruh gerbang uang ada di `PaymentWebhookService`, supaya yang
 * perlu dibaca saat mempertanyakan "bagaimana koin bisa bertambah" hanya satu
 * berkas.
 */
@Controller('webhooks')
export class PaymentWebhookController {
  constructor(private readonly webhook: PaymentWebhookService) {}

  /**
   * 200 untuk semua keadaan yang tidak akan berubah kalau dicoba lagi; 401
   * hanya untuk tanda tangan yang tidak sah (`PA-6`, dilempar service).
   */
  @Post('payment')
  @HttpCode(200)
  async payment(@Body() body: unknown): Promise<{ received: true }> {
    await this.webhook.handle(body);
    return { received: true };
  }
}
