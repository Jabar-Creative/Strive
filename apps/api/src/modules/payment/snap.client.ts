import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

export interface SnapOrder {
  orderId: string;
  amountIdr: number;
  coins: number;
  customer: { email: string; name: string };
}

export interface SnapTransaction {
  token: string;
  redirect_url: string;
}

/**
 * Klien Midtrans Snap **hosted checkout** (PRD §12.1, `PA-2`).
 *
 * Yang TIDAK ada di berkas ini, dan sengaja: halaman pembayaran. `CLAUDE.md`
 * §Yang dibeli menyatakannya — Snap hosted, bukan checkout sendiri. Kelas ini
 * hanya menukar satu order jadi satu token.
 *
 * **Metode pembayaran dibatasi QRIS** (`PA-1`). Membiarkannya terbuka berarti
 * Midtrans menampilkan seluruh metode yang aktif di akun, termasuk yang belum
 * kita uji jalur webhook-nya.
 *
 * Dibuat `@Injectable` dan diletakkan di balik antarmuka supaya jalur
 * pembuatan order bisa diuji tanpa memanggil Midtrans sungguhan — jalur itu
 * yang memuat idempotensi dan uang, dan ia harus bisa dibuktikan tanpa akun
 * vendor.
 */
@Injectable()
export class SnapClient {
  private readonly logger = new Logger(SnapClient.name);

  private get serverKey(): string {
    return process.env['MIDTRANS_SERVER_KEY'] ?? '';
  }

  private get baseUrl(): string {
    return process.env['MIDTRANS_IS_PRODUCTION'] === 'true'
      ? 'https://app.midtrans.com/snap/v1/transactions'
      : 'https://app.sandbox.midtrans.com/snap/v1/transactions';
  }

  /** `true` kalau kredensialnya ada. Dipakai untuk gagal cepat dengan pesan yang jelas. */
  configured(): boolean {
    return this.serverKey.length > 0;
  }

  async createTransaction(order: SnapOrder): Promise<SnapTransaction> {
    if (!this.configured()) {
      // Gagal EKSPLISIT, bukan mengembalikan token palsu. Token palsu akan
      // mengalir ke klien, membuka halaman yang tidak ada, dan gejalanya
      // muncul jauh dari sebabnya.
      throw new ServiceUnavailableException({
        error: {
          code: 'RATE_LIMITED',
          message: 'Pembayaran belum tersedia: kredensial Midtrans belum diatur',
          details: { reason: 'MIDTRANS_SERVER_KEY kosong' },
        },
      });
    }

    const res = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        // Basic auth dengan server key sebagai username, password kosong —
        // bentuk yang diminta Midtrans.
        Authorization: `Basic ${Buffer.from(`${this.serverKey}:`).toString('base64')}`,
      },
      body: JSON.stringify({
        transaction_details: {
          order_id: order.orderId,
          // Midtrans menolak desimal untuk IDR. Uang selalu integer di produk
          // ini, jadi tidak ada konversi yang perlu dilakukan di sini.
          gross_amount: order.amountIdr,
        },
        // PA-1: QRIS saja di v1.
        enabled_payments: ['other_qris'],
        customer_details: { email: order.customer.email, first_name: order.customer.name },
        item_details: [
          {
            id: `coins-${order.coins}`,
            price: order.amountIdr,
            quantity: 1,
            name: `${order.coins} Strive Coins`,
          },
        ],
      }),
    });

    if (!res.ok) {
      const teks = await res.text().catch(() => '');
      this.logger.error(
        `Midtrans menolak pembuatan transaksi (${res.status}): ${teks.slice(0, 300)}`,
      );
      throw new ServiceUnavailableException({
        error: {
          code: 'RATE_LIMITED',
          message: 'Gagal membuat transaksi pembayaran',
          details: { status: res.status },
        },
      });
    }

    return (await res.json()) as SnapTransaction;
  }
}
