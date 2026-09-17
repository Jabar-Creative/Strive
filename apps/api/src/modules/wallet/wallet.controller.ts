import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import type { WalletLedgerResponse, WalletResponse } from '@strive/contracts';

import { CurrentUserId, Roles, RolesGuard, SessionGuard } from '../../common/guards';
import { InvalidCursorError, LEDGER_LIMIT_MAX, WalletService } from './wallet.service';

/**
 * PRD §2.4: `GET /wallet`, `/wallet/ledger` → student & mentor.
 * Superadmin DITOLAK — dompet orang bukan urusan panel admin; untuk audit ada
 * `/admin/transactions` yang tercatat di `audit_log` (PRD §2.5).
 */
@UseGuards(SessionGuard, RolesGuard)
@Roles('student', 'mentor')
@Controller('wallet')
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

  /** Saldo + 20 entri terakhir — satu request untuk layar dompet. */
  @Get()
  async overview(@CurrentUserId() userId: string): Promise<WalletResponse> {
    return this.wallet.overview(userId);
  }

  /**
   * Riwayat lengkap, cursor-paginated.
   *
   * `userId` datang dari guard, TIDAK PERNAH dari query — itu batas antara
   * "riwayat saya" dan membaca dompet orang lain.
   */
  @Get('ledger')
  async ledger(
    @CurrentUserId() userId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ): Promise<WalletLedgerResponse> {
    const n = limit === undefined ? undefined : Number(limit);
    if (n !== undefined && (!Number.isInteger(n) || n < 1 || n > LEDGER_LIMIT_MAX)) {
      throw new BadRequestException({
        error: {
          code: 'INVALID_CURSOR',
          message: `limit harus bilangan bulat 1-${LEDGER_LIMIT_MAX}`,
          details: { limit },
        },
      });
    }

    try {
      return await this.wallet.ledger(userId, { cursor, limit: n });
    } catch (error) {
      if (error instanceof InvalidCursorError) {
        throw new BadRequestException({
          error: { code: 'INVALID_CURSOR', message: 'Cursor tidak valid', details: { cursor } },
        });
      }
      throw error;
    }
  }
}
