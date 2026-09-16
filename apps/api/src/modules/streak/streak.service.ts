import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'kysely';

import type { Trx } from '../wallet';
import type { FreezeResult, StreakRow, StreakResult } from './streak.types';

/**
 * Streak harian, dihitung dalam ZONA WAKTU PENGGUNA.
 *
 * Catatan pembuka docs/PRD.md §7 E3 menyebut ini keputusan paling menentukan
 * di seluruh epik: kalau "hari ini" dihitung di UTC, pengguna WIB yang belajar
 * pukul 22.00 tercatat di tanggal besok dan streak-nya putus pukul 07.00 pagi
 * tanpa sebab yang bisa ia pahami.
 *
 * SATU aturan yang membentuk seluruh berkas ini: **tidak ada satu pun tanggal
 * yang dibentuk di Node.** Setiap perbandingan terjadi di dalam SQL dengan
 * `(now() AT TIME ZONE s.timezone)::date`, jadi hasilnya tidak bergantung pada
 * TZ proses Node — yang di CI, di laptop macOS, dan di container Linux bisa
 * berbeda-beda tanpa ada yang menyadarinya.
 *
 * Konsekuensi lain yang ikut gratis: daylight saving time di zona non-Indonesia
 * ditangani PostgreSQL sendiri, tanpa satu baris kode pun di sini.
 */
@Injectable()
export class StreakService {
  /**
   * Mencatat satu micro-task (SK-1, SK-2) dan memperbarui streak.
   *
   * Empat hasil yang mungkin, persis Lampiran B PRD:
   *   gap = 0  → already_active   tidak ada yang berubah
   *   gap = 1  → extended         current + 1
   *   gap > 1  → restarted        current = 1 — HARI INI TETAP DIHITUNG, bukan 0
   *   belum pernah → restarted    current = 1
   *
   * Menerima `trx` dan tidak membuka transaksinya sendiri: pemanggilnya adalah
   * transaksi `POST /attempts` yang menulis enam hal sekaligus (LE-6), dan
   * streak harus ikut di-rollback bersamanya.
   */
  async recordActivity(trx: Trx, userId: string): Promise<StreakResult> {
    const row = await this.lockAndRead(trx, userId);

    // Tiga angka di bawah SEMUANYA dihitung Postgres. `gapDays` null berarti
    // belum pernah aktif sama sekali.
    const { today, gap_days: gapDays } = await this.localFacts(trx, userId);

    if (gapDays === 0) {
      return {
        kind: 'already_active',
        current: row.current_streak,
        longest: row.longest_streak,
        localDate: today,
        isNewRecord: false,
      };
    }

    const current = gapDays === 1 ? row.current_streak + 1 : 1;
    const longest = Math.max(row.longest_streak, current); // SK-5: tidak pernah turun
    const isNewRecord = current > row.longest_streak;

    await trx
      .updateTable('streaks')
      .set({
        current_streak: current,
        longest_streak: longest,
        // Ditulis dari hasil hitungan Postgres, bukan dari Date milik Node.
        last_activity_date: today,
        updated_at: new Date(),
      })
      .where('user_id', '=', userId)
      .execute();

    await this.emit(trx, userId, current, longest, today);

    return {
      kind: gapDays === 1 ? 'extended' : 'restarted',
      current,
      longest,
      localDate: today,
      isNewRecord,
    };
  }

  /**
   * Memakai satu kredit freeze untuk menyelamatkan HARI BERJALAN (SK-6).
   *
   * Idempoten per hari lokal: dipanggil dua kali di hari yang sama hanya
   * memakan satu kredit. Jaminannya `freeze_used_date`, dibandingkan dengan
   * tanggal lokal yang dihitung Postgres — bukan penghitung terpisah yang
   * bisa menyimpang.
   *
   * Tidak memakan kredit kalau pengguna sudah aktif hari ini: freeze tidak ada
   * gunanya di situ, dan membakar kredit tanpa manfaat adalah kerugian nyata
   * bagi pengguna.
   */
  async useFreeze(trx: Trx, userId: string): Promise<FreezeResult> {
    const row = await this.lockAndRead(trx, userId);
    const {
      today,
      gap_days: gapDays,
      freeze_used_today: usedToday,
    } = await this.localFacts(trx, userId);

    if (usedToday) {
      return { kind: 'already_frozen', credits: row.freeze_credits, localDate: today };
    }

    if (gapDays === 0) {
      return { kind: 'already_active', credits: row.freeze_credits, localDate: today };
    }

    if (row.freeze_credits <= 0) {
      throw new ConflictException({
        error: {
          code: 'NO_FREEZE_CREDITS',
          message: 'Tidak ada kredit freeze',
          details: { credits: row.freeze_credits },
        },
      });
    }

    // Freeze menandai hari ini sebagai "terselamatkan": last_activity_date maju
    // ke hari ini sehingga besok gap-nya 1, tapi current_streak TIDAK berubah —
    // hari ini tidak dihitung sebagai hari belajar (Lampiran B: `frozen`).
    await trx
      .updateTable('streaks')
      .set({
        freeze_credits: row.freeze_credits - 1,
        freeze_used_date: today,
        last_activity_date: today,
        updated_at: new Date(),
      })
      .where('user_id', '=', userId)
      .execute();

    await this.emit(trx, userId, row.current_streak, row.longest_streak, today);

    return { kind: 'frozen', credits: row.freeze_credits - 1, localDate: today };
  }

  // ── internal ────────────────────────────────────────────────────────────

  /**
   * Mengunci baris streak. Titik serialisasi per pengguna: tanpa ini, dua
   * micro-task yang selesai bersamaan bisa sama-sama membaca gap=1 dan
   * menaikkan streak dua kali.
   */
  private async lockAndRead(trx: Trx, userId: string): Promise<StreakRow> {
    const row = await trx
      .selectFrom('streaks')
      .selectAll()
      .where('user_id', '=', userId)
      .forUpdate()
      .executeTakeFirst();

    if (!row) {
      // Baris streaks dibuat saat registrasi bersama reviewer_weights (AU-6).
      // Ketiadaannya berarti registrasi tidak utuh — bukan kondisi yang boleh
      // ditambal diam-diam di sini.
      throw new NotFoundException({
        error: {
          code: 'NOT_FOUND',
          message: 'Baris streak tidak ditemukan; registrasi tidak utuh',
          details: { userId },
        },
      });
    }
    return row as StreakRow;
  }

  /**
   * Tiga fakta tanggal, SEMUANYA dihitung Postgres dalam zona waktu pengguna.
   *
   * `gap_days` = selisih hari antara hari ini lokal dan aktivitas terakhir.
   * Null kalau belum pernah aktif.
   */
  private async localFacts(
    trx: Trx,
    userId: string,
  ): Promise<{ today: string; gap_days: number | null; freeze_used_today: boolean }> {
    const result = await sql<{
      today: string;
      gap_days: number | null;
      freeze_used_today: boolean;
    }>`
      SELECT
        to_char((now() AT TIME ZONE s.timezone)::date, 'YYYY-MM-DD') AS today,
        CASE
          WHEN s.last_activity_date IS NULL THEN NULL
          ELSE ((now() AT TIME ZONE s.timezone)::date - s.last_activity_date)
        END AS gap_days,
        (s.freeze_used_date IS NOT NULL
          AND s.freeze_used_date = (now() AT TIME ZONE s.timezone)::date) AS freeze_used_today
      FROM streaks s
      WHERE s.user_id = ${userId}
    `.execute(trx);

    const row = result.rows[0];
    if (!row) throw new Error(`Baris streak hilang di tengah transaksi: ${userId}`);
    return {
      today: row.today,
      gap_days: row.gap_days === null ? null : Number(row.gap_days),
      freeze_used_today: row.freeze_used_today,
    };
  }

  /**
   * Outbox, bukan penulisan Redis langsung (CLAUDE.md aturan 6).
   *
   * Cache `streak:{user_id}` diperbarui outbox worker SETELAH commit. Cache
   * yang berisi nilai dari transaksi yang di-rollback lebih berbahaya daripada
   * cache kosong — pengguna akan melihat streak yang tidak pernah terjadi.
   */
  private async emit(
    trx: Trx,
    userId: string,
    current: number,
    longest: number,
    localDate: string,
  ): Promise<void> {
    await trx
      .insertInto('outbox_events')
      .values({
        topic: 'streak.updated',
        payload: JSON.stringify({ user_id: userId, current, longest, date: localDate }),
      })
      .execute();
  }
}
