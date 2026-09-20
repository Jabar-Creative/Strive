import { Module } from '@nestjs/common';

import { PaymentModule } from '../payment';
import { WalletModule } from '../wallet';

import { DocumentUploadService } from './document-upload.service';
import { ScanService } from './scan.service';

/**
 * E7 · Klinik plagiarisme — docs/PRD.md §7 E7
 *
 * `K-01` menerima dokumen (validasi, SHA-256, object storage).
 * `K-02` memasang jalur uangnya: dedup, hold → settle | release, dan reaper.
 * `K-03` menyusul: worker Copyleaks + webhook hasil.
 *
 * Pola WAJIB: hold → settle | release. Tidak pernah "debit lalu refund
 * manual" — refund manual berarti ada manusia yang harus TAHU bahwa refund
 * dibutuhkan, dan itu tidak terjadi.
 *
 * Vendor di balik `PlagiarismProvider` sejak awal (KL-12), justru karena
 * implementasinya belum ada: antarmuka yang dibuat saat vendor kedua datang
 * selalu berbentuk seperti vendor pertama.
 */
@Module({
  imports: [WalletModule, PaymentModule],
  providers: [DocumentUploadService, ScanService],
  exports: [DocumentUploadService, ScanService],
})
export class ScanModule {}
