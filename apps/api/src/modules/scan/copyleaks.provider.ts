import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable, ServiceUnavailableException } from '@nestjs/common';

import type {
  ParsedWebhook,
  PlagiarismProvider,
  PlagiarismSubmission,
} from './plagiarism-provider';

/** PRD §12.2: timeout submit 30 detik. */
export const SUBMIT_TIMEOUT_MS = 30_000;

/**
 * Copyleaks — PRD §12.2, item `K-03`. **BELUM TERSAMBUNG** (isu #90).
 *
 * ── Kenapa berkas ini ada padahal kredensialnya belum ada ──
 *
 * Rute `POST /webhooks/copyleaks` sudah berdiri, dan rute yang berdiri butuh
 * sesuatu yang memutuskan sah-tidaknya sebuah request. Yang ada di sini
 * memutuskan **tidak** — untuk semuanya — selama `COPYLEAKS_WEBHOOK_SECRET`
 * kosong.
 *
 * Itu pilihan yang disengaja: **gagal TERTUTUP.** Provider tiruan yang
 * mengembalikan `true` supaya "bisa dites" adalah endpoint yang menerima
 * perintah menyetel hold dari siapa pun yang tahu URL-nya.
 *
 * ── Yang SUDAH benar di sini ──
 *
 * Perbandingan tanda tangan memakai `timingSafeEqual`, bukan `===`.
 * Perbandingan string biasa keluar di byte pertama yang berbeda, dan selisih
 * waktunya bisa diukur dari jauh untuk menebak tanda tangan satu byte demi
 * satu. Itu benar apa pun skema vendornya, jadi ditulis sekarang.
 *
 * ── Yang BELUM bisa benar, dan tidak boleh dipura-purakan ──
 *
 * **Skema tanda tangan Copyleaks tidak didokumentasikan `docs/PRD.md`.**
 * §12.1 menulis skema Midtrans lengkap
 * (`SHA512(order_id + status_code + gross_amount + server_key)`); §12.2 hanya
 * menyebut `COPYLEAKS_WEBHOOK_SECRET` ada.
 *
 * HMAC-SHA256 atas badan mentah di bawah adalah **konvensi paling lazim, BUKAN
 * fakta terverifikasi**. Nama header-nya juga tebakan. Keduanya WAJIB
 * dicocokkan ke dokumentasi dan sandbox Copyleaks sebelum dipercaya — dan
 * sampai itu terjadi, kekosongan rahasia membuat seluruhnya menolak, jadi
 * tebakan ini tidak bisa meloloskan apa pun.
 *
 * `submit()` dan `parseWebhook()` sengaja MELEMPAR alih-alih mengembalikan
 * data karangan. Bentuk payload Copyleaks juga tidak ada di PRD, dan kode
 * yang mengarang bentuk vendor akan terlihat selesai sampai hari pertama
 * dipakai sungguhan.
 */
@Injectable()
export class CopyleaksProvider implements PlagiarismProvider {
  readonly name = 'copyleaks';

  private get secret(): string | null {
    const s = process.env['COPYLEAKS_WEBHOOK_SECRET'];
    return s && s.trim().length > 0 ? s : null;
  }

  async submit(_p: PlagiarismSubmission): Promise<{ providerScanId: string }> {
    throw new ServiceUnavailableException({
      error: {
        code: 'PROVIDER_UNAVAILABLE',
        message:
          'Copyleaks belum tersambung — COPYLEAKS_EMAIL / COPYLEAKS_API_KEY belum diisi (isu #90)',
        details: { provider: this.name },
      },
    });
  }

  /**
   * Tanpa rahasia → **selalu `false`**.
   *
   * Bukan "belum diimplementasikan", tapi jawaban yang benar: request yang
   * tidak bisa diverifikasi tidak sah. Membedakan keduanya penting — yang
   * pertama mengundang orang menambahkan `return true` sementara.
   */
  verifyWebhook(headers: Record<string, string>, rawBody: Buffer): boolean {
    const secret = this.secret;
    if (!secret) return false;

    const dikirim = headers['x-copyleaks-signature'] ?? headers['X-Copyleaks-Signature'];
    if (!dikirim) return false;

    const dihitung = createHmac('sha256', secret).update(rawBody).digest('hex');

    const a = Buffer.from(dihitung, 'utf8');
    const b = Buffer.from(dikirim, 'utf8');
    // Panjang berbeda diperiksa DULU: `timingSafeEqual` melempar kalau
    // panjangnya tidak sama, dan melempar dari jalur verifikasi tanda tangan
    // berarti 500 alih-alih 400 untuk request yang jelas tidak sah.
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  parseWebhook(_body: unknown): ParsedWebhook {
    throw new ServiceUnavailableException({
      error: {
        code: 'PROVIDER_UNAVAILABLE',
        message: 'Bentuk payload webhook Copyleaks belum diverifikasi ke sandbox (isu #90)',
        details: { provider: this.name },
      },
    });
  }
}
