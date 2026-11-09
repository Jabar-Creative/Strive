import type { AiJobKind } from '../../infra/kysely';

import type { BarisJobAi } from './ai-jobs.service';
import type { AiRunResult } from './ai-service.client';

/**
 * Token penyedia finalisasi `ai_jobs` — AI-07.
 *
 * Dispatcher (Dev A) tidak boleh mengenal modul bisnis satu per satu.
 * Hubungan arahnya dibalik: modul yang punya efek samping atas selesainya
 * sebuah job (menulis `cv_documents`, settle hold koin, mengunggah PDF)
 * mendaftarkan dirinya lewat token ini, dan dispatcher memanggil yang
 * cocok kind-nya. `@Optional()` di dispatcher: tanpa pendaftar pun worker
 * tetap boot (keadaan hari ini tetap sah).
 */
export const PENYELESAI_JOB_AI = Symbol('PENYELESAI_JOB_AI');

export interface PenyelesaiJobAi {
  /** Hanya dipanggil untuk baris `ai_jobs` dengan `kind` ini. */
  kind: AiJobKind;

  /**
   * Setelah baris `done` dan biaya tercatat. Melempar atau tidak pernah
   * selesai (batas `BATAS_HOOK_MS`) = baris jadi `failed`.
   */
  sukses?(jobId: string, baris: BarisJobAi, hasil: AiRunResult): Promise<void>;

  /**
   * Dipanggil pada SEMUA keadaan terminal yang tidak menyerahkan hasil:
   * percobaan habis, galat permanen, finalisasi yang melempar/timeout, dan
   * job yang disapu karena mengendap (isu #131). Melempar atau menggantung
   * tidak menjatuhkan worker — hanya dicatat.
   */
  gagal?(jobId: string, baris: BarisJobAi): Promise<void>;
}

/**
 * ── Kontrak multi-penyedia, karena lebih dari satu boleh mendaftar ──
 *
 * Semua penyedia yang `kind`-nya cocok dipanggil BERURUTAN dalam satu proses
 * job, bukan paralel: urutannya terlihat jelas di log dan kegagalan satu
 * tidak menelan sisa galatnya.
 *
 * - `sukses`: penyedia pertama yang melempar atau kehabisan batas waktu
 *   MENGHENTIKAN sisa penyedia `sukses` untuk job itu, dan baris langsung
 *   jadi `failed`. Alasannya: menyentuh penyedia berikutnya setelah hasilnya
 *   dinyatakan gagal berarti menulis efek samping atas job yang gagal.
 * - `gagal`: hook `gagal` SEMUA penyedia yang cocok tetap dipanggil pada
 *   keadaan itu — masing-masing membersihkan miliknya sendiri (mis. dua
 *   hold berbeda atas job yang sama), dan kegagalan satu hook tidak
 *   menghentikan hook berikutnya.
 *
 * Implikasinya bagi penulis penyedia: `sukses` harus idempoten terhadap
 * pengantaran ulang (BullMQ at-least-once), dan `gagal` harus aman dipanggil
 * TANPA `sukses` pernah berjalan — itulah yang terjadi pada job yang gagal
 * di percobaan pertama maupun yang disapu #131.
 */
