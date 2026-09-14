import { Module } from '@nestjs/common';

/**
 * E7 · Klinik plagiarisme — docs/PRD.md §7 E7
 *
 * KERANGKA KOSONG. Controller & service menyusul di item: K-01, K-02, K-03.
 *
 * Pola WAJIB: hold -> settle | release. Tidak pernah "debit lalu refund manual".
 * Vendor di balik antarmuka `PlagiarismProvider` sejak awal (KL-12).
 */
@Module({})
export class ScanModule {}
