import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { Worker, type Job } from 'bullmq';

import { QUEUE, bullConnection } from '../infra/bullmq';
import { AiJobsService } from '../modules/ai';
import { AI_SERVICE_CLIENT, type AiServiceClient, permanen } from '../modules/ai/ai-service.client';

interface DataJob {
  jobId?: unknown;
}

/**
 * Worker `ai-dispatch` — `AI-06`, PRD §8.1.
 *
 * > **Selesai berarti:** Biaya per model dan per pengguna terekam untuk panel
 * > admin. Job yang gagal 3× masuk status failed, **bukan menggantung**.
 *
 * ── Percobaan dihitung BullMQ, bukan kolom database ──
 *
 * `outbox_events` punya kolom `attempts` sendiri karena ia memang antrean
 * buatan tangan. `ai_jobs` tidak, dan tidak perlu: BullMQ sudah menyimpan
 * hitungan percobaan, jadwal backoff, dan riwayat kegagalan per job. Menambah
 * kolom kedua berarti dua sumber kebenaran untuk satu angka, dan yang satu
 * akan menyimpang saat proses mati di tengah.
 *
 * Konsekuensinya jujur: keadaan retry hidup di Redis, yang **turunan**
 * (aturan 7). Kalau Redis hilang, job yang sedang menunggu percobaan
 * berikutnya ikut hilang — dan barisnya tertinggal `running` selamanya. Itu
 * sebabnya `AI-06` belum lengkap tanpa penyapu job `running` yang tua; diangkat
 * sebagai isu, bukan dipura-purakan selesai.
 *
 * ── Kenapa `failed` ditulis di PERCOBAAN TERAKHIR, bukan di event `failed` ──
 *
 * Event `failed` worker berjalan di luar konteks job dan bisa terlewat saat
 * proses berhenti tepat di antaranya. Menulisnya di dalam processor — sebelum
 * melempar ulang — berarti status akhir tercatat dari tempat yang sama dengan
 * pekerjaannya.
 */
@Injectable()
export class AiDispatchService implements OnApplicationShutdown {
  private readonly log = new Logger(AiDispatchService.name);
  private worker?: Worker;

  constructor(
    private readonly jobs: AiJobsService,
    @Inject(AI_SERVICE_CLIENT) private readonly ai: AiServiceClient,
  ) {}

  /** Mulai menarik job. Hanya dipanggil di `MODE=worker`. */
  start(): Worker {
    if (this.worker) return this.worker;
    this.worker = new Worker(QUEUE.ai, (job) => this.proses(job), {
      connection: bullConnection(),
      concurrency: 2,
    });
    this.worker.on('error', (err) => {
      // Tanpa pendengar ini, galat koneksi Worker menjadi exception tak
      // tertangani dan mematikan seluruh proses worker.
      this.log.warn(`Worker antrean AI bermasalah: ${err.message}`);
    });
    return this.worker;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
    this.worker = undefined;
  }

  /** Dipisah dari `start()` supaya bisa diuji tanpa antrean. */
  async proses(job: Job<DataJob>): Promise<void> {
    const jobId = job.data?.jobId;
    if (typeof jobId !== 'string' || jobId.length === 0) {
      // Tidak ada yang bisa ditandai gagal — barisnya tidak diketahui. Jangan
      // diulang: data job tidak akan berubah kalau dicoba lagi.
      this.log.error(`Job antrean AI tanpa jobId yang sah: ${JSON.stringify(job.data)}`);
      return;
    }

    const baris = await this.jobs.mulai(jobId);
    if (!baris) {
      // Sudah `done`/`failed`. Pengantaran at-least-once, dan menjalankan
      // ulang berarti membayar LLM dua kali untuk hasil yang sudah ada.
      this.log.log(`ai_job ${jobId} dilewati — statusnya bukan lagi antre`);
      return;
    }

    try {
      const hasil = await this.ai.run({ jobId, kind: baris.kind, input: baris.input });
      await this.jobs.selesai(jobId, hasil);
    } catch (err) {
      const pesan = err instanceof Error ? err.message : String(err);
      const habis = this.terakhir(job) || permanen(err);

      if (habis) {
        await this.jobs.gagal(jobId, pesan);
      } else {
        this.log.warn(`ai_job ${jobId} gagal percobaan ${job.attemptsStarted}: ${pesan}`);
      }
      // Dilempar ulang APA PUN keadaannya, supaya BullMQ mencatat kegagalannya
      // dan menjadwalkan ulang kalau masih ada jatah. Menelannya akan membuat
      // job terlihat sukses di antrean sementara barisnya `failed`.
      throw err;
    }
  }

  /**
   * `true` kalau percobaan ini yang terakhir.
   *
   * `attemptsStarted` menghitung percobaan yang sedang berjalan (1 pada yang
   * pertama). Semantik ini yang paling mudah salah dipahami di BullMQ —
   * `attemptsMade` berarti hal berbeda — jadi yang menjaganya bukan pembacaan
   * dokumentasi melainkan test yang menghitung baris `failed` setelah tiga
   * kegagalan sungguhan.
   */
  private terakhir(job: Job): boolean {
    const maks = job.opts.attempts ?? 1;
    return job.attemptsStarted >= maks;
  }
}
