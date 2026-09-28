import { Controller, Get, HttpCode, ServiceUnavailableException } from '@nestjs/common';
import type { HealthResponse } from '@strive/contracts';
import { HealthService } from './health.service';
import type { Kesiapan } from './readiness.service';
import { ReadinessService } from './readiness.service';

/**
 * Dikecualikan dari prefiks /api/v1 (lihat main.ts) supaya probe orkestrator
 * tidak ikut berubah saat versi API naik.
 */
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthService,
    private readonly readiness: ReadinessService,
  ) {}

  /** KEAKTIFAN: proses hidup. Sengaja tidak menyentuh dependensi apa pun. */
  @Get()
  check(): HealthResponse {
    return this.health.check();
  }

  /**
   * KESIAPAN: dependensi terjangkau — isu #155.
   *
   * `503` saat ada yang gagal, bukan `200` dengan badan yang bilang gagal.
   * Orkestrator dan pemantau membaca STATUS, dan badan yang jujur di balik
   * 200 adalah kejujuran yang tidak pernah dibaca siapa pun.
   *
   * Bentuknya belum ada di `@strive/contracts` karena paket itu milik Dev B
   * dan ini rute operasional, bukan rute produk. Tipenya lokal sampai ada
   * yang membutuhkannya dari sisi web.
   */
  @Get('ready')
  @HttpCode(200)
  async ready(): Promise<Kesiapan> {
    const hasil = await this.readiness.check();
    if (hasil.status !== 'siap') {
      throw new ServiceUnavailableException(hasil);
    }
    return hasil;
  }
}
