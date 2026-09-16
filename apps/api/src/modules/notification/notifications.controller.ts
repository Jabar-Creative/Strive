import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
// HANYA `import type` ke @strive/contracts di file ini — lihat komentar
// panjang di list-query.util.ts untuk alasannya (import NILAI dari paket itu
// terbukti meng-crash `node dist/main.js` produksi).
import type {
  ListNotificationsResponse,
  MarkNotificationReadResponse,
  Notification,
} from '@strive/contracts';
import { CurrentUserId } from './current-user.decorator';
import { parseListNotificationsQuery } from './list-query.util';
import {
  NotificationCursorError,
  NotificationOwnershipError,
  NotificationsService,
  type NotificationRow,
} from './notifications.service';
import { NotificationsAuthGuard } from './notifications-auth.guard';

/**
 * Serializer: baris Kysely (Date, kind:string longgar) -> bentuk kontrak zod
 * (ISO string, kind sempit). Tidak ada kunci rahasia untuk dibuang di sini
 * (beda dengan lesson_cards) — tapi bentuknya tetap harus eksplisit supaya
 * `Date` tidak lolos jadi JSON aneh (`toJSON()` default Date memang ISO, tapi
 * kita tidak mau bergantung pada perilaku implisit `res.json()`).
 */
function serialize(row: NotificationRow): Notification {
  return {
    id: row.id,
    // Kolom DB bertipe `text` polos — lihat docs/PRD.md §7 E16 NO-1 untuk union yang dijamin service.
    kind: row.kind as Notification['kind'],
    title: row.title,
    body: row.body,
    data: (row.data as Record<string, unknown> | null) ?? null,
    read_at: row.read_at ? row.read_at.toISOString() : null,
    sent_at: row.sent_at ? row.sent_at.toISOString() : null,
    created_at: row.created_at.toISOString(),
  };
}

@Controller('notifications')
@UseGuards(NotificationsAuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  async list(
    @CurrentUserId() userId: string,
    // Bentuk sebenarnya dari req.query BUKAN selalu Record<string,string> —
    // Express bisa memberi array/objek nested (EXPRESS-INPUT-002). Tidak
    // dianggap tepercaya lewat anotasi tipe; zod di bawah yang memvalidasi
    // bentuknya sungguhan sebelum dipakai.
    @Query() query: unknown,
  ): Promise<ListNotificationsResponse> {
    const parsed = parseListNotificationsQuery(query);
    if (!parsed.ok) {
      throw new BadRequestException({
        code: 'INVALID_CURSOR',
        message: 'Parameter query tidak valid',
        details: parsed.details,
      });
    }

    try {
      const { data, nextCursor } = await this.notifications.listForUser(userId, parsed.value);
      return { data: data.map(serialize), next_cursor: nextCursor };
    } catch (error) {
      if (error instanceof NotificationCursorError) {
        throw new BadRequestException({
          code: 'INVALID_CURSOR',
          message: 'Cursor tidak valid',
          details: { cursor: error.rawCursor },
        });
      }
      throw error;
    }
  }

  @Patch(':id/read')
  async markRead(
    @CurrentUserId() userId: string,
    @Param('id') id: string,
  ): Promise<MarkNotificationReadResponse> {
    try {
      const updated = await this.notifications.markRead(userId, id);
      // markRead() selalu mengisi read_at (nilainya baru saja di-set) — non-null assertion aman di sini.
      return { id: updated.id, read_at: updated.read_at!.toISOString() };
    } catch (error) {
      if (error instanceof NotificationOwnershipError) {
        throw new NotFoundException({
          code: 'NOTIFICATION_NOT_FOUND',
          message: 'Notifikasi tidak ditemukan',
          details: { id: error.notificationId },
        });
      }
      throw error;
    }
  }
}
