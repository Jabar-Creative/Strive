import { Global, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Queue } from 'bullmq';

import { AI_QUEUE, QUEUE, bullConnection } from './queues';

/**
 * Antrean BullMQ — PRD §8.1, §8.3 aturan 5.
 *
 * > `queue.add()` TIDAK PERNAH di dalam `db.transaction()` — enqueue setelah
 * > commit.
 *
 * Modul ini hanya menyediakan sisi PRODUSER (`Queue`). Sisi konsumen
 * (`Worker`) hidup di `MODE=worker`, karena proses API tidak boleh menarik job
 * yang berjalan menit-an — itu seluruh alasan keduanya dipisah (§8.2).
 *
 * ── `@Global()`, dan kenapa itu TIDAK berarti "terdaftar otomatis" ──
 *
 * Sama seperti `KyselyModule` dan `RedisModule`: global berarti *sekali
 * diimpor, terlihat di mana-mana* — bukan terdaftar sendiri. `AppModule` dan
 * `WorkerModule` tetap wajib mengimpornya masing-masing, dan `worker.module.spec.ts`
 * yang membuktikannya (isu #86: `MODE=worker` pernah gagal boot total justru
 * karena kekeliruan ini).
 */
@Global()
@Module({
  providers: [
    {
      provide: AI_QUEUE,
      useFactory: () => daftarkanAntrean(new Queue(QUEUE.ai, { connection: bullConnection() })),
    },
  ],
  exports: [AI_QUEUE],
})
export class BullmqModule implements OnApplicationShutdown {
  /**
   * Koneksi Redis milik `Queue` menahan proses tetap hidup. Tanpa penutupan
   * eksplisit, `app.close()` selesai tapi `node` tidak pernah keluar — pola
   * yang sama sudah menggigit di `RedisIoAdapter`.
   */
  async onApplicationShutdown(): Promise<void> {
    await Promise.allSettled(antreanTerbuka.map((q) => q.close()));
    antreanTerbuka.length = 0;
  }
}

/** Dicatat supaya bisa ditutup saat aplikasi berhenti. */
const antreanTerbuka: Queue[] = [];

/** Dipakai factory di atas; dipisah supaya daftar penutupannya satu tempat. */
export function daftarkanAntrean(q: Queue): Queue {
  antreanTerbuka.push(q);
  return q;
}
