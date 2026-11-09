import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Kysely } from 'kysely';

import { DATABASE, type DB } from '../../infra/kysely';
import { StorageService, bucketDocuments } from '../../infra/storage';
import { type AiRunResult, type BarisJobAi, type PenyelesaiJobAi } from '../ai';
import { CoinLedgerService } from '../wallet';

/**
 * Finalisasi job CV (AI-07) — penyedia token `PENYELESAI_JOB_AI` untuk kind
 * `ats_cv`. Dipanggil dispatcher (`AiDispatchService`) SETELAH baris `done`
 * dan biaya tercatat; hook yang melempar/timeout membalik baris jadi `failed`
 * dan hook `gagal` semua penyedia tetap dipanggil (kontrak multi-penyedia di
 * `penyelesai-job-ai.ts`).
 *
 * ── `sukses` wajib idempoten terhadap pengantaran ulang ──
 *
 * BullMQ at-least-once berarti hook ini BISA dipanggil dua kali untuk job yang
 * sama. Kunci idempotensinya `cv_documents.job_id`: baris yang sudah ada
 * membuat pemanggilan kedua hanya menyetel ulang (settle sendiri idempoten)
 * tanpa menulis duplikat. Tidak ada unique index di `job_id` (bentuk §9
 * terkunci), jadi penjaganya di level service — sama seperti pola "risiko
 * bersamaan yang diterima dan dicatat" pada replay PL-01.
 *
 * ── Urutan tulis: storage DULU, transaksi KEMUDIAN ──
 *
 * PDF diunggah sebelum transaksi supaya baris `cv_documents` tidak pernah
 * menunjuk objek yang belum ada. Kalau transaksi gagal setelah unggah, objek
 * yatim tersisa di bucket — diterima dan dicatat: membersihkannya butuh
 * sinkronisasi dua sumber, sedangkan objek yatim tidak pernah dibaca siapa
 * pun dan namanya (job id) membuatnya bisa disapu kapan pun.
 */
@Injectable()
export class CvFinalizeService implements PenyelesaiJobAi {
  readonly kind = 'ats_cv' as const;
  private readonly log = new Logger(CvFinalizeService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Kysely<DB>,
    private readonly coins: CoinLedgerService,
    private readonly storage: StorageService,
  ) {}

  async sukses(jobId: string, baris: BarisJobAi, hasil: AiRunResult): Promise<void> {
    const out = bacaOutputCv(hasil.output);

    // Idempoten: pengantaran ulang berhenti di baris yang sudah ada.
    const sudah = await this.db
      .selectFrom('cv_documents')
      .select('id')
      .where('job_id', '=', jobId)
      .executeTakeFirst();
    if (sudah) {
      await this.settle(baris.userId, jobId);
      return;
    }

    const pdf = Buffer.from(out.pdf_base64, 'base64');
    if (pdf.byteLength === 0) {
      throw new Error('pdf_base64 kosong dari layanan AI');
    }
    const key = `cvs/${jobId}.pdf`;
    await this.storage.put({
      bucket: bucketDocuments(),
      key,
      body: pdf,
      contentType: 'application/pdf',
    });

    await this.db.transaction().execute(async (trx) => {
      await trx
        .insertInto('cv_documents')
        .values({
          user_id: baris.userId,
          job_id: jobId,
          // `JSON.stringify` eksplisit — pola `AiJobsService.buat()`. Driver
          // pg men-serialisasi OBJEK ke JSON dengan benar, tapi ARRAY menjadi
          // literal array Postgres (`{...}`) yang bukan JSON sah, dan
          // `ats_findings` pasti berupa array temuan.
          structured: JSON.stringify(out.structured),
          ats_score: out.ats_score,
          ats_findings: JSON.stringify(out.ats_findings ?? []),
          pdf_key: key,
        })
        .execute();
      await this.coins.settle(trx, {
        userId: baris.userId,
        refType: 'ai_job',
        refId: jobId,
        note: 'AI-07: CV ATS selesai',
      });
    });
  }

  /**
   * Semua keadaan terminal tanpa hasil: percobaan habis, galat permanen,
   * finalisasi yang melempar, job mengendap yang disapu (#131). Aman dipanggil
   * TANPA `sukses` pernah berjalan — `release` mengembalikan `null` untuk hold
   * yang tidak ada, dan settle yang menyusul release tidak menggandakan apa pun
   * (titik serialisasi `users` FOR UPDATE di `CoinLedgerService`).
   */
  async gagal(jobId: string, baris: BarisJobAi): Promise<void> {
    try {
      await this.db.transaction().execute(async (trx) => {
        await this.coins.release(trx, {
          userId: baris.userId,
          refType: 'ai_job',
          refId: jobId,
          // Alasan GENERIK, bukan pesan vendor: note ledger tampil di riwayat
          // dompet pengguna (pola audit PL-01 T4). error_message mentah bisa
          // memuat gema input pengguna (audit AI-07 T5).
          reason: 'job CV gagal',
        });
      });
    } catch (err) {
      // Kontrak hook: melempar di sini tidak menjatuhkan worker, tapi diam
      // berarti hold menggantung sampai disapu — lebih baik terdengar.
      this.log.error(`gagal melepas hold job CV ${jobId}: ${String(err)}`);
      throw err;
    }
  }

  private async settle(userId: string, jobId: string): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      await this.coins.settle(trx, {
        userId,
        refType: 'ai_job',
        refId: jobId,
        note: 'AI-07: CV ATS selesai (pengantaran ulang)',
      });
    });
  }
}

/** Bagian `output` balasan `/v1/cv` yang dipakai finalisasi. */
interface OutputCv {
  structured: unknown;
  ats_score: number;
  ats_findings: unknown;
  pdf_base64: string;
}

/**
 * Pemeriksaan BENTUK sebelum menyentuh database — `bacaHasil` di klien hanya
 * memeriksa amplop (model, token, biaya); isi `output` adalah milik rute.
 * `ats_score` smallint dengan CHECK 0..100: nilai liar akan 500 di constraint,
 * dan itu terlihat seperti bug database padahal balasan vendor yang rusak.
 */
function bacaOutputCv(output: unknown): OutputCv {
  if (typeof output !== 'object' || output === null) {
    throw new Error('output CV bukan objek');
  }
  const b = output as Record<string, unknown>;
  if (typeof b['structured'] !== 'object' || b['structured'] === null) {
    throw new Error('output CV tanpa structured yang sah');
  }
  const skor = b['ats_score'];
  if (typeof skor !== 'number' || !Number.isInteger(skor) || skor < 0 || skor > 100) {
    throw new Error('output CV tanpa ats_score 0–100 yang sah');
  }
  if (typeof b['pdf_base64'] !== 'string' || b['pdf_base64'].length === 0) {
    throw new Error('output CV tanpa pdf_base64 yang sah');
  }
  return {
    structured: b['structured'],
    ats_score: skor,
    ats_findings: b['ats_findings'],
    pdf_base64: b['pdf_base64'],
  };
}
