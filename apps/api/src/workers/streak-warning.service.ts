import { Inject, Injectable, Logger } from '@nestjs/common';
import { type Kysely, sql } from 'kysely';

import { DATABASE, type DB } from '../infra/kysely';
import { NotificationsService } from '../modules/notification';

/** Jam LOKAL pengguna saat peringatan dikirim — PRD §7 E3. */
export const WARNING_HOUR_LOCAL = 20;

export interface StreakWarningResult {
  candidates: number;
  sent: number;
  skipped_already_active: number;
}

/**
 * Peringatan streak pukul 20.00 **waktu lokal masing-masing pengguna**.
 *
 * ── Kenapa jam lokal membuat job ini tidak biasa ──
 *
 * Tidak ada satu momen di mana "pukul 20.00" berlaku untuk semua orang. Job
 * ini karena itu dijalankan **setiap jam**, dan setiap kali ia hanya memilih
 * pengguna yang saat itu sedang pukul 20.00 di zona waktunya sendiri.
 *
 * Perbandingannya terjadi DI DALAM SQL:
 *
 *     EXTRACT(hour FROM (now() AT TIME ZONE u.timezone)) = 20
 *
 * Menghitungnya di Node berarti memuat seluruh pengguna, mengonversi satu per
 * satu, lalu membuang sebagian besar — dan salah untuk setiap zona yang punya
 * offset setengah jam (Asia/Kolkata, Asia/Kathmandu) kalau pembulatannya
 * ceroboh.
 *
 * ── Yang TIDAK menerima apa pun ──
 *
 * Pengguna yang sudah aktif hari itu (AC harfiah). Itu diperiksa terhadap
 * tanggal LOKAL-nya sendiri, bukan tanggal UTC — pengguna WIB yang belajar
 * pukul 22.00 kemarin sudah "hari lain" menurut UTC, dan mengiriminya
 * peringatan adalah persis bug yang aturan 5 ada untuk mencegah.
 */
@Injectable()
export class StreakWarningService {
  private readonly logger = new Logger(StreakWarningService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Kysely<DB>,
    private readonly notifications: NotificationsService,
  ) {}

  async run(): Promise<StreakWarningResult> {
    const kandidat = await this.candidates();
    let sent = 0;

    for (const c of kandidat) {
      await this.notifications.create({
        userId: c.user_id,
        kind: 'streak_warning',
        title: `Streak ${c.current_streak} hari hampir putus`,
        body:
          c.current_streak > 0
            ? `Kamu belum belajar hari ini. Satu micro-task saja cukup untuk menjaga streak ${c.current_streak} harimu.`
            : 'Kamu belum belajar hari ini. Mulai satu micro-task untuk memulai streak baru.',
        data: { current_streak: c.current_streak, local_date: c.local_date },
      });
      sent++;
    }

    if (sent > 0) this.logger.log(`Peringatan streak terkirim ke ${sent} pengguna.`);
    return { candidates: kandidat.length, sent, skipped_already_active: 0 };
  }

  /**
   * Pengguna yang SAAT INI pukul 20.00 lokal dan belum aktif hari ini.
   *
   * Dipisah dari `run()` supaya bisa diuji sendiri: yang paling mudah salah di
   * job ini adalah SIAPA yang terpilih, bukan bunyi pesannya.
   */
  async candidates(): Promise<
    { user_id: string; current_streak: number; local_date: string; local_hour: number }[]
  > {
    const r = await sql<{
      user_id: string;
      current_streak: number;
      local_date: string;
      local_hour: string;
    }>`
      SELECT s.user_id,
             s.current_streak,
             to_char((now() AT TIME ZONE s.timezone)::date, 'YYYY-MM-DD') AS local_date,
             EXTRACT(hour FROM (now() AT TIME ZONE s.timezone))::text     AS local_hour
      FROM streaks s
      JOIN users u ON u.id = s.user_id
      WHERE u.status = 'active'
        AND EXTRACT(hour FROM (now() AT TIME ZONE s.timezone)) = ${sql.lit(WARNING_HOUR_LOCAL)}
        -- Sudah aktif HARI INI menurut tanggal lokalnya sendiri -> tidak
        -- menerima apa pun. IS DISTINCT FROM, bukan <>: last_activity_date
        -- boleh NULL, dan NULL <> date menghasilkan NULL, bukan true.
        AND s.last_activity_date IS DISTINCT FROM (now() AT TIME ZONE s.timezone)::date
        -- Idempotensi harian: satu peringatan per pengguna per hari lokal.
        -- Job ini berjalan tiap jam, dan tanpa ini pengguna di zona yang
        -- offset-nya setengah jam bisa cocok dua kali.
        AND NOT EXISTS (
          SELECT 1 FROM notifications n
          WHERE n.user_id = s.user_id
            AND n.kind = 'streak_warning'
            AND (n.created_at AT TIME ZONE s.timezone)::date
                = (now() AT TIME ZONE s.timezone)::date
        )
    `.execute(this.db);

    return r.rows.map((x) => ({
      user_id: x.user_id,
      current_streak: x.current_streak,
      local_date: x.local_date,
      local_hour: Number(x.local_hour),
    }));
  }
}
