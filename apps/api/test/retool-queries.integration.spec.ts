import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Kysely, sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, type DB } from '../src/infra/kysely';

/**
 * Query dasbor Retool (`SA-04`) terhadap DATABASE NYATA, **sebagai role
 * `strive_readonly`**.
 *
 * ── Kenapa role-nya penting, bukan cuma query-nya ──
 *
 * Query yang ditulis sambil masuk sebagai superuser akan berjalan mulus saat
 * dicobanya. Lalu ia gagal di Retool — yang menyambung sebagai
 * `strive_readonly` dan TIDAK bisa membaca tabel mentah — dan gagalnya di
 * depan orang yang sedang menelusuri insiden pembayaran, di jam yang salah.
 *
 * `SET LOCAL ROLE` di bawah menjalankan query BENAR-BENAR sebagai role itu,
 * jadi yang diuji adalah GRANT sungguhan, bukan niat migrasinya.
 *
 * ── Yang TIDAK diuji di sini ──
 *
 * Bahwa dasbornya ada dan bisa dibuka. Itu butuh langganan Retool, yang belum
 * ada (`docs/reports/blocker-non-kode.pdf`). `SA-04` karena itu **belum
 * selesai** — lihat `docs/retool/README.md`. Yang berkas ini jamin: saat
 * lisensinya ada, bagian yang bisa salah sudah terbukti benar.
 */

const URL_DEV = 'postgres://strive:strive_dev_only@localhost:55432/strive';
const url = process.env['DATABASE_URL_TEST'] ?? process.env['DATABASE_URL'] ?? URL_DEV;

const BERKAS = join(__dirname, '..', '..', '..', 'docs', 'retool', 'queries.sql');

let db: Kysely<DB>;
let reachable = false;

interface Panel {
  nama: string;
  sql: string;
}

/** Memecah `queries.sql` per penanda `-- panel: <nama>`. */
function bacaPanel(): Panel[] {
  const isi = readFileSync(BERKAS, 'utf8');
  const potongan = isi.split(/^-- panel:\s*/m).slice(1);
  return potongan.map((p) => {
    const baris = p.split('\n');
    return { nama: baris[0]!.trim(), sql: baris.slice(1).join('\n').trim() };
  });
}

/**
 * Mengganti parameter Retool dengan nilai contoh.
 *
 * Nilainya tidak penting; yang diuji adalah query itu BISA DIJALANKAN role
 * read-only. Kalau parameternya dibiarkan, yang gagal adalah sintaksnya dan
 * testnya berhenti menguji hal yang dimaksud.
 */
function isiParameter(q: string): string {
  return q.replace(/\{\{\s*cari\.value\s*\}\}/g, "''").replace(/\{\{\s*hari\.value\s*\}\}/g, '30');
}

const panel = bacaPanel();

beforeAll(async () => {
  db = createDatabase(url);
  try {
    await sql`SELECT 1 FROM admin_transactions LIMIT 1`.execute(db);
    reachable = true;
  } catch {
    reachable = false;
  }
});

afterAll(async () => {
  if (db) await db.destroy();
});

/** Menjalankan `q` SEBAGAI `strive_readonly`, lalu mengembalikan peran semula. */
async function sebagaiReadonly<T>(fn: (trx: Kysely<DB>) => Promise<T>): Promise<T> {
  return db.transaction().execute(async (trx) => {
    await sql`SET LOCAL ROLE strive_readonly`.execute(trx);
    return fn(trx as unknown as Kysely<DB>);
  });
}

describe('Query dasbor Retool sebagai strive_readonly (SA-04)', () => {
  it('database siap dan migrasi 006 sudah jalan', () => {
    expect(reachable, `DATABASE_URL tidak bisa dipakai (${url})`).toBe(true);
  });

  it('berkas query terbaca dan berisi panel', () => {
    // Tanpa ini, `queries.sql` yang kosong atau salah format membuat SELURUH
    // test di bawah lulus dengan nol iterasi.
    expect(panel.length, 'tidak ada blok `-- panel:` di queries.sql').toBeGreaterThanOrEqual(6);
    for (const p of panel) expect(p.sql.length, `panel ${p.nama} kosong`).toBeGreaterThan(20);
  });

  it('SETIAP panel bisa dijalankan role read-only', async () => {
    if (!reachable) return;
    for (const p of panel) {
      await expect(
        sebagaiReadonly((trx) => sql.raw(isiParameter(p.sql)).execute(trx)),
        `panel "${p.nama}" TIDAK bisa dijalankan strive_readonly — ia akan gagal di Retool`,
      ).resolves.toBeDefined();
    }
  });

  it('nama panel unik — Retool memakainya sebagai id query', async () => {
    const nama = panel.map((p) => p.nama);
    expect(new Set(nama).size, `nama panel duplikat: ${nama.join(', ')}`).toBe(nama.length);
  });

  it('tidak ada panel yang menyentuh tabel mentah', async () => {
    if (!reachable) return;
    // Bukan sekadar gaya: role-nya memang tidak diberi akses ke tabel mentah,
    // jadi panel yang menyentuhnya GAGAL di Retool. Diperiksa di sini supaya
    // kegagalannya terbaca sebagai "salah sumber", bukan "query error".
    for (const p of panel) {
      for (const tabel of ['users', 'coin_ledger', 'orders', 'payments', 'audit_log']) {
        expect(
          new RegExp(`\\b(FROM|JOIN)\\s+${tabel}\\b`, 'i').test(p.sql),
          `panel "${p.nama}" membaca tabel mentah \`${tabel}\` — pakai view admin_*`,
        ).toBe(false);
      }
    }
  });

  it('role read-only TETAP tidak bisa menulis — SA-2 ditegakkan database', async () => {
    if (!reachable) return;
    // Diulang di sini, bukan hanya di admin-views.integration.spec.ts: kalau
    // suatu saat seseorang memberi GRANT tambahan supaya "satu panel bisa
    // memperbaiki data", yang menahannya harus berteriak dari berkas yang
    // sama dengan panel itu.
    await expect(
      sebagaiReadonly((trx) => sql`UPDATE users SET coin_balance = 999`.execute(trx)),
    ).rejects.toBeTruthy();
    await expect(
      sebagaiReadonly((trx) => sql`DELETE FROM orders`.execute(trx)),
    ).rejects.toBeTruthy();
  });
});
