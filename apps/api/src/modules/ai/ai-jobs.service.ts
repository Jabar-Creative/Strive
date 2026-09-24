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

  /** SETELAH commit — aturan keras 10. */
  async enqueue(jobId: string): Promise<void> {
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

  /** `failed` — hanya dipanggil saat percobaan TERAKHIR habis. */
  async gagal(jobId: string, pesan: string): Promise<void> {
    await this.db
      .updateTable('ai_jobs')
      .set({
        status: 'failed',
        error_message: pesan.slice(0, 1_000),
        completed_at: sql`now()`,
      })
      .where('id', '=', jobId)
      .execute();
    this.log.warn(`ai_job ${jobId} berakhir gagal: ${pesan.slice(0, 200)}`);
  }
}
