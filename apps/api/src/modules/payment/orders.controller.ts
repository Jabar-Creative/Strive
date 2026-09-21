import { Controller, Get, Param, UseGuards } from '@nestjs/common';

import { CurrentUserId, Roles, RolesGuard, SessionGuard } from '../../common/guards';
import { type OrderStatus, OrderReadService } from './order-read.service';

/**
 * `GET /payments/orders/:id` — PRD §10.3, item `F-14`.
 *
 * Kepemilikan dicek SERVICE, bukan guard: guard menjawab "peran ini boleh
 * masuk rute ini?", dan tidak tahu apa-apa soal order siapa (PRD §2.5).
 */
@UseGuards(SessionGuard, RolesGuard)
@Roles('student', 'mentor')
@Controller('payments/orders')
export class OrdersController {
  constructor(private readonly orders: OrderReadService) {}

  @Get(':id')
  async byId(@CurrentUserId() userId: string, @Param('id') orderId: string): Promise<OrderStatus> {
    return this.orders.byId(userId, orderId);
  }
}
