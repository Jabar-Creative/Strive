import { Module } from '@nestjs/common';

import { AuthService } from './auth.service';

/**
 * E1 · Auth & RBAC — docs/PRD.md §7 E1
 *
 * DIBELI, BUKAN DIBANGUN: Better-Auth + adapter PostgreSQL (CLAUDE.md
 * §Yang dibeli). `auth.config.ts` adalah konfigurasi, bukan logika auth.
 *
 * `AuthService` di sini BUKAN auth — ia tiga kewajiban pengganti AU-5 yang
 * dibuang isu #18. Guard & matriks akses menyusul di `A-02`.
 */
@Module({
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
