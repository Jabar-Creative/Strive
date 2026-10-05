import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Queue } from 'bullmq';
import { Kysely } from 'kysely';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { QUEUE, bullConnection, createBullConnection } from '../src/infra/bullmq';
import { createDatabase, type DB } from '../src/infra/kysely';
import { JADWAL, PenjadwalService, WorkerModule } from '../src/workers';

/**
 * Job berkala benar-benar TERDAFTAR saat `MODE=worker` boot — isu #203.
 *
 * `worker-boot.integration.spec.ts` membuktikan antrean `ai` punya konsumen.
 * Berkas ini menutup kelas yang SAMA untuk tujuh job sisanya — yang ternyata
 * nol-nya pernah dipanggil di produksi: `bootstrapWorker()` hanya membangun
 * konteks aplikasi, dan satu-satunya yang menyalakan dirinya sendiri adalah
 * `AiDispatchService` (lewat #138).
 *
 * `init()`, bukan `compile()`: `onApplicationBootstrap` hanya jalan di
 * `init()`, dan justru hook itu jawabannya. Dan `get()` providernya, bukan
 * cuma `init()`: kompilasi bisa lolos sementara resolusi DI baru gagal saat
 * provider dipakai (isu #86) — `PenjadwalService` menyuntik TUJUH service dari
 * empat modul berbeda, jadi ia pemicu yang paling mungkin menemukan kabel
 * yang hilang.
 */

const URL_DEV = 'postgres://strive:strive_dev_only@localhost:55432/strive';
const url = process.env['DATABASE_URL_TEST'] ?? process.env['DATABASE_URL'] ?? URL_DEV;
const redisUrl = process.env['REDIS_URL'] ?? 'redis://127.0.0.1:56379';

let db: Kysely<DB>;
let queue: Queue;
let ctx: INestApplicationContext | undefined;
let reachable = false;

beforeAll(async () => {
  db = createDatabase(url);
  queue = new Queue(QUEUE.jadwal, { connection: bullConnection(redisUrl) });
  const probe = createBullConnection(redisUrl);
  try {
    await db.selectFrom('users').select('id').limit(1).execute();
    await probe.ping();
    reachable = true;
  } catch {
    reachable = false;
  }
  await probe.quit();
});

afterEach(async () => {
  if (ctx) {
    await ctx.close();
    ctx = undefined;
  }
});

afterAll(async () => {
  if (reachable) await queue.obliterate({ force: true }).catch(() => undefined);
  await queue.close();
  await db.destroy();
});

async function bootWorker(): Promise<INestApplicationContext> {
  const modul = await Test.createTestingModule({ imports: [WorkerModule] }).compile();
  // `init()` — hook lifecycle hanya jalan di sini.
  return modul.init();
}

describe('PenjadwalService terhadap Redis + PostgreSQL nyata (isu #203)', () => {
  it('lingkungan siap', () => {
    expect(reachable, `DATABASE_URL/REDIS_URL tidak bisa dipakai (${url})`).toBe(true);
  });

  it('daftar JADWAL tidak kosong — kalau nol, seluruh berkas ini hampa', () => {
    expect(JADWAL.length).toBeGreaterThan(0);
  });

  it('setiap job punya irama positif dan ALASAN tertulis', () => {
    // Angka yang ditulis tanpa alasan akan disetel ulang orang berikutnya
    // dengan alasan yang juga tidak tertulis.
    for (const j of JADWAL) {
      expect(j.setiapMs, j.id).toBeGreaterThan(0);
      expect(j.alasan.length, `${j.id} tanpa alasan`).toBeGreaterThan(40);
    }
  });

  it('id-nya unik — dua entri dengan id sama saling menimpa di Redis tanpa galat', () => {
    expect(new Set(JADWAL.map((j) => j.id)).size).toBe(JADWAL.length);
  });

  it('boot MODE=worker mendaftarkan KETUJUH job — ini yang dulu nol', async () => {
    if (!reachable) return;
    await queue.obliterate({ force: true }).catch(() => undefined);

    ctx = await bootWorker();
    // Resolusi DI: `PenjadwalService` menyuntik tujuh service dari empat modul.
    const penjadwal = ctx.get(PenjadwalService);
    expect(penjadwal).toBeInstanceOf(PenjadwalService);

    await penjadwal.daftarkan();

    const terdaftar = (await queue.getJobSchedulers()).map((s) => s.key);
    for (const j of JADWAL) {
      expect(terdaftar, `${j.id} tidak terdaftar`).toContain(j.id);
    }
  }, 40_000);

  it('BOOT SENDIRI yang mendaftarkan — tanpa satu pun panggilan manual', async () => {
    if (!reachable) return;
    await queue.obliterate({ force: true }).catch(() => undefined);

    // INI test yang sebenarnya menjaga isu #203, dan test di atasnya TIDAK.
    // Yang di atas memanggil `daftarkan()` sendiri, jadi ia membuktikan
    // fungsinya bekerja — persis kekeliruan yang membuat `AI-06` lulus
    // sementara antrean `ai` tidak punya konsumen di produksi: test-nya
    // membuat `Worker`-nya sendiri.
    //
    // Di sini NOL panggilan manual. Satu-satunya yang terjadi adalah `init()`.
    ctx = await bootWorker();

    const terdaftar = (await queue.getJobSchedulers()).map((s) => s.key);
    expect(terdaftar).toHaveLength(JADWAL.length);
    for (const j of JADWAL) {
      expect(terdaftar, `${j.id} tidak terdaftar oleh boot`).toContain(j.id);
    }
  }, 40_000);

  it('boot dua kali TIDAK menggandakan jadwal — upsert, bukan add', async () => {
    if (!reachable) return;
    await queue.obliterate({ force: true }).catch(() => undefined);

    ctx = await bootWorker();
    const penjadwal = ctx.get(PenjadwalService);
    await penjadwal.daftarkan();
    await penjadwal.daftarkan();
    await penjadwal.daftarkan();

    // Aturan keras 7: jadwalnya hidup di Redis dan boleh hilang, jadi boot
    // membangunnya kembali SETIAP kali. Kalau pendaftarannya `add` alih-alih
    // `upsert`, tiap restart menambah satu jadwal lagi — dan `reconcile`
    // mulai jalan dua, tiga, empat kali sehari tanpa ada yang mengubah apa pun.
    expect((await queue.getJobSchedulers()).length).toBe(JADWAL.length);
  }, 40_000);

  it('jadwal BASI dibuang — job hantu tidak boleh selamat dari perubahan kode', async () => {
    if (!reachable) return;
    await queue.obliterate({ force: true }).catch(() => undefined);

    // Jadwal dari "versi lama": namanya tidak ada lagi di JADWAL.
    await queue.upsertJobScheduler('job-yang-sudah-dihapus', { every: 60_000 });

    // NOL panggilan manual lagi: boot sendiri yang menyapunya. Versi pertama
    // test ini memanggil `daftarkan()` lalu meng-assert nilai kembaliannya —
    // dan ia merah, karena boot SUDAH membuang hantunya lebih dulu dan
    // panggilan kedua tidak punya apa pun untuk dibuang. Perilakunya benar;
    // ekspektasinya yang salah. Yang dijaga keadaan AKHIR, bukan siapa yang
    // menyapunya.
    ctx = await bootWorker();

    const terdaftar = (await queue.getJobSchedulers()).map((s) => s.key);
    expect(terdaftar).not.toContain('job-yang-sudah-dihapus');
    expect(terdaftar).toHaveLength(JADWAL.length);
  }, 40_000);

  it('setiap id di JADWAL punya handler — nama asing dilewati, bukan menjatuhkan worker', async () => {
    if (!reachable) return;
    ctx = await bootWorker();
    const penjadwal = ctx.get(PenjadwalService);

    // Yang dijaga: `jalankan()` mengembalikan SESUATU untuk tiap id yang
    // dijadwalkan. Peta-nya `Record<IdJadwal, …>` jadi kelengkapannya
    // ditegakkan `tsc`; ini menangkap kasus sebaliknya — id di JADWAL yang
    // tidak pernah masuk union-nya.
    for (const j of JADWAL) {
      await expect(penjadwal.jalankan(j.id)).resolves.not.toBeUndefined();
    }
    await expect(penjadwal.jalankan('bukan-job')).resolves.toBeUndefined();
  }, 60_000);
});
