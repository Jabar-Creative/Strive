import {
  Param,
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Post,
  UseGuards,
} from '@nestjs/common';

import { CurrentUserId, Roles, RolesGuard, SessionGuard } from '../../common/guards';
import { type PurchaseResult, StoreService, type StoreItemView } from './store.service';

/**
 * `GET /store/items` + `POST /store/purchase` (`ST-01`) +
 * `GET /store/purchases/:id/download` (`ST-02`) — PRD §10.3.
 *
 * Superadmin DITOLAK: menukar koin adalah aktivitas pengguna, dan panel admin
 * tidak punya dompet (PRD §2.4). Pola yang sama dengan `/wallet`.
 *
 * `GET /store/purchases/:id/download` ADA di sini sejak `ST-02` — acceptance
 * criteria-nya (URL kedaluwarsa 15 menit, aset tidak bisa ditebak) yang
 * menggambarkan perilakunya.
 */
@UseGuards(SessionGuard, RolesGuard)
@Roles('student', 'mentor')
@Controller('store')
export class StoreController {
  constructor(private readonly store: StoreService) {}

  @Get('items')
  async items(@CurrentUserId() userId: string): Promise<StoreItemView[]> {
    return this.store.items(userId);
  }

  /**
   * PRD §10.3 menandainya ⚡ — wajib `Idempotency-Key`.
   *
   * Dikirim apa adanya ke `CoinLedgerService`, yang memakainya sebagai lapis
   * idempotensi PERTAMA (`coin_ledger.idempotency_key UNIQUE`). Lapis kedua
   * `store_purchases_once`, dan keduanya perlu: kunci menjaga request yang
   * diulang, constraint menjaga request yang berbeda dengan niat yang sama.
   */
  @Post('purchase')
  async purchase(
    @CurrentUserId() userId: string,
    @Body() body: { item_id?: unknown },
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<PurchaseResult> {
    const itemId = body?.item_id;
    if (typeof itemId !== 'string' || itemId.length === 0) {
      throw new BadRequestException({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'item_id wajib diisi',
          details: { field: 'item_id' },
        },
      });
    }
    return this.store.purchase({ userId, itemId, idempotencyKey });
  }

  /**
   * `GET /store/purchases/:id/download` — ST-02, SR-5: signed URL 15 menit.
   * Kepemilikan dicek di service (WHERE user_id), bukan di guard — pola
   * F-14. `asset_key` tidak pernah keluar; yang dikirim hanya URL ternilai
   * pendek + kapan ia kedaluwarsa.
   */
  @Get('purchases/:id/download')
  async download(
    @CurrentUserId() userId: string,
    @Param('id') purchaseId: string,
  ): Promise<{ url: string; expires_at: string }> {
    return this.store.downloadUrl(userId, purchaseId);
  }
}
