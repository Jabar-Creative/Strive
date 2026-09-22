import {
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
 * `GET /store/items` + `POST /store/purchase` — PRD §10.3, item `ST-01`.
 *
 * Superadmin DITOLAK: menukar koin adalah aktivitas pengguna, dan panel admin
 * tidak punya dompet (PRD §2.4). Pola yang sama dengan `/wallet`.
 *
 * `GET /store/purchases/:id/download` TIDAK ada di sini — ia milik `ST-02`
 * bersama UI etalase, dan acceptance criteria-nya (URL kedaluwarsa 15 menit,
 * aset tidak bisa ditebak) memang menggambarkan perilakunya.
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
}
