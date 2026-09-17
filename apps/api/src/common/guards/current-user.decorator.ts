import {
  InternalServerErrorException,
  createParamDecorator,
  type ExecutionContext,
} from '@nestjs/common';

import type { SessionRequest } from './session.guard';

/**
 * Mengambil id pengguna yang ditaruh `SessionGuard` di `request.user`.
 *
 * Sebelum `A-02` ada TIGA bentuk untuk satu hal yang sama: `request.userId`
 * (modul notification), `request.user.sub` (modul learning, warisan bentuk
 * JWT), dan `request.user.id` yang dipakai guard baru. Tiga bentuk untuk satu
 * fakta selalu berakhir dengan satu yang salah, dan yang salah di sini
 * menghasilkan `undefined` yang masuk ke query — IDOR, bukan error.
 *
 * **Gagal TERTUTUP.** Dipakai di rute tanpa `SessionGuard` berarti 500
 * eksplisit, bukan `undefined` yang lolos diam-diam ke database. Itu bug
 * pemasangan guard, bukan kondisi pengguna — dan pantas berisik.
 */
export const CurrentUserId = createParamDecorator((_d: unknown, ctx: ExecutionContext): string => {
  const request = ctx.switchToHttp().getRequest<SessionRequest>();
  const id = request.user?.id;
  if (!id) {
    throw new InternalServerErrorException(
      '@CurrentUserId() dipakai di rute tanpa SessionGuard — perbaiki pemasangan guard, jangan lanjutkan request.',
    );
  }
  return id;
});

/** Aktor lengkap (id + peran). Dipakai service yang memeriksa kepemilikan (PRD §2.5). */
export const CurrentUser = createParamDecorator((_d: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest<SessionRequest>();
  if (!request.user) {
    throw new InternalServerErrorException(
      '@CurrentUser() dipakai di rute tanpa SessionGuard — perbaiki pemasangan guard.',
    );
  }
  return request.user;
});
