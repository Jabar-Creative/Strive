import { Module } from '@nestjs/common';

import { PaymentModule } from '../payment';
import { WalletModule } from '../wallet';

import { CopyleaksProvider } from './copyleaks.provider';
import { DocumentUploadService } from './document-upload.service';
import { PLAGIARISM_PROVIDER } from './plagiarism-provider';
import { ScanWebhookController } from './scan-webhook.controller';
import { ScanService } from './scan.service';

/**
 * E7 · Klinik plagiarisme — docs/PRD.md §7 E7
 *
 * `K-01` menerima dokumen (validasi, SHA-256, object storage).
 * `K-02` memasang jalur uangnya: dedup, hold → settle | release, dan reaper.
 * `K-03` memasang rute webhook dan antarmuka vendornya. Yang MASIH terblokir:
 * `CopyleaksProvider.submit()` dan `parseWebhook()` — keduanya butuh akun
 * sandbox (isu #90), dan mengarang bentuk payload vendor akan terlihat selesai
 * sampai hari pertama dipakai sungguhan.
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
  controllers: [ScanWebhookController],
  providers: [
    DocumentUploadService,
    ScanService,
    // Satu provider aktif per proses. Sekarang Copyleaks, yang GAGAL TERTUTUP
    // selama kredensialnya belum ada (isu #90) — bukan tiruan yang
    // mengembalikan `true` supaya "bisa dites".
    { provide: PLAGIARISM_PROVIDER, useClass: CopyleaksProvider },
  ],
  exports: [DocumentUploadService, ScanService, PLAGIARISM_PROVIDER],
})
export class ScanModule {}
