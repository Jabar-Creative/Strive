import { BadRequestException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';

import { DATABASE, type DB } from '../../infra/kysely';
import { PricingConfigService } from './pricing-config.service';
import { SnapClient, type SnapTransaction } from './snap.client';

export interface CheckoutInput {
  userId: string;
  /** Jumlah koin yang dibeli — harus cocok dengan salah satu paket di pricing_config. */
  coins: number;
  idempotencyKey: string;
}

export interface CheckoutResult {
  order_id: string;
  coins: number;
  amount_idr: number;
  pricing_version: number;
  status: string;
  token: string | null;
  redirect_url: string | null;
  /** `true` kalau request ini mengembalikan order yang SUDAH ada (PA-3). */
  reused: boolean;
}

/**
 * `POST /payments/checkout` — PRD §7 E6 `PA-2` … `PA-4`, `PA-10`.
 *
 * ── Yang TIDAK dilakukan di sini, dan itu yang terpenting ──
 *
 * **Koin tidak pernah ditambahkan di jalur ini** (`PA-5`). Checkout hanya
 * membuat baris `orders` berstatus `pending`. Koin hanya bertambah dari
 * webhook bertanda tangan (`P-03`), karena apa pun yang menambah koin dari
 * jalur yang bisa dipanggil klien adalah koin gratis untuk siapa pun yang tahu
 * URL-nya.
 *
 * ── Idempotensi (`PA-3`) ──
 *
 * Dijamin `orders.idempotency_key UNIQUE` di database, bukan pengecekan di
 * kode. Pengecekan di kode kalah balapan dengan dua request bersamaan;
 * constraint tidak. Kode di bawah memeriksa lebih dulu hanya supaya jalur
 * normal tidak menembak Midtrans dua kali — yang menjamin tetap constraint-nya.
 */
@Injectable()
export class CheckoutService {
  constructor(
    @Inject(DATABASE) private readonly db: Kysely<DB>,
    private readonly pricing: PricingConfigService,
    private readonly snap: SnapClient,
  ) {}

  async checkout(input: CheckoutInput): Promise<CheckoutResult> {
    const sudahAda = await this.findByKey(input.idempotencyKey);
    if (sudahAda) return sudahAda;

    const user = await this.db
      .selectFrom('users')
      .select(['id', 'email', 'display_name', 'email_verified', 'status'])
      .where('id', '=', input.userId)
      .executeTakeFirst();

    if (!user || user.status !== 'active') {
      throw new BadRequestException({
        error: { code: 'NOT_FOUND', message: 'Pengguna tidak ditemukan', details: {} },
      });
    }

    // PA-10: top-up diblokir untuk pengguna yang belum verifikasi email.
    // Diperiksa DI SINI, bukan di guard: guard menjawab "peran ini boleh masuk
    // rute ini?", dan status verifikasi bukan peran (PRD §2.5).
    if (!user.email_verified) {
      throw new ForbiddenException({
        error: {
          code: 'EMAIL_NOT_VERIFIED',
          message: 'Verifikasi email dulu sebelum membeli koin',
          details: {},
        },
      });
    }

    const paket = await this.paket(input.coins);

    // Baris order ditulis DULU, sebelum memanggil Midtrans. Urutannya
    // menentukan: kalau Midtrans dipanggil lebih dulu lalu insert gagal, ada
    // transaksi Snap menggantung yang tidak dikenal sistem ini — dan pengguna
    // bisa membayarnya.
    const order = await this.db
      .insertInto('orders')
      .values({
        user_id: input.userId,
        pricing_version: paket.version,
        coins: paket.coins,
        amount_idr: paket.amount_idr,
        idempotency_key: input.idempotencyKey,
        status: 'pending',
        provider: 'midtrans',
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    // Kalau Midtrans gagal, error-nya dibiarkan naik dan baris order TETAP
    // `pending` — sengaja tidak dihapus. Job kedaluwarsa harian (PA-9) yang
    // membereskannya. Menghapusnya di sini akan membebaskan idempotency_key,
    // dan retry klien akan membuat order KEDUA untuk pembayaran yang sama.
    const snap: SnapTransaction = await this.snap.createTransaction({
      orderId: order.id,
      amountIdr: order.amount_idr,
      coins: order.coins,
      customer: { email: user.email, name: user.display_name },
    });

    await this.db
      .updateTable('orders')
      .set({ provider_ref: snap.token })
      .where('id', '=', order.id)
      .execute();

    return {
      order_id: order.id,
      coins: order.coins,
      amount_idr: order.amount_idr,
      pricing_version: order.pricing_version,
      status: order.status,
      token: snap.token,
      redirect_url: snap.redirect_url,
      reused: false,
    };
  }

  /** Order yang sudah ada untuk kunci ini — PA-3. */
  private async findByKey(key: string): Promise<CheckoutResult | null> {
    const o = await this.db
      .selectFrom('orders')
      .selectAll()
      .where('idempotency_key', '=', key)
      .executeTakeFirst();
    if (!o) return null;

    return {
      order_id: o.id,
      coins: o.coins,
      amount_idr: o.amount_idr,
      pricing_version: o.pricing_version,
      status: o.status,
      token: o.provider_ref,
      // Snap tidak mengembalikan redirect_url dari token, jadi request ulang
      // hanya membawa tokennya. Klien memakai token untuk membuka Snap.js —
      // redirect_url adalah jalur cadangan, bukan satu-satunya.
      redirect_url: null,
      reused: true,
    };
  }

  /** Paket koin dari `pricing_config` versi aktif — PA-4. */
  private async paket(
    coins: number,
  ): Promise<{ coins: number; amount_idr: number; version: number }> {
    const cfg = await this.pricing.getCurrentVersion();
    if (!cfg) {
      throw new BadRequestException({
        error: { code: 'NOT_FOUND', message: 'pricing_config belum diterbitkan', details: {} },
      });
    }

    const daftar = (cfg.packages ?? []) as { coins: number; price_idr: number }[];
    const p = daftar.find((x) => x.coins === coins);
    if (!p) {
      throw new BadRequestException({
        error: {
          code: 'NOT_FOUND',
          message: 'Paket koin tidak ada di harga versi aktif',
          details: { coins, tersedia: daftar.map((x) => x.coins) },
        },
      });
    }
    return { coins: p.coins, amount_idr: p.price_idr, version: cfg.version };
  }
}
