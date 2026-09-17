import {
  ExecutionContext,
  InternalServerErrorException,
  createParamDecorator,
} from '@nestjs/common';
import type { AuthenticatedRequestLike } from './notifications-auth.guard';

/**
 * Ambil `userId` yang ditaruh `NotificationsAuthGuard` di request.
 *
 * Kalau dipakai tanpa guard (bug pemasangan, bukan kondisi pengguna), gagal
 * eksplisit dengan 500 daripada diam-diam meloloskan `userId: undefined` ke
 * query database — itu akan jadi IDOR (bisa membaca notifikasi siapa saja).
 */
export const CurrentUserId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequestLike>();
    if (!request.userId) {
      throw new InternalServerErrorException(
        '@CurrentUserId() dipakai di route tanpa NotificationsAuthGuard — perbaiki pemasangan guard, jangan lanjutkan request.',
      );
    }
    return request.userId;
  },
);
