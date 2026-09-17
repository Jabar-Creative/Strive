import { Module } from '@nestjs/common';

import { AuthService } from './auth.service';
import { AuthHttpController } from './auth-http.controller';
import { createAuthFromEnv } from './auth-http.provider';
import { AUTH } from './auth.types';

/**
 * E1 · Auth & RBAC — docs/PRD.md §7 E1
 *
 * DIBELI, BUKAN DIBANGUN: Better-Auth + adapter PostgreSQL (CLAUDE.md
 * §Yang dibeli). `auth.config.ts` adalah konfigurasi, bukan logika auth.
 *
 * `AuthService` di sini BUKAN auth — ia tiga kewajiban pengganti AU-5 yang
 * dibuang isu #18. Guard & matriks akses menyusul di `A-02`.
 *
 * Handler HTTP (`AuthHttpController`) dipasang di A-03: A-01 memang hanya
 * membuktikan instance lewat `auth.api`; layar web membutuhkan endpoint
 * sungguhan di `/api/v1/auth/*`.
 */
@Module({
  controllers: [AuthHttpController],
  providers: [
    AuthService,
    {
      provide: AUTH,
      useFactory: createAuthFromEnv,
    },
  ],
  exports: [AuthService],
})
export class AuthModule {}
