import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { sql, type Kysely, type Transaction } from 'kysely';

import { AI_QUEUE, OPSI_JOB_AI } from '../../infra/bullmq';
import { DATABASE, type AiJobKind, type DB } from '../../infra/kysely';

import type { AiRunResult } from './ai-service.client';

export interface BuatJobInput {
  userId: string;
  kind: AiJobKind;
  input: unknown;
}

/**
 * Pembukuan `ai_jobs` — `AI-06`, PRD §7 E8 `CV-2`/`CV-3`/`CV-8`, aturan keras 8.
 *
 * > Node **tidak pernah memanggil LLM langsung**. Node membuat `ai_jobs`,
 * > worker mengirim ke AI service.
 *
 * Seluruh biaya LLM produk ini lewat satu tabel, dan satu tabel itu ditulis
 * dari sini saja. Itu yang membuat kalimat "biayanya bisa diaudit di satu
 * tempat" benar secara konstruksi, bukan karena kebiasaan.
 *
 * ── Membuat baris dan meng-enqueue adalah DUA langkah, dan itu disengaja ──
 *
 * `buat()` menerima transaksi pemanggilnya supaya baris `ai_jobs` ikut commit
 * bersama efek lain (mis. `cv_documents`). `enqueue()` dipanggil SETELAH
 * commit — aturan keras 10. Menggabungkannya jadi satu method akan membuat
 * pelanggaran aturan itu tidak terlihat dari sisi pemanggil, dan worker yang
 * berjalan sebelum commit akan membaca baris yang belum ada.
 */
/**
 * Umur minimum sebuah baris `running` sebelum dianggap mengendap — isu #131.
 *
 * Angka yang SAMA dengan `STALE_HOLD_MINUTES` reaper hold, dan itu disengaja:
 * dua penyapu dengan dua ambang berbeda membuat orang menebak yang mana
 * berlaku. Jauh di atas eksekusi terpanjang yang sah (§12.3 timeout 60 detik
 * × 3 percobaan + backoff ≈ 5 menit).
 */
export const AMBANG_MENGGANTUNG_MENIT = 30;

@Injectable()
export class AiJobsService {
  private readonly log = new Logger(AiJobsService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Kysely<DB>,
    @Inject(AI_QUEUE) private readonly queue: Queue,
  ) {}

  /** Baris `queued`. DI DALAM transaksi pemanggil. */
  async buat(trx: Transaction<DB>, p: BuatJobInput): Promise<string> {
    const row = await trx
      .insertInto('ai_jobs')
      .values({
        user_id: p.userId,
        kind: p.kind,
        status: 'queued',
        input: JSON.stringify(p.input),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  /**
   * SETELAH commit — aturan keras 10.
   *
   * ── `jobId` mencegah DUPLIKAT, dan diam-diam mencegah ANTRE ULANG ──
   *
   * `queue.add` dengan `jobId` yang sudah ada **tidak melempar dan tidak
   * membuat apa pun** — ia mengembalikan job lama apa adanya, termasuk
   * payload lamanya. Diverifikasi terhadap BullMQ sungguhan: `add` kedua
   * dengan id sama mengembalikan job dengan data dari `add` pertama.
   *
   * Itu perilaku yang kita INGINKAN selama job masih berjalan — ia yang
   * menahan pengantaran ganda, dan pengantaran ganda berarti **membayar LLM
   * dua kali** (`mulai()` menerima status `running` supaya job yang
   * worker-nya mati bisa diambil lagi, jadi ia tidak bisa menahannya sendiri).
   *
   * Tapi job yang sudah `completed`/`failed` masih DISIMPAN — `removeOnFail`
   * menahan 1.000 terakhir. Tanpa baris di bawah, meng-antre-ulang `ai_jobs`
   * yang gagal adalah no-op senyap: tidak ada galat, tidak ada job, dan
   * barisnya tetap `failed` selamanya. Itu persis yang akan dilakukan penyapu
   * job yatim di isu #131.
   *
   * Jadi: job yang SUDAH SELESAI dibuang dulu, job yang masih hidup
   * dibiarkan menahan duplikat.
   */
  async enqueue(jobId: string): Promise<void> {
    const lama = await this.queue.getJob(jobId);
    if (lama && ((await lama.isCompleted()) || (await lama.isFailed()))) {
      await lama.remove();
    }
    await this.queue.add('run', { jobId }, { ...OPSI_JOB_AI, jobId });
  }

  /**
   * `queued` → `running`, hanya kalau ia memang masih `queued` atau `running`.
   *
   * Mengembalikan `null` untuk job yang sudah `done`/`failed`: pengantaran
   * BullMQ at-least-once, jadi job yang sama bisa datang dua kali, dan
   * menjalankan ulang pekerjaan yang sudah selesai berarti **membayar LLM dua
   * kali** untuk hasil yang sudah ada.
   */
  async mulai(jobId: string): Promise<{ id: string; kind: AiJobKind; input: unknown } | null> {
    return (
      (await this.db
        .updateTable('ai_jobs')
        .set({ status: 'running' })
        .where('id', '=', jobId)
        .where('status', 'in', ['queued', 'running'])
        .returning(['id', 'kind', 'input'])
        .executeTakeFirst()) ?? null
    );
  }

  /**
   * Menyapu `ai_jobs` yang mengendap `running` — isu #131.
   *
   * ── Kenapa mereka bisa mengendap ──
   *
   * `AI-06` menghitung percobaan ulang di **BullMQ**, bukan di kolom
   * `ai_jobs.attempts` (keputusan Dev A, 23 Sep: dua sumber kebenaran untuk
   * satu angka pasti menyimpang saat proses mati di tengah). Konsekuensinya:
   * keadaan retry hidup di Redis, dan aturan keras 7 menyatakan Redis adalah
   * turunan yang boleh hilang. Kalau ia hilang saat sebuah job menunggu
   * jadwal percobaan berikutnya, job antreannya lenyap dan barisnya tertinggal
   * `running` **selamanya** — tidak muncul di laporan gagal karena statusnya
   * bukan `failed`, tidak muncul sebagai antre karena bukan `queued`.
   *
   * ── Ditandai `failed`, BUKAN diantrekan ulang ──
   *
   * Antre ulang otomatis terasa lebih membantu dan dua hal membuatnya salah
   * di sini:
   *
   * 1. **Tabel ini tidak punya `started_at`.** Yang ada `created_at` dan
   *    `completed_at`, jadi satu-satunya jam yang tersedia mengukur umur
   *    BARIS, bukan umur eksekusinya. Job yang lama mengantre lalu baru mulai
   *    berjalan tidak bisa dibedakan dari job yang mati di tengah.
   * 2. Karena itu, antre ulang berarti ada kemungkinan menjalankan job yang
   *    **sedang** berjalan — dan itu membayar LLM dua kali. `mulai()`
   *    melindungi `done`/`failed`, bukan `running`.
   *
   * Ditandai `failed` menyelesaikan keluhan #131 apa adanya: yang dikeluhkan
   * bukan "job tidak diulang" melainkan "job HILANG begitu saja". Baris
   * `failed` terlihat, terhitung `SA-03`, dan **bisa diantrekan ulang** —
   * jalur itu sudah ada dan sudah teruji.
   *
   * `AMBANG_MENGGANTUNG_MENIT = 30` dipilih jauh di atas eksekusi terpanjang
   * yang sah (§12.3 timeout 60 detik × 3 percobaan + backoff ≈ 5 menit), jadi
   * ketidaktepatan `created_at` tidak menyentuh job sehat. Angka yang sama
   * dengan `STALE_HOLD_MINUTES` reaper hold, dan itu disengaja: dua penyapu
   * dengan dua ambang berbeda akan membuat orang menebak yang mana berlaku.
   */
  async sapuMenggantung(): Promise<{ disapu: number }> {
    const r = await this.db
      .updateTable('ai_jobs')
      .set({
        status: 'failed',
        error_code: 'PROVIDER_UNAVAILABLE',
        error_message:
          `Job mengendap 'running' lebih dari ${AMBANG_MENGGANTUNG_MENIT} menit dan disapu ` +
          '(isu #131). Keadaan retry hidup di Redis dan kemungkinan hilang; ' +
          'job ini bisa diantrekan ulang.',
        completed_at: sql`now()`,
      })
      .where('status', '=', 'running')
      .where(
        'created_at',
        '<',
        sql<Date>`now() - ${sql.lit(AMBANG_MENGGANTUNG_MENIT)} * interval '1 minute'`,
      )
      .returning('id')
      .execute();

    if (r.length > 0) {
      this.log.warn(`${r.length} ai_job mengendap disapu jadi failed (isu #131)`);
    }
    return { disapu: r.length };
  }

  /** `done` + seluruh bidang biaya (§12.3, `CV-8`). */
  async selesai(jobId: string, hasil: AiRunResult): Promise<void> {
    await this.db
      .updateTable('ai_jobs')
      .set({
        status: 'done',
        output: JSON.stringify(hasil.output ?? null),
        model: hasil.model,
        prompt_version: hasil.promptVersion,
        input_tokens: hasil.inputTokens,
        output_tokens: hasil.outputTokens,
        // Dibulatkan di SINI, bukan dibiarkan Postgres yang melakukannya.
        //
        // Kejujuran soal ini: versi pertama komentar ini mengklaim `number`
        // kehilangan presisi lewat float ganda, dan sabotase membantahnya —
        // mengirim `0.000042` sebagai number menghasilkan baris yang sama
        // persis. Untuk seluruh rentang `numeric(10,6)`, `String(n)` memberi
        // desimal terpendek yang round-trip, dan Postgres membulatkannya ke
        // enam digit dengan hasil identik.
        //
        // Jadi ini KONVENSI, bukan perbaikan bug: di batas uang, pembulatan
        // yang terlihat di kode lebih mudah ditinjau daripada pembulatan yang
        // terjadi di dalam tipe kolom. Tidak ada test yang memerahkannya kalau
        // dicabut, dan itu sengaja tidak dibuat-buat.
        cost_usd: hasil.costUsd.toFixed(6),
        completed_at: sql`now()`,
      })
      .where('id', '=', jobId)
      .execute();
  }

  /**
   * `failed` — hanya dipanggil saat percobaan TERAKHIR habis.
   *
   * `kode` disimpan APA ADANYA di `error_code` (migrasi 009, isu #190), termasuk
   * kode di luar daftar TERTUTUP §10.2: ini kolom diagnosis, dan menyaringnya
   * di sini akan membuang justru informasi yang dicari saat mendiagnosis.
   * `undefined` kalau balasannya tidak berbentuk §10.1 — kegagalan jaringan
   * tidak punya badan respons, dan kolom yang diisi tebakan lebih buruk
   * daripada kolom kosong.
   */
  async gagal(jobId: string, pesan: string, kode?: string): Promise<void> {
    await this.db
      .updateTable('ai_jobs')
      .set({
        status: 'failed',
        error_message: pesan.slice(0, 1_000),
        error_code: kode ?? null,
        completed_at: sql`now()`,
      })
      .where('id', '=', jobId)
      .execute();
    this.log.warn(
      `ai_job ${jobId} berakhir gagal${kode === undefined ? '' : ` [${kode}]`}: ${pesan.slice(0, 200)}`,
    );
  }
}
