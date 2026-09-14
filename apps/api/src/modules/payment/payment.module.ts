import { Module } from '@nestjs/common';

/**
 * E6 · Payment — docs/PRD.md §7 E6, §12.1
 *
 * KERANGKA KOSONG. Controller & service menyusul di item: P-02, P-03.
 *
 * DIBELI: Midtrans Snap hosted checkout. Jangan buat halaman checkout sendiri.
 * Koin HANYA ditambahkan dari webhook BERTANDA TANGAN — tidak pernah dari
 * redirect client (PA-5).
 */
@Module({})
export class PaymentModule {}
