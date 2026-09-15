import { UnauthorizedException, createParamDecorator, type ExecutionContext } from '@nestjs/common';

/**
 * Mengambil id pengguna dari request — tempat `JwtGuard` akan menaruhnya.
 *
 * Guard-nya sendiri adalah item `A-02`, yang TERBLOKIR isu #18. Sampai itu
 * selesai, dekorator ini **gagal tertutup**: tidak ada `request.user` berarti
 * 401, bukan rute terbuka yang membocorkan progres belajar orang lain.
 *
 * Yang berubah nanti hanya SATU hal — `A-02` memasang guard yang mengisi
 * `request.user` dari JWT. Bentuk di bawah sudah sesuai dengan itu, jadi
 * tidak ada kode rute yang perlu disentuh lagi.
 */
export const CurrentUserId = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const request = ctx.switchToHttp().getRequest<{ user?: { sub?: string } }>();
  const userId = request.user?.sub;

  if (!userId) {
    throw new UnauthorizedException({
      error: {
        code: 'UNAUTHENTICATED',
        message: 'Token tidak ada atau tidak valid',
      },
    });
  }

  return userId;
});
