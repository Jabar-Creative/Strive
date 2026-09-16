import { Kysely, PostgresDialect } from 'kysely';
import { Pool, types as pgTypes } from 'pg';

import type { DB } from './database.d';

/**
 * Tipe database aplikasi, diturunkan dari `database.d.ts` yang digenerate
 * `pnpm db:types` dari skema sungguhan. JANGAN diedit tangan.
 */
/**
 * OID 1082 = tipe `date` PostgreSQL.
 *
 * Driver `pg` secara default mem-parsing-nya jadi objek `Date` pada tengah
 * malam ZONA WAKTU PROSES NODE. Itu salah untuk tanggal kalender: nilainya
 * tidak punya zona waktu, dan memberinya satu mengundang pergeseran satu hari
 * yang tidak terlihat di mesin developer tapi muncul di server dengan TZ
 * berbeda — persis kelas bug yang CLAUDE.md aturan 5 ada untuk mencegahnya.
 *
 * Empat kolom terdampak, dan salah satunya menentukan: `attempt_date` adalah
 * kunci partisi DAN kunci keunikan harian. Sisanya `quest_date`,
 * `last_activity_date`, `freeze_used_date`.
 *
 * Diselaraskan dengan `--date-parser string` di scripts/db-types.mjs, jadi
 * tipe hasil codegen dan nilai runtime sama-sama string 'YYYY-MM-DD'.
 * Ketahuan saat S-01: tanggal yang BENAR di database terbaca berbeda di Node.
 */
pgTypes.setTypeParser(1082, (value) => value);

export type Database = Kysely<DB>;

/** Token injeksi NestJS. */
export const DATABASE = Symbol('DATABASE');

/**
 * Membuat koneksi. Test integrasi memanggil fungsi YANG SAMA, bukan merakit
 * Kysely sendiri — kalau test merakit sendiri, ia tidak ikut mendapat type
 * parser di atas, dan yang diuji jadi wiring yang berbeda dari yang dijalankan
 * produksi. Persis itu yang terjadi di S-01 sebelum diperbaiki.
 */
export function createDatabase(override?: string): Database {
  const connectionString = override ?? process.env['DATABASE_URL'];
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
