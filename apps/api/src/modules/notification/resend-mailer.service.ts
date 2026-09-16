import { Injectable } from '@nestjs/common';
import { Resend } from 'resend';

export interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  /** Header `List-Unsubscribe` (RFC 2369) — NO-6, tombol unsubscribe bawaan Gmail/Outlook. */
  listUnsubscribe?: string;
}

/**
 * Pembungkus tipis SDK resmi `resend` — docs/PRD.md §12.4.
 *
 * Sengaja TIDAK ada retry di sini. Retry (3x, eksponensial) adalah tanggung
 * jawab `NotificationsService`, supaya kebijakan retry/kegagalan tetap di
 * satu tempat dan bisa diuji tanpa memalsukan jaringan (mock service ini,
 * bukan mock HTTP `resend`).
 */
@Injectable()
export class ResendMailerService {
  private readonly client: Resend;
  private readonly from: string;

  constructor() {
    // TERBUKTI (bukan diasumsikan — sempat ditulis salah, ketahuan dari
    // `test/app.module.spec.ts` yang gagal): konstruktor SDK `resend`
    // MELEMPAR secara sinkron kalau tidak ada API key sama sekali (termasuk
    // dari process.env.RESEND_API_KEY), bukan menunda kegagalan ke saat
    // request dibuat. Dev lokal/CI sengaja tidak mengisi RESEND_API_KEY
    // (.env.example) — proses TIDAK BOLEH gagal boot karena itu, jadi
    // placeholder tidak valid dipakai supaya konstruksi selalu berhasil.
    // Panggilan send() sungguhan dengan key palsu ini akan ditolak Resend
    // (401) dan masuk jalur retry/audit_log yang sama seperti kegagalan
    // vendor lainnya — bukan crash aplikasi.
    this.client = new Resend(process.env['RESEND_API_KEY'] || 're_dev_placeholder_key_not_valid');
    this.from = process.env['EMAIL_FROM'] ?? 'Strive Academy <no-reply@localhost>';
  }

  async send(params: SendEmailParams): Promise<void> {
    const result = await this.client.emails.send({
      from: this.from,
      to: params.to,
      subject: params.subject,
      html: params.html,
      headers: params.listUnsubscribe ? { 'List-Unsubscribe': params.listUnsubscribe } : undefined,
    });

    if (result.error) {
      // Dibungkus jadi Error biasa supaya NotificationsService.sendWithRetry
      // punya satu bentuk kegagalan untuk ditangani, tanpa perlu tahu bentuk
      // internal SDK vendor.
      throw new Error(`Resend menolak pengiriman (${result.error.name}): ${result.error.message}`);
    }
  }
}
