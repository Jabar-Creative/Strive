import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Worker, type Job } from 'bullmq';

import { QUEUE, bullConnection } from '../infra/bullmq';
import { AiJobsService, PENYELESAI_JOB_AI, type BarisJobAi } from '../modules/ai';
import {
  AI_SERVICE_CLIENT,
  type AiRunResult,
  type AiServiceClient,
  kodeGalat,
  permanen,
} from '../modules/ai/ai-service.client';
import type { PenyelesaiJobAi } from '../modules/ai/penyelesai-job-ai';

interface DataJob {
  jobId?: unknown;
}

/**
 * Batas satu panggilan hook finalisasi — audit AI-07, T3.
 *
 * Hook berjalan di slot worker (`concurrency: 2`): dua hook yang promise-nya
 * tak pernah selesai mematikan SELURUH antrean `ai` tanpa satu galat pun.
 * Layanan AI sendiri sudah berbatas waktu (§12.3, 60 detik per percobaan di
 * klien); hook-lah satu-satunya pemanggilan tak berpagar sebelumnya. 30 detik:
 * hook menulis objek ke storage lalu SATU transaksi Postgres — jauh di bawah
 * ambang penyapu `running` (30 menit), jadi tidak berebutan dengan sapuan.
 */
export const BATAS_HOOK_MS = 30_000;

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
 * ── Ia menyalakan dirinya sendiri, dan itu bukan kemalasan ──
 *
 * Versi pertama hanya punya `start()` — dan **tidak ada yang memanggilnya**.
 * `bootstrapWorker()` cuma membangun konteks aplikasi; antrean `ai` berdiri
 * tanpa satu pun konsumen, dan setiap `ai_jobs` mengendap `queued` selamanya
 * tanpa galat. Test `AI-06` lulus karena ia membuat `Worker` BullMQ-nya
 * sendiri — pola "hijau tapi rusak saat dijalankan" yang keempat di repo ini.
 *
 * `onApplicationBootstrap` menutupnya secara struktural: selama kelas ini ada
 * di `WorkerModule`, ia hidup. Tidak ada baris di `main.ts` yang bisa lupa
 * ditulis, dan kelas ini tidak pernah masuk `AppModule` — jadi `MODE=api`
 * tetap tidak menarik job.
 *
 * ── Kenapa `failed` ditulis di PERCOBAAN TERAKHIR, bukan di event `failed` ──
 *
 * Event `failed` worker berjalan di luar konteks job dan bisa terlewat saat
 * proses berhenti tepat di antaranya. Menulisnya di dalam processor — sebelum
 * melempar ulang — berarti status akhir tercatat dari tempat yang sama dengan
 * pekerjaannya.
 */
@Injectable()
export class AiDispatchService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger(AiDispatchService.name);
  private worker?: Worker;

  /**
   * Batas hook per panggilan — properti, bukan parameter konstruktor, supaya
   * test bisa memendekkannya tanpa membuat Nest mencoba menyuntik `number`
   * (kegagalan resolusi DI kelas isu #86).
   */
  batasHookMs = BATAS_HOOK_MS;

  constructor(
    private readonly jobs: AiJobsService,
    @Inject(AI_SERVICE_CLIENT) private readonly ai: AiServiceClient,
    // AI-07: finalisasi per kind. `@Optional()` — tanpa pendaftar pun worker
    // tetap boot; diuji langsung dengan konstruksi manual di spec dispatcher.
    @Optional()
    @Inject(PENYELESAI_JOB_AI)
    private readonly penyelesai: PenyelesaiJobAi[] = [],
  ) {}

  /**
   * Dipanggil Nest saat konteks selesai di-init — termasuk
   * `createApplicationContext` di `bootstrapWorker()`.
   */
  onApplicationBootstrap(): void {
    this.start();
  }

  /** Mulai menarik job. Hanya hidup di `MODE=worker`. */
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

  /**
   * Menyapu job yang mengendap LALU memanggil hook `gagal` per baris —
   * audit AI-07, T1.
   *
   * `sapuMenggantung()` menulis `failed` sendiri, dan sebelum method ini
   * baris yang disapu TIDAK pernah menyentuh hook apa pun. Akibatnya hold
   * koin `ref_type='ai_job'` pada job itu menggantung PERMANEN: reaper hold
   * KL-8 hanya mengenal ref `scan`. Pemanggilnya penjadwal (`ai-reaper`),
   * jadi sapuan berjalan di irama yang sama dengan penulisan `failed`-nya —
   * tidak ada jendela di mana baris sudah `failed` tapi hold-nya belum
   * dilepas.
   *
   * Kegagalan satu hook tidak menghentikan sisanya (`panggilGagal`
   * non-throwing), dan method ini sendiri tidak melempar — penyapu berkala
   * yang melempar hanya memutus iramanya sendiri.
   */
  async sapu(): Promise<number> {
    const baris = await this.jobs.sapuMenggantung();
    for (const b of baris) {
      await this.panggilGagal(b.id, b);
    }
    return baris.length;
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
      await this.finalisasi(jobId, baris, hasil);
    } catch (err) {
      const pesan = err instanceof Error ? err.message : String(err);
      const habis = this.terakhir(job) || permanen(err);

      if (habis) {
        await this.jobs.gagal(jobId, pesan, kodeGalat(err));
        await this.panggilGagal(jobId, baris);
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

  /**
   * `Promise.race` terhadap batas waktu — audit AI-07, T3.
   *
   * Race menempelkan penanganannya pada janji ASLI, jadi penolakan yang
   * datang SETELAH batas (hook akhirnya melempar di menit ke-2) tetap
   * terserap oleh race dan tidak menjadi `unhandledRejection`. Timer
   * dibersihkan di `finally` supaya tidak menyalakan penolakannya setelah
   * janji selesai normal.
   *
   * Janji yang kalah race TIDAK dibatalkan — tidak ada cara membatalkan
   * janji JavaScript. Hook yang menggantung tetap menggantung di memorinya
   * sendiri; yang dijaga adalah SLOT WORKER-NYA kembali.
   */
  private denganBatas<T>(janji: Promise<T>, label: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const kehabisan = new Promise<never>((_, tolak) => {
      timer = setTimeout(
        () => tolak(new Error(`${label} tidak selesai dalam ${this.batasHookMs} ms`)),
        this.batasHookMs,
      );
    });
    return Promise.race([janji, kehabisan]).finally(() => clearTimeout(timer));
  }

  /**
   * Efek samping setelah baris `done` — AI-07.
   *
   * `jobs.selesai()` ditulis DULU (biaya, output, model): itu yang membuat
   * job tercatat tuntas meskipun finalisasinya gagal. Hook yang melempar
   * atau tidak pernah selesai (`denganBatas`, T3) menjadikan baris `failed`
   * TANPA rethrow — `mulai()` hanya menerima
   * `queued`/`running`, jadi pengantaran ulang BullMQ akan melewatinya;
   * rethrow hanya menambah percobaan senyap tanpa pernah menjalankan LLM
   * lagi (membayarnya dua kali justru yang dijaga).
   *
   * Hook `gagal` tetap dipanggil setelahnya: baris gagal mem-finalisasi
   * adalah kegagalan yang sah untuk dibersihkan (mis. lepas hold).
   */
  private async finalisasi(jobId: string, baris: BarisJobAi, hasil: AiRunResult): Promise<void> {
    for (const p of this.penyelesai) {
      if (p.kind !== baris.kind || !p.sukses) continue;
      try {
        await this.denganBatas(p.sukses(jobId, baris, hasil), 'Hook sukses');
      } catch (err) {
        const pesan = err instanceof Error ? err.message : String(err);
        this.log.error(`Finalisasi ai_job ${jobId} gagal: ${pesan}`);
        await this.jobs.gagal(jobId, `Finalisasi gagal: ${pesan}`, kodeGalat(err));
        await this.panggilGagal(jobId, baris);
        return;
      }
    }
  }

  /** Hook `gagal` tidak boleh melempar — kegagalannya (termasuk menggantung) hanya dicatat. */
  private async panggilGagal(jobId: string, baris: BarisJobAi): Promise<void> {
    for (const p of this.penyelesai) {
      if (p.kind !== baris.kind || !p.gagal) continue;
      try {
        await this.denganBatas(p.gagal(jobId, baris), 'Hook gagal');
      } catch (err) {
        this.log.warn(
          `Hook gagal ai_job ${jobId} sendiri melempar: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }
}
