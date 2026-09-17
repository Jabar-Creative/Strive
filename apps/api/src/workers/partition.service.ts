import { Inject, Injectable, Logger } from '@nestjs/common';
import { type Kysely, sql } from 'kysely';

import { DATABASE, type DB } from '../infra/kysely';

/** Berapa bulan ke depan yang selalu dijamin ada — PRD §9.3. */
export const MONTHS_AHEAD = 1;
/** Alarm menyala kalau partisi terjauh tinggal kurang dari ini. */
export const WARN_DAYS = 30;

export interface PartitionResult {
  created: string[];
  /** Partisi terjauh yang ada, batas ATAS-nya (eksklusif). */
  furthest_until: string;
  days_remaining: number;
  warning: boolean;
}

/**
 * Job bulanan pembuat partisi `lesson_attempts` — `F-12`, dari isu #14.
 *
 * ── Kenapa item ini ada sama sekali ──
 *
 * `lesson_attempts` **tidak punya partisi DEFAULT**, dan itu disengaja:
 * partisi default membuat penambahan partisi baru harus memindai seluruh
 * isinya. Konsekuensinya, `INSERT` di luar rentang **GAGAL**, bukan jatuh ke
 * mana pun:
 *
 *     ERROR: no partition of relation "lesson_attempts" found for row
 *
 * `POST /attempts` adalah jantung sistem. Kalau insert-nya gagal, **pengguna
 * berhenti bisa belajar sama sekali** — bukan degradasi, tapi berhenti total,
 * dengan pesan yang tidak menunjuk ke sebabnya.
 *
 * PRD §9.3 mewajibkan job ini satu kalimat, tapi tidak ada satu pun dari 73
 * item awal yang mengerjakannya. Terlewat saat perencanaan (isu #14).
 *
 * ── Idempoten, dan itu bukan kenyamanan ──
 *
 * `CREATE TABLE IF NOT EXISTS … PARTITION OF`. Job bulanan yang gagal saat
 * dijalankan dua kali akan membuat orang ragu menjalankannya ulang setelah
 * insiden — dan keraguan itu yang berbahaya, bukan duplikasinya.
 */
@Injectable()
export class PartitionService {
  private readonly logger = new Logger(PartitionService.name);

  constructor(@Inject(DATABASE) private readonly db: Kysely<DB>) {}

  async run(): Promise<PartitionResult> {
    const created: string[] = [];

    // Bulan berjalan + MONTHS_AHEAD bulan ke depan. Batas bulannya dihitung
    // POSTGRES (`date_trunc`), bukan di Node: aritmetika bulan di JavaScript
    // salah di akhir bulan (31 Januari + 1 bulan = 3 Maret), dan yang meleset
    // di sini adalah partisi yang tidak pernah dibuat.
    for (let i = 0; i <= MONTHS_AHEAD; i++) {
      const b = await sql<{ nama: string; mulai: string; sampai: string }>`
        SELECT 'lesson_attempts_' || to_char(bulan, 'YYYY_MM')        AS nama,
               to_char(bulan, 'YYYY-MM-DD')                           AS mulai,
               to_char(bulan + interval '1 month', 'YYYY-MM-DD')      AS sampai
        FROM (SELECT date_trunc('month', now() + (${sql.lit(i)} || ' month')::interval) AS bulan) x
      `.execute(this.db);

      const { nama, mulai, sampai } = b.rows[0]!;

      const ada = await sql<{ ada: boolean }>`
        SELECT EXISTS (
          SELECT 1 FROM pg_class WHERE relname = ${nama}
        ) AS ada
      `.execute(this.db);

      if (ada.rows[0]?.ada) continue;

      // `IF NOT EXISTS` tetap dipakai meski sudah diperiksa di atas: dua
      // instance worker yang berjalan bersamaan akan sama-sama lolos
      // pemeriksaan, dan yang kalah harus no-op, bukan meledak.
      await sql`
        CREATE TABLE IF NOT EXISTS ${sql.ref(nama)}
        PARTITION OF lesson_attempts
        FOR VALUES FROM (${mulai}) TO (${sampai})
      `.execute(this.db);

      created.push(nama);
      this.logger.log(`Partisi dibuat: ${nama} (${mulai} .. ${sampai})`);
    }

    const sisa = await this.furthest();

    if (sisa.warning) {
      // Alarm. `error`, bukan `warn`: habisnya partisi berarti seluruh produk
      // berhenti, dan peringatan yang biasa dilihat lalu diabaikan adalah
      // peringatan yang berhenti bekerja.
      this.logger.error(
        `PARTISI lesson_attempts HAMPIR HABIS: tinggal ${sisa.days_remaining} hari ` +
          `(sampai ${sisa.furthest_until}). Insert di luar rentang GAGAL — ` +
          `POST /attempts berhenti total, bukan melambat.`,
      );
    }

    return { created, ...sisa };
  }

  /** Batas atas partisi terjauh dan sisa harinya. */
  async furthest(): Promise<Omit<PartitionResult, 'created'>> {
    const r = await sql<{ sampai: string; sisa: string }>`
      SELECT to_char(maks, 'YYYY-MM-DD')          AS sampai,
             (maks - current_date)::text          AS sisa
      FROM (
        SELECT max(
          -- Batas ATAS partisi diambil dari ekspresi partisinya sendiri, bukan
          -- ditebak dari namanya. Nama bisa salah; batasnya tidak.
          (regexp_match(pg_get_expr(c.relpartbound, c.oid), 'TO \\((''[^'']+'')\\)'))[1]::date
        ) AS maks
        FROM pg_class c
        JOIN pg_inherits i ON i.inhrelid = c.oid
        JOIN pg_class p ON p.oid = i.inhparent
        WHERE p.relname = 'lesson_attempts'
      ) x
    `.execute(this.db);

    const row = r.rows[0];
    const sisa = Number(row?.sisa ?? 0);
    return {
      furthest_until: row?.sampai ?? '',
      days_remaining: sisa,
      warning: sisa < WARN_DAYS,
    };
  }
}
