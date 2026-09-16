import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { ResendMailerService } from './resend-mailer.service';

/**
 * E16 · Notifikasi — docs/PRD.md §7 E16
 *
 * N-01: tabel `notifications` (sudah ada sejak F-04/001_init.sql, TIDAK ada
 * migrasi baru di sini) + `NotificationsService.create()` (insert + kirim
 * email retry 3x) + `GET /notifications` & `PATCH /notifications/:id/read`
 * (disiapkan untuk N-02, UI lonceng notifikasi).
 *
 * DIBELI: Resend untuk pengiriman email (CLAUDE.md §Yang dibeli, bukan dibangun).
 * Maksimal 3 notifikasi/pengguna/hari, kelebihan digabung (NO-5) — BELUM
 * diimplementasikan di N-01, lihat catatan gap di laporan PR.
 *
 * `NotificationsService` diekspor supaya modul lain (mis. StreakService di
 * S-04, scheduler peringatan streak) bisa memicu notifikasi dengan
 * mengimpor barrel ini (`../notification`), sesuai batas modul lint
 * `no-restricted-imports`.
 */
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, ResendMailerService],
  exports: [NotificationsService],
})
export class NotificationModule {}
