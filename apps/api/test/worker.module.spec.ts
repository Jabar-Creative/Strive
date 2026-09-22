import { describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';

import {
  LeagueRollupService,
  OutboxWorkerService,
  PartitionService,
  WorkerModule,
} from '../src/workers';

/**
 * `MODE=worker` adalah SEPARUH deployment — PRD §8.1, "satu image, dua peran".
 *
 * Sebelum test ini ada, `app.module.spec.ts` membangun `AppModule` dan tidak
 * ada apa pun yang membangun `WorkerModule`. Akibatnya nyata dan ditemukan
 * saat `K-02`: `MODE=worker` **gagal boot sama sekali** karena `WorkerModule`
 * tidak mengimpor `KyselyModule` — `@Global()` berarti "sekali diimpor,
 * terlihat di mana-mana", bukan "terdaftar otomatis".
 *
 * Pipeline penuh hijau selama itu. Satu-satunya cara menangkapnya adalah
 * menjalankan `node dist/main.js` dengan `MODE=worker`, dan tidak ada yang
 * melakukannya (isu #86).
 */
describe('WorkerModule', () => {
  it('bisa di-instantiate — MODE=worker harus bisa boot', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [WorkerModule] }).compile();

    // Satu provider diambil sungguhan, bukan cuma `compile()`: kompilasi bisa
    // lolos sementara resolusi dependensi baru gagal saat provider dipakai.
    expect(moduleRef.get(PartitionService)).toBeInstanceOf(PartitionService);
    // Provider KEDUA, ditambahkan bersama `Q-04`: satu provider yang bisa
    // diambil tidak membuktikan yang lain bisa. `StorageModule` dulu ketahuan
    // hilang persis begitu — lewat provider yang belum pernah diambil.
    expect(moduleRef.get(LeagueRollupService)).toBeInstanceOf(LeagueRollupService);
    // `Q-03` mengimpor `LeagueModule` — modul BARU di WorkerModule. Kelas
    // kesalahan yang sama dengan isu #86: diambil, bukan cuma dikompilasi.
    expect(moduleRef.get(OutboxWorkerService)).toBeInstanceOf(OutboxWorkerService);
    await moduleRef.close();
  });
});
