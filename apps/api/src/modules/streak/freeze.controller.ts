import { Controller, Headers, Post, UseGuards } from '@nestjs/common';

import { CurrentUserId, Roles, RolesGuard, SessionGuard } from '../../common/guards';
import { type BuyFreezeResult, FreezePurchaseService } from './freeze-purchase.service';

/**
 * `POST /streak/freeze/purchase` — PRD §10.3, item `S-05`.
 *
 * Superadmin DITOLAK, sama seperti seluruh rute `/streak`: streak adalah
 * mekanisme belajar, bukan objek administrasi (PRD §2.4).
 */
@UseGuards(SessionGuard, RolesGuard)
@Roles('student', 'mentor')
@Controller('streak')
export class FreezeController {
  constructor(private readonly freeze: FreezePurchaseService) {}

  /**
   * `Idempotency-Key` OPSIONAL di sini, berbeda dari `POST /attempts` dan
   * `POST /scans` yang mewajibkannya (PRD §10.3 ⚡).
   *
   * Yang menahan pembelian ganda adalah `streaks.freeze_purchased_month` —
   * batas 1/bulan berlaku apa pun yang dikirim klien, termasuk kalau ia tidak
   * mengirim kunci sama sekali. Kunci di sini hanya melindungi dari
   * percobaan-ulang dalam bulan yang SAMA menjawab dua kali.
   */
  @Post('freeze/purchase')
  async buy(
    @CurrentUserId() userId: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<BuyFreezeResult> {
    return this.freeze.buy(userId, idempotencyKey);
  }
}
