import { HttpException, HttpStatus } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';

import type { DB } from '../../infra/kysely';

type Trx = Transaction<DB>;

/**
 * Kuota AI harian GABUNGAN — PRD `CV-9`/`PL-4`: 10 run AI per pengguna per
 * hari, lintas CV + Prompt Lab + Mastery. Dipakai `PromptLabService` dan
 * `CvBuilderService` (AI-07) lewat SATU helper karena kuotanya memang satu
 * angka untuk semua fitur AI; menyalin query-nya ke tiap service berarti dua
 * hitungan yang katanya gabungan.
 *
 * ── Percobaan dihitung dari LEDGER, bukan dari baris hasil ──
 *
 * Sisi coin_ledger menghitung hold `ref_type IN ('prompt_run','ai_job')`:
 * percobaan yang GAGAL tetap memanggil LLM vendor, jadi pengaman biaya harus
 * menghitung PERCOBAAN, bukan kesuksesan (audit PL-01 T2). Ledger append-only
 * dan tidak bisa bolong; baris hasil (`prompt_runs`, `cv_documents`) lahir
 * hanya saat sukses — dan baris run yang gagal bahkan dihapus.
 *
 * ── `cv_documents` DIBUANG dari query sejak AI-07 ──
 *
 * Dulu ia proxy satu-satunya untuk percobaan CV (CV belum menulis hold apa
 * pun). Sekarang tiap scan CV menulis hold `'ai_job'` SEBELUM LLM dijalankan,
 * jadi mempertahankan sisi cv_documents berarti scan yang BERHASIL terhitung
 * dua kali: sekali sebagai hold, sekali sebagai baris dokumen. Saat Mastery
 * juga berpindah ke hold `'ai_job'`, sisi `mastery_sessions` dibuang dengan
 * alasan yang sama — sampai itu terjadi, sisi itu tetap karena mastery
 * menulis `mastery_sessions` tanpa hold.
 *
 * ── Hari LOKAL pengguna, dihitung di Postgres (aturan keras 5) ──
 *
 * Kedua sisi dilemparkan ke date LOKAL dulu; membandingkan `created_at >=
 * date` secara langsung mengonversi menurut zona SESI (UTC) dan meninggalkan
 * jendela tengah malam yang bolong (audit PL-01 T1). `streaks.timezone` —
 * pelajaran #193: satu sumber dengan penulis attempt.
 *
 * Dipanggil DI DALAM TRX SETELAH baris `users` dikunci FOR UPDATE — cek
 * sebelum kunci berarti 11 request paralel membaca hitungan lama.
 */

/** PL-4/CV-9: 10 run AI/hari (gabungan lintas fitur AI). */
export const KUOTA_AI_HARIAN = 10;

export async function pastikanKuotaAi(trx: Trx, userId: string): Promise<void> {
  const r = await sql<{ n: string }>`
    SELECT (
      (SELECT count(*) FROM coin_ledger cl
        JOIN streaks st ON st.user_id = cl.user_id
        WHERE cl.user_id = s.user_id
          AND cl.ref_type IN ('prompt_run', 'ai_job')
          AND cl.entry_type = 'hold'
          AND (cl.created_at AT TIME ZONE st.timezone)::date
              = (now() AT TIME ZONE st.timezone)::date)
    + (SELECT count(*) FROM mastery_sessions ms
        JOIN streaks st ON st.user_id = ms.user_id
        WHERE ms.user_id = s.user_id
          AND (ms.created_at AT TIME ZONE st.timezone)::date
              = (now() AT TIME ZONE st.timezone)::date)
    ) AS n
    FROM streaks s WHERE s.user_id = ${userId}`.execute(trx);

  const jumlah = Number(r.rows[0]?.n ?? 0);
  if (jumlah >= KUOTA_AI_HARIAN) {
    // Nest 10 belum punya TooManyRequestsException — 429 eksplisit.
    throw new HttpException(
      {
        error: {
          code: 'DAILY_AI_QUOTA_EXCEEDED',
          message: `Kuota ${KUOTA_AI_HARIAN} run AI/hari sudah habis — kembali besok`,
          details: { terpakai: jumlah },
        },
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
