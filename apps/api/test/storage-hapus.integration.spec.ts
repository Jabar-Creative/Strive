import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { StorageService, bucketDocuments, createS3FromEnv } from '../src/infra/storage';

/**
 * `StorageService.hapus` terhadap MinIO NYATA — isu #123.
 *
 * Diuji terhadap penyimpanan sungguhan, bukan tiruan, karena yang dijaga di
 * sini perilaku S3 dan bukan perilaku kodenya: **`DeleteObject` menjawab
 * sukses untuk kunci yang tidak ada.** Tiruan akan menjawab apa pun yang
 * kutulis, dan dari situ aku tidak belajar apa-apa.
 *
 * Idempotensi itu yang membuat penyapu retensi aman dijalankan ulang setelah
 * gagal separuh jalan — dan penyapu yang tidak aman dijalankan ulang adalah
 * penyapu yang orang ragu menjalankannya setelah insiden (pelajaran
 * `PartitionService`).
 */

let storage: StorageService;
let reachable = false;
const bucket = bucketDocuments();

beforeAll(async () => {
  storage = new StorageService(createS3FromEnv());
  try {
    await storage.exists(bucket, `probe-${randomUUID()}`);
    reachable = true;
  } catch {
    reachable = false;
  }
});

afterAll(() => undefined);

describe('StorageService.hapus (MinIO nyata)', () => {
  it('MinIO siap dipakai', () => {
    expect(reachable, `S3_ENDPOINT tidak bisa dipakai (bucket ${bucket})`).toBe(true);
  });

  it('objek yang ADA benar-benar hilang sesudahnya', async () => {
    if (!reachable) return;
    const key = `retensi-uji/${randomUUID()}.txt`;
    await storage.put({
      bucket,
      key,
      body: Buffer.from('skripsi rahasia'),
      contentType: 'text/plain',
    });
    expect(await storage.exists(bucket, key), 'ada sebelum dihapus').toBe(true);

    await storage.hapus(bucket, key);

    // Yang di-assert KEHILANGANNYA, bukan bahwa fungsinya selesai. Fungsi
    // hapus yang tidak melempar tapi tidak menghapus apa pun memuaskan test
    // yang hanya memanggilnya.
    expect(await storage.exists(bucket, key), 'hilang sesudahnya').toBe(false);
  });

  it('menghapus DUA KALI bukan galat — ini yang membuat penyapu bisa diulang', async () => {
    if (!reachable) return;
    const key = `retensi-uji/${randomUUID()}.txt`;
    await storage.put({ bucket, key, body: Buffer.from('x'), contentType: 'text/plain' });

    await storage.hapus(bucket, key);
    await expect(storage.hapus(bucket, key)).resolves.toBeUndefined();
    expect(await storage.exists(bucket, key)).toBe(false);
  });

  it('kunci yang TIDAK PERNAH ada juga bukan galat', async () => {
    if (!reachable) return;
    await expect(
      storage.hapus(bucket, `retensi-uji/tidak-pernah-ada-${randomUUID()}.txt`),
    ).resolves.toBeUndefined();
  });

  it('hanya kunci yang diminta yang hilang — tetangganya utuh', async () => {
    if (!reachable) return;
    // Tanpa ini, `hapus` yang salah menghitung prefiks (mis. menghapus
    // "folder") akan lulus seluruh test di atas.
    const dasar = `retensi-uji/${randomUUID()}`;
    const a = `${dasar}/a.txt`;
    const b = `${dasar}/b.txt`;
    await storage.put({ bucket, key: a, body: Buffer.from('a'), contentType: 'text/plain' });
    await storage.put({ bucket, key: b, body: Buffer.from('b'), contentType: 'text/plain' });

    await storage.hapus(bucket, a);

    expect(await storage.exists(bucket, a)).toBe(false);
    expect(await storage.exists(bucket, b), 'tetangganya tidak boleh ikut').toBe(true);
    await storage.hapus(bucket, b);
  });
});
