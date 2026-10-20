import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';

import { CurrentUserId, Roles, RolesGuard, SessionGuard } from '../../common/guards';
import { CheckoutService, type CheckoutResult } from './checkout.service';

/**
 * `POST /payments/checkout` — PRD §10.3, item `P-02` (`PA-2`…`PA-4`, `PA-10`).
 *
 * **Rute ini tidak pernah ada sampai hari ini (isu #233), dan itu bukan
 * kelalaian yang terlihat dari mana pun.** `CheckoutService` ter-merge dan
 * teruji terhadap database sungguhan, kontrak zod-nya lengkap, dan
 * `ACCESS_MATRIX` mendaftarkan rutenya — jadi 91 test matriks akses lulus
 * untuk rute yang menjawab 404. Papan pun menulis `P-02` `blocked` dengan
 * catatan "kode selesai & ter-merge": benar di tingkat service, keliru di
 * tingkat rute. Yang menemukannya Dev B saat mencoba MEMAKAINYA dari UI
 * top-up (`P-04`), bukan satu pun gerbang di repo ini.
 *
 * Superadmin DITOLAK: membeli koin adalah aktivitas pengguna, dan panel admin
 * tidak punya dompet (PRD §2.4). Pola yang sama dengan `/wallet` dan `/store`.
 */
@UseGuards(SessionGuard, RolesGuard)
@Roles('student', 'mentor')
@Controller('payments')
export class CheckoutController {
  constructor(private readonly checkout: CheckoutService) {}

  /**
   * PRD §10.3 menandainya ⚡ — wajib `Idempotency-Key`.
   *
   * `200`, bukan `201`: request ulang dengan kunci yang sama mengembalikan
   * order yang SUDAH ada (`PA-3`), dan `201 Created` untuk respons yang tidak
   * membuat apa pun adalah kebohongan yang dibaca mesin — klien yang
   * mencabang pada status tidak bisa membedakan keduanya, dan `reused` di
   * badan responsnya yang membawa kabar itu.
   */
  @Post('checkout')
  @HttpCode(200)
  async buat(
    @CurrentUserId() userId: string,
    @Body() body: { package_id?: unknown },
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<CheckoutResult> {
    // WAJIB, bukan opsional — pola yang sama dengan `POST /attempts`:
    // ditolak DI SINI supaya service tidak pernah menerima `undefined` yang
    // lalu tersimpan NULL, dan `orders.idempotency_key` yang NOT NULL akan
    // menolaknya dengan galat yang tidak menunjuk ke penyebabnya.
    if (!idempotencyKey || idempotencyKey.trim().length === 0) {
      throw new BadRequestException({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Header Idempotency-Key wajib diisi',
          details: { header: 'Idempotency-Key' },
        },
      });
    }

    const packageId = body?.package_id;
    if (typeof packageId !== 'string' || packageId.trim().length === 0) {
      throw new BadRequestException({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'package_id wajib diisi',
          details: { field: 'package_id' },
        },
      });
    }

    return this.checkout.checkout({
      userId,
      packageId: packageId.trim(),
      idempotencyKey: idempotencyKey.trim(),
    });
  }
}
