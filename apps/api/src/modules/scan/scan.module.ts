import { Module } from '@nestjs/common';

import { DocumentUploadService } from './document-upload.service';

/**
 * E7 · Klinik plagiarisme — docs/PRD.md §7 E7
 *
 * `K-01` memasang penerimaan dokumen: validasi, SHA-256, simpan ke object
 * storage. Yang MENYUSUL: `K-02` (hold/settle/release + reaper) dan `K-03`
 * (worker Copyleaks + webhook).
 *
 * Pola WAJIB saat K-02 datang: hold -> settle | release. Tidak pernah "debit
 * lalu refund manual". Vendor di balik antarmuka `PlagiarismProvider` sejak
 * awal (KL-12).
 *
 * `StorageModule` tidak diimpor di sini — ia `@Global()`, sama seperti
 * `KyselyModule`.
 */
@Module({
  providers: [DocumentUploadService],
  exports: [DocumentUploadService],
})
export class ScanModule {}
