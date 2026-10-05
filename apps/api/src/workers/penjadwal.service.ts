import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { type Job, type Queue, Worker } from 'bullmq';

import { JADWAL_QUEUE, QUEUE, bullConnection } from '../infra/bullmq';
import { ScanService } from '../modules/scan';
import { LeagueRollupService } from './league-rollup.service';
import { MetricsService } from './metrics.service';
import { OutboxWorkerService } from './outbox.service';
import { PartitionService } from './partition.service';
import { ReconcileBalanceService } from './reconcile-balance.service';
import { StreakWarningService } from './streak-warning.service';

/**
 * Penjadwal job berkala — isu #203.
 *
 * ── Kenapa ini ada, dan apa yang sebelumnya terjadi tanpanya ──
 *
 * `bootstrapWorker()` melakukan tepat dua hal: membangun konteks aplikasi, lalu
 * mencatat "Worker pool hidup". Jadi **tujuh** job berkala berdiri lengkap,
 * teruji, dan ditandai `done` di papan — tanpa satu pun yang pernah dipanggil
 * di produksi. `AiDispatchService` satu-satunya yang menyala, lewat #138.
 *
 * Akibatnya bukan "satu fitur belum jalan":
 *
 * - `outbox` yang tidak terkuras membuat **aturan keras 6 jadi hiasan** — pola
 *   yang diwajibkan seluruh repo ini (tulis `outbox_events` di dalam
 *   transaksi, kerjakan SETELAH commit) tidak punya separuh kedua. Poin squad
 *   tidak sampai ke ZSET, `score.updated` tidak terbit, notifikasi tidak
 *   terkirim.
 * - `reaper` yang tidak jalan membuat **jaring aturan keras 4** (hold
 *   menggantung > 30 menit dilepas) tidak ada.
 * - `partition` yang tidak jalan punya TANGGAL: partisi `lesson_attempts` habis
 *   2027-03-01, dan insert di luar rentang GAGAL.
 * - `reconcile-balance` yang tidak jalan membuat penyimpangan
 *   `users.coin_balance` terhadap `SUM(coin_ledger.amount)` tanpa pendeteksi.
 *
 * ── Kenapa BullMQ, bukan `@nestjs/schedule` atau cron platform ──
 *
 * Keputusan Dev A, 5 Okt (isu #203, opsi a). `@nestjs/schedule` menaruh jadwal
 * di memori proses, jadi DUA instance worker menjalankan tiap job **dua kali**
 * — dan `reconcile-balance` serta `league-rollup` adalah dua tempat yang paling
 * tidak boleh dobel. Cron platform memindahkan jadwal jadi keadaan dashboard
 * yang tidak terlihat dari repo, kelas yang sama dengan isu #155.
 *
 * BullMQ sudah dipakai `AI-06`, jadi nol dependensi baru, dan Job Scheduler-nya
 * menjamin satu eksekusi per jadwal **lintas instance** — itu yang sebenarnya
 * dibeli di sini, bukan kerapian.
 *
 * ── Pendaftaran idempoten, dan pembersihan jadwal basi ──
 *
 * `upsertJobScheduler` idempoten per `id`, jadi boot berulang tidak
 * menggandakan apa pun. Yang TIDAK ditanganinya: jadwal yang namanya atau
 * irama-nya berubah meninggalkan entri lama hidup di Redis selamanya — job
 * hantu yang tidak ada lagi di kode dan tetap berjalan. Karena itu
 * `getJobSchedulers()` disisir dan yang tidak ada di `JADWAL` dibuang.
 *
 * Aturan keras 7 tetap berlaku: jadwalnya hidup di Redis dan boleh hilang.
 * Yang membangunnya kembali adalah boot berikutnya — jadi pendaftarannya WAJIB
 * di `onApplicationBootstrap`, bukan di skrip yang dijalankan sekali.
 */

/** Satu job berkala: id stabil, irama, dan alasan iramanya. */
interface JobBerkala {
  id: IdJadwal;
  /** Milidetik antar-jalan. */
  setiapMs: number;
  /** Kenapa irama ini, bukan yang lain. */
  alasan: string;
}

/**
 * Id job berkala — ditulis sebagai union, bukan `string`.
 *
 * Itu yang membuat `PETA` di bawah bisa bertipe `Record<IdJadwal, …>`, dan
 * dengan begitu **job baru tanpa handler memerahkan `tsc`** alih-alih
 * mengantre selamanya tanpa pemroses. Pola yang sama dengan
 * `Record<CoinEntryType, …>` di `C-03`: kalau kompiler bisa menolaknya,
 * jangan serahkan ke peringatan runtime.
 */
export type IdJadwal =
  | 'outbox'
  | 'reaper-hold'
  | 'streak-warning'
  | 'league-rollup'
  | 'metrics'
  | 'partition'
  | 'reconcile-balance';

const DETIK = 1_000;
const MENIT = 60 * DETIK;
const JAM = 60 * MENIT;

/**
 * Daftar job berkala — SATU tempat, dan irama masing-masing punya alasan.
 *
 * Angka yang ditulis tanpa alasan akan disetel ulang orang berikutnya dengan
 * alasan yang juga tidak tertulis.
 */
export const JADWAL: readonly JobBerkala[] = [
  {
    id: 'outbox',
    setiapMs: 5 * DETIK,
    alasan:
      'Jalur realtime. Fallback polling RT-5 enam kali lebih lambat (30 detik), ' +
      'jadi outbox yang lebih lambat dari itu membuat WS kalah dari fallback-nya sendiri.',
  },
  {
    id: 'reaper-hold',
    setiapMs: 5 * MENIT,
    alasan:
      'Hold dilepas setelah STALE_HOLD_MINUTES = 30. Lima menit berarti ' +
      'deteksi <= 35 menit — selisih yang tidak terasa bagi pengguna, dan ' +
      'query-nya satu indeks.',
  },
  {
    id: 'streak-warning',
    setiapMs: 1 * JAM,
    alasan:
      'S-04 memilih pengguna yang SAAT INI pukul 20.00 di zonanya sendiri, ' +
      'dan zona waktu dunia bergeser per jam. Lebih jarang berarti ada zona ' +
      'yang terlewat; lebih sering tidak menambah siapa pun.',
  },
  {
    id: 'league-rollup',
    setiapMs: 1 * JAM,
    alasan:
      'Musim mingguan, dan `seasonsSiapDitutup` idempoten. Per jam membuat ' +
      'penutupan terlambat paling lama satu jam setelah musim berakhir, tanpa ' +
      'perlu jadwal yang tahu kapan musimnya berakhir.',
  },
  {
    id: 'metrics',
    setiapMs: 15 * MENIT,
    alasan:
      'SA-03 memberi makan papan kesehatan integrasi. Lima belas menit cukup ' +
      'untuk alarm yang dibaca manusia, dan tidak membuat `ai_jobs` di-scan ' +
      'tiap menit.',
  },
  {
    id: 'partition',
    setiapMs: 24 * JAM,
    alasan:
      'HARIAN, bukan bulanan seperti yang tertulis di F-12 — dan itu disengaja. ' +
      'Job-nya idempoten, dan satu jalan bulanan yang GAGAL berarti tiga puluh ' +
      'hari diam sebelum ada kesempatan kedua. WARN_DAYS = 30, jadi alarmnya ' +
      'hanya berguna kalau ada yang memeriksanya lebih sering daripada ambangnya.',
  },
  {
    id: 'reconcile-balance',
    setiapMs: 24 * JAM,
    alasan:
      'C-04 menyebutnya job rekonsiliasi HARIAN. Ia hanya MEMBACA, jadi ' +
      'menjalankannya lebih sering tidak memperbaiki apa pun lebih cepat — ' +
      'yang memperbaiki adalah manusia yang membaca barisnya.',
  },
] as const;

@Injectable()
export class PenjadwalService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger(PenjadwalService.name);
  private worker?: Worker;

  constructor(
    @Inject(JADWAL_QUEUE) private readonly queue: Queue,
    private readonly outbox: OutboxWorkerService,
    private readonly scan: ScanService,
    private readonly streak: StreakWarningService,
    private readonly league: LeagueRollupService,
    private readonly metrics: MetricsService,
    private readonly partition: PartitionService,
    private readonly reconcile: ReconcileBalanceService,
  ) {}

  /**
   * Satu job -> satu pemanggilan, dan `Record<IdJadwal, …>` yang memaksanya
   * lengkap. Menambah entri ke `JADWAL` tanpa handler-nya **tidak akan
   * dikompilasi** — bukan menghasilkan job yang mengantre tanpa pemroses.
   */
  private peta(): Record<IdJadwal, () => Promise<unknown>> {
    return {
      outbox: () => this.outbox.runOnce(),
      'reaper-hold': () => this.scan.releaseStale(),
      'streak-warning': () => this.streak.run(),
      'league-rollup': () => this.league.run(),
      metrics: () => this.metrics.runOnce(),
      partition: () => this.partition.run(),
      'reconcile-balance': () => this.reconcile.run(),
    };
  }

  /** Dipakai `Worker` dan test. Nama asing dilewati, bukan menjatuhkan worker. */
  async jalankan(id: string): Promise<unknown> {
    const fn = this.peta()[id as IdJadwal];
    if (!fn) {
      // Bisa berasal dari jadwal versi lama yang belum tersapu — bukan alasan
      // menjatuhkan penjadwalnya.
      this.log.warn(`Job berkala tidak dikenali, dilewati: ${id}`);
      return undefined;
    }
    return fn();
  }

  /**
   * `async`, dan `daftarkan()` di-AWAIT — bukan `void`.
   *
   * Versi pertama menembakkannya tanpa menunggu, dan itu membuat `init()`
   * selesai sebelum satu jadwal pun terdaftar. Akibatnya bukan cuma test yang
   * berlomba: boot yang dilaporkan sukses sementara pendaftarannya masih
   * berjalan — dan kalau ia menolak, tidak ada apa pun yang tahu.
   */
  async onApplicationBootstrap(): Promise<void> {
    this.worker = new Worker(
      QUEUE.jadwal,
      (job: Job) => this.jalankan(job.name),
      // `concurrency: 1` — job berkala di sini tidak saling bergantung, tapi
      // dua `outbox` yang tumpang tindih akan berebut baris yang sama lewat
      // `SKIP LOCKED` tanpa menambah throughput.
      { connection: bullConnection(), concurrency: 1 },
    );

    // Kegagalan satu job TIDAK boleh menjatuhkan penjadwalnya: `reconcile`
    // yang gagal karena Postgres tersendat tidak boleh menghentikan `outbox`.
    this.worker.on('failed', (job, err) => {
      this.log.error(`Job berkala ${job?.name ?? '?'} gagal: ${err.message}`);
    });

    await this.daftarkan();
  }

  /**
   * Mendaftarkan seluruh `JADWAL` dan membuang jadwal yang tidak ada lagi.
   *
   * Dipisah dari `onApplicationBootstrap` supaya bisa diuji tanpa menunggu
   * irama apa pun — pola yang sama dengan `runOnce()` di worker lain dan
   * `verifikasiUlang()` di gateway WS.
   */
  async daftarkan(): Promise<{ didaftarkan: number; dibuang: string[] }> {
    for (const j of JADWAL) {
      await this.queue.upsertJobScheduler(j.id, { every: j.setiapMs }, { name: j.id });
    }

    const dikenal: Set<string> = new Set(JADWAL.map((j) => j.id));
    const dibuang: string[] = [];
    for (const s of await this.queue.getJobSchedulers()) {
      const id = s.key;
      if (typeof id === 'string' && !dikenal.has(id)) {
        await this.queue.removeJobScheduler(id);
        dibuang.push(id);
      }
    }
    if (dibuang.length > 0) {
      this.log.warn(`Jadwal basi dibuang: ${dibuang.join(', ')}`);
    }

    this.log.log(`${JADWAL.length} job berkala terdaftar`);
    return { didaftarkan: JADWAL.length, dibuang };
  }

  async onApplicationShutdown(): Promise<void> {
    // Worker yang selamat dari shutdown menumpuk satu per restart — jebakan
    // yang sudah tercatat untuk `AiDispatchService`.
    await this.worker?.close();
    this.worker = undefined;
  }
}
