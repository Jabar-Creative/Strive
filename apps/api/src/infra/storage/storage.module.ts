import { Global, Module } from '@nestjs/common';

import { S3, StorageService, createS3FromEnv } from './storage.service';

/**
 * Object storage S3-compatible (MinIO di dev) — docs/PRD.md §12.6, item `K-01`.
 *
 * Akses HANYA lewat signed URL 15 menit. **Tidak ada bucket publik untuk
 * dokumen pengguna** — isinya skripsi yang belum disidangkan.
 *
 * `@Global()` dengan alasan yang sama seperti `KyselyModule`: storage dipakai
 * modul `scan`, `store`, dan `career`, dan mengimpornya satu per satu hanya
 * menambah baris tanpa menambah batas. Yang membatasi akses adalah bucket dan
 * signed URL, bukan graf impor.
 */
@Global()
@Module({
  providers: [{ provide: S3, useFactory: createS3FromEnv }, StorageService],
  exports: [StorageService],
})
export class StorageModule {}
