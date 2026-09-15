import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';

import type { DB } from './database.d';

/**
 * Tipe database aplikasi, diturunkan dari `database.d.ts` yang digenerate
 * `pnpm db:types` dari skema sungguhan. JANGAN diedit tangan.
 */
export type Database = Kysely<DB>;

/** Token injeksi NestJS. */
export const DATABASE = Symbol('DATABASE');

export function createDatabase(): Database {
  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL belum diset. Salin .env.example ke .env, atau set variabelnya di shell.',
    );
  }

  return new Kysely<DB>({
    dialect: new PostgresDialect({
      pool: new Pool({ connectionString }),
    }),
  });
}
