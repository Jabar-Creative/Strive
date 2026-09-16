import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Saldo tidak cukup — `INSUFFICIENT_COINS`, HTTP 402 (docs/PRD.md §10.2).
 *
 * `code` adalah KONTRAK, `message` bukan. Client bercabang pada `code` dan
 * tidak pernah mem-parsing `message` (docs/PRD.md §10.1).
 */
export class InsufficientCoinsError extends HttpException {
  constructor(
    readonly balance: number,
    readonly required: number,
  ) {
    super(
      {
        error: {
          code: 'INSUFFICIENT_COINS',
          message: 'Saldo koin tidak cukup',
          details: { balance, required },
        },
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}
