import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';

import { PricingConfigService } from './pricing-config.service';
import type { PricingConfigRow } from './pricing-config.service';

/** Bentuk respons publik `GET /pricing` — TANPA `created_by` (UUID admin internal). */
export interface PricingResponse {
  version: number;
  coin_price_idr: number;
  scan_cost_coins: number;
  scan_cached_cost_coins: number;
  lesson_reward_coins: number;
  cv_cost_coins: number;
  interview_cost_coins: number;
  statement_cost_coins: number;
  prompt_run_cost_coins: number;
  freeze_cost_coins: number;
  packages: PricingConfigRow['packages'];
  active_from: string;
}

/**
 * `created_by` dibuang: itu UUID admin internal, tidak berguna bagi client
 * dan tidak perlu diekspos ke seluruh peran (student/mentor/superadmin)
 * yang mengakses endpoint publik ini.
 */
function toPublicResponse(row: PricingConfigRow): PricingResponse {
  return {
    version: row.version,
    coin_price_idr: row.coin_price_idr,
    scan_cost_coins: row.scan_cost_coins,
    scan_cached_cost_coins: row.scan_cached_cost_coins,
    lesson_reward_coins: row.lesson_reward_coins,
    cv_cost_coins: row.cv_cost_coins,
    interview_cost_coins: row.interview_cost_coins,
    statement_cost_coins: row.statement_cost_coins,
    prompt_run_cost_coins: row.prompt_run_cost_coins,
    freeze_cost_coins: row.freeze_cost_coins,
    packages: row.packages,
    // docs/PRD.md §10.1: tanggal selalu ISO 8601.
    active_from: row.active_from.toISOString(),
  };
}

/**
 * `GET /pricing` — docs/PRD.md §10.3 "Dompet & pembayaran".
 *
 * Peran: SEMUA (student, mentor, superadmin) — bukan `publik`. Guard JWT
 * belum ada di repo ini (barrel `common/guards` menunggu item A-02 Dev A),
 * jadi endpoint ini SEMENTARA tidak dijaga apa pun. Isinya sendiri tidak
 * sensitif (harga & paket, bukan data pengguna), tapi begitu JwtGuard ada,
 * pasang di sini supaya konsisten dengan §10.3 (yang menyebutnya "semua",
 * bukan "publik").
 */
@Controller('pricing')
export class PricingController {
  constructor(private readonly pricing: PricingConfigService) {}

  @Get()
  async getActive(): Promise<PricingResponse> {
    const current = await this.pricing.getCurrentVersion();
    if (!current) {
      // Keadaan pra-peluncuran: pricing_config kosong sampai bootstrap versi
      // pertama (F-04/F-11 seed, atau publish manual lewat SA-02) berjalan.
      // Bukan 404 (bukan salah pemanggil) dan bukan kode error standar
      // docs/PRD.md §10.2 — ditandai eksplisit supaya klien tidak
      // menyamakannya dengan "harga tidak ditemukan" untuk versi tertentu.
      throw new ServiceUnavailableException({
        code: 'PRICING_NOT_CONFIGURED',
        message: 'Belum ada versi harga yang diterbitkan',
        details: {},
      });
    }
    return toPublicResponse(current);
  }
}
