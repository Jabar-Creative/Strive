import { Global, Module } from '@nestjs/common';

import { DATABASE, createDatabase } from './database';

/**
 * Koneksi PostgreSQL lewat Kysely — bukan ORM penuh (docs/PRD.md §8.4).
 *
 * Global supaya modul domain tidak perlu mengimpornya satu per satu; yang
 * mereka injeksi cukup token `DATABASE`.
 *
 * Tipe tabelnya DIGENERATE dari skema yang benar-benar ada di database
 * (`pnpm db:types`), bukan ditulis tangan. Arahnya disengaja: SQL sumber
 * kebenaran, TypeScript turunannya. Kalau ditulis tangan, dua-duanya akan
 * berbeda dan yang ketahuan belakangan adalah yang di produksi.
 */
@Global()
@Module({
  providers: [
    {
      provide: DATABASE,
      useFactory: createDatabase,
    },
  ],
  exports: [DATABASE],
})
export class KyselyModule {}
