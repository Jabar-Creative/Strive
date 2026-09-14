import { Module } from '@nestjs/common';

/**
 * Koneksi PostgreSQL lewat Kysely (bukan ORM penuh) — docs/PRD.md §8.4.
 * Tipe tabel digenerate dari skema: `pnpm db:types`.
 *
 * KERANGKA — provider menyusul di item F-04 (docs/BACKLOG.md).
 */
@Module({})
export class KyselyModule {}
