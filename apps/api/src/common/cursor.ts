import { BadRequestException } from '@nestjs/common';
import { type Expression, type RawBuilder, sql } from 'kysely';

/**
 * Cursor keyset untuk riwayat "milik sendiri" — `F-14` (isu #88).
 *
 * ── Kenapa tidak memakai ulang cursor `C-02` apa adanya ──
 *
 * `coin_ledger.id` adalah `bigserial`: monotonik, jadi ia SEKALIGUS urutan dan
 * kunci cursor, dan `WHERE id < ?` sudah cukup.
 *
 * Ketujuh tabel `F-14` punya PK **`uuid`**, yang acak. Mengurutkannya dengan
 * `ORDER BY id DESC` menghasilkan urutan yang tidak berarti apa-apa bagi
 * pengguna, dan memakai `WHERE created_at < ?` sendirian akan **melewatkan
 * atau mengulang** baris yang berbagi timestamp. Jadi kuncinya majemuk:
 * `(waktu, id)`, dibandingkan sebagai row-value — bentuk yang sama yang
 * dipakai `ORDER BY`.
 *
 * ── Jebakan presisi yang membuat ini tidak boleh memakai `Date` ──
 *
 * `timestamptz` PostgreSQL punya presisi **mikrodetik**; `Date` JavaScript
 * hanya **milidetik**. Cursor yang dibentuk dari `row.created_at.toISOString()`
 * memotong tiga digit terakhir, dan dua baris yang lahir dalam milidetik yang
 * sama — biasa terjadi pada insert berurutan — akan membuat halaman berikutnya
 * mengulang baris yang sudah dikirim, atau melompatinya.
 *
 * Karena itu waktu untuk cursor diambil sebagai **teks dari Postgres**
 * (`waktuCursor()`), bukan dari objek `Date` yang sudah dipotong. Dibandingkan
 * kembali sebagai `timestamptz`, jadi yang dibandingkan nilai aslinya.
 *
 * ── Prefiks ──
 *
 * Setiap endpoint punya prefiksnya sendiri. Tanpa itu, cursor dari `/scans`
 * yang dipakai di `/attempts` akan didekode dengan sukses dan mengembalikan
 * halaman yang salah **tanpa error** — kegagalan paling mahal, karena tidak
 * terlihat.
 */

/** Batas keras, supaya satu request tidak bisa menarik seluruh riwayat. */
export const HISTORY_LIMIT_MAX = 50;
export const HISTORY_LIMIT_DEFAULT = 20;

export interface CursorKey {
  /** Waktu presisi mikrodetik, apa adanya dari Postgres. */
  ts: string;
  id: string;
}

export interface HistoryPage<T> {
  data: T[];
  next_cursor: string | null;
}

/**
 * Waktu untuk cursor, dirender Postgres dengan presisi penuh.
 *
 * `AT TIME ZONE 'UTC'` bukan soal zona waktu pengguna (aturan keras 5 tidak
 * berlaku di sini — ini kunci pagination, bukan "hari ini"): ia hanya membuat
 * teksnya satu bentuk yang stabil apa pun `TimeZone` sesi database.
 */
export function waktuCursor(kolom: string): RawBuilder<string> {
  return sql<string>`to_char(${sql.ref(kolom)} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
}

export function encodeCursor(prefix: string, kunci: CursorKey): string {
  return Buffer.from(`${prefix}:${kunci.ts}|${kunci.id}`, 'utf8').toString('base64url');
}

/**
 * Melempar `400 INVALID_CURSOR` — bukan mengembalikan `null`, dan bukan
 * `Error` mentah yang harus ditangkap ulang tiap controller.
 *
 * `C-02` dan `N-01` masing-masing menyalin `try { … } catch (InvalidCursorError)`
 * ke controller-nya. Dengan tujuh rute lagi, satu yang lupa menyalinnya
 * menghasilkan **500** untuk cursor rusak — persis yang dilarang acceptance
 * criteria `F-14`. Yang tidak bisa dilupakan adalah yang tidak perlu diingat.
 */
export function decodeCursor(prefix: string, raw: string): CursorKey {
  const tolak = (): never => {
    throw new BadRequestException({
      error: { code: 'INVALID_CURSOR', message: 'Cursor tidak valid', details: { cursor: raw } },
    });
  };

  let teks: string;
  try {
    teks = Buffer.from(raw, 'base64url').toString('utf8');
  } catch {
    return tolak();
  }

  if (!teks.startsWith(`${prefix}:`)) return tolak();
  const isi = teks.slice(prefix.length + 1);
  const pisah = isi.lastIndexOf('|');
  if (pisah === -1) return tolak();

  const ts = isi.slice(0, pisah);
  const id = isi.slice(pisah + 1);
  // Bentuk diperiksa DI SINI, bukan diserahkan ke Postgres: teks sembarang
  // yang masuk ke `::timestamptz` gagal sebagai galat database (500), dan
  // uuid sembarang yang lolos akan membandingkan diam-diam.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(ts)) return tolak();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return tolak();

  return { ts, id };
}

/**
 * `(waktu, id) < (cursor.ts, cursor.id)` sebagai row-value.
 *
 * Row-value comparison PostgreSQL membandingkan kolom kiri dulu, lalu kolom
 * berikutnya **hanya saat yang kiri sama** — persis semantik `ORDER BY waktu
 * DESC, id DESC`. Menuliskannya sebagai `waktu < ? OR (waktu = ? AND id < ?)`
 * benar juga, tapi lebih mudah salah dan lebih mudah ditulis setengah.
 */
export function setelahCursor(
  kolomWaktu: string,
  kolomId: string,
  kunci: CursorKey,
): Expression<boolean> {
  return sql<boolean>`(${sql.ref(kolomWaktu)}, ${sql.ref(kolomId)}) < (${kunci.ts}::timestamptz, ${kunci.id}::uuid)`;
}

/** `limit` DIJEPIT, bukan ditolak — §10.2 tidak punya kode untuk limit salah. */
export function clampLimit(raw: unknown): number {
  const n = typeof raw === 'string' ? Number(raw) : typeof raw === 'number' ? raw : NaN;
  if (!Number.isFinite(n)) return HISTORY_LIMIT_DEFAULT;
  return Math.min(Math.max(Math.trunc(n), 1), HISTORY_LIMIT_MAX);
}

/**
 * Memotong hasil `limit + 1` baris menjadi satu halaman.
 *
 * Baris ke-(limit+1) itulah yang membuktikan masih ada halaman berikutnya —
 * tanpa `COUNT(*)` terpisah atas riwayat yang bisa sangat panjang.
 */
export function potongHalaman<Baris extends { cursor_ts: string; id: string }, Keluar>(
  rows: Baris[],
  limit: number,
  prefix: string,
  serialize: (row: Baris) => Keluar,
): HistoryPage<Keluar> {
  const adaLagi = rows.length > limit;
  const halaman = adaLagi ? rows.slice(0, limit) : rows;
  const akhir = halaman[halaman.length - 1];

  return {
    data: halaman.map(serialize),
    next_cursor:
      adaLagi && akhir ? encodeCursor(prefix, { ts: akhir.cursor_ts, id: akhir.id }) : null,
  };
}
