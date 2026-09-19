import { Module } from '@nestjs/common';

import { NotificationModule, ResendMailerService } from '../notification';

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
 *
 * `NotificationModule` diimpor untuk SATU hal: `ResendMailerService` (isu #65
 * poin 1). Email reset password dan verifikasi memakai pengirim yang sama
 * dengan email notifikasi supaya hanya ada satu tempat di repo yang tahu
 * vendor emailnya siapa. Yang menyeberang batas modul cuma pengirimnya —
 * `auth.config.ts` sendiri hanya melihat sebuah fungsi (`SendAuthEmail`).
 */
@Module({
  imports: [NotificationModule],
  controllers: [AuthHttpController],
  providers: [
    AuthService,
    {
      provide: AUTH,
      // `inject`, bukan memanggil `new ResendMailerService()` di dalam factory:
      // instansnya satu untuk seluruh proses, dan kalau suatu saat pengirimnya
      // butuh dependensi sendiri, tempat penyambungannya sudah benar.
      useFactory: (mailer: ResendMailerService) => createAuthFromEnv((pesan) => mailer.send(pesan)),
      inject: [ResendMailerService],
    },
  ],
  exports: [AuthService],
})
export class AuthModule {}
