#!/usr/bin/env node
// Pemeriksaan skema staging — HANYA BACA.
//
// CI (`migrasi kering`) sudah membuktikan trigger menolak perubahan, terhadap
// database sekali pakai, dengan INSERT sungguhan. Blok itu TIDAK BOLEH
// disalin ke staging: ia menulis `users`, `coin_ledger` (append-only, tidak
// bisa dihapus), `squads`, dan `squad_members`. Staging yang permanen akan
// menyimpan baris uji itu selamanya.
//
// Yang diperiksa di sini hanya keberadaan: 32 tabel domain, trigger
// `coin_ledger_no_mutate`, dan FK `peer_reviews_attempt_fk`. Keberadaan
// BUKAN bukti bahwa trigger menolak UPDATE — itu tetap milik CI.
import pg from 'pg';

import { muatEnv } from './env-berkas.mjs';

// `.env` dimuat lebih dulu supaya petunjuk di galat di bawah benar-benar
// menolong. Shell menang atas berkas — lihat scripts/env-berkas.mjs.
muatEnv();

/** Kata yang tidak boleh muncul di query. Pemeriksaan ini gagal tertutup. */
const TULISAN = /\b(insert|update|delete|truncate|alter|drop|create|grant|revoke|copy|call|do)\b/i;

/**
 * Tiga pemeriksaan yang sama dengan bagian BACA dari job `migrasi kering`.
 * Pola `lesson_attempts\_%` menyisihkan partisi, bukan tabel induknya —
 * sama dengan `.github/workflows/ci.yml`.
 */
export const PEMERIKSAAN = [
  {
    nama: 'tabel domain',
    sql:
      'SELECT count(*)::text AS n FROM information_schema.tables ' +
      "WHERE table_schema = 'public' AND table_type = 'BASE TABLE' " +
      "AND table_name NOT LIKE 'lesson_attempts\\_%'",
    harapan: '32',
  },
  {
    nama: 'trigger coin_ledger_no_mutate',
    sql: "SELECT count(*)::text AS n FROM pg_trigger WHERE tgname = 'coin_ledger_no_mutate'",
    harapan: '1',
  },
  {
    nama: 'FK peer_reviews_attempt_fk',
    sql: "SELECT count(*)::text AS n FROM pg_constraint WHERE conname = 'peer_reviews_attempt_fk'",
    harapan: '1',
  },
];

/**
 * Bukti bahwa semai BERISI — dipakai `--hitung-konten` setelah `pnpm seed`.
 *
 * Ambang MINIMAL, bukan sama-dengan: `pnpm seed:content` menambah kartu, dan
 * pemeriksaan yang menuntut angka persis akan merah justru saat kontennya
 * bertambah. Angkanya dari apa yang dijamin `pnpm seed` (F-13): satu track ->
 * 2 modul -> 6 lesson -> 12 kartu, plus 8 store_items dan satu pricing_config.
 *
 * Kenapa ini ada sama sekali: seeder yang idempoten tetap keluar 0 kalau ia
 * gagal menyisipkan apa pun. "Perintahnya sukses" bukan bukti datanya ada.
 */
export const HITUNG_KONTEN = [
  { nama: 'pricing_config', sql: 'SELECT count(*)::text AS n FROM pricing_config', minimal: 1 },
  { nama: 'tracks', sql: 'SELECT count(*)::text AS n FROM tracks', minimal: 1 },
  { nama: 'lessons', sql: 'SELECT count(*)::text AS n FROM lessons', minimal: 6 },
  { nama: 'lesson_cards', sql: 'SELECT count(*)::text AS n FROM lesson_cards', minimal: 12 },
  { nama: 'store_items', sql: 'SELECT count(*)::text AS n FROM store_items', minimal: 8 },
];

/**
 * SEMUA daftar query yang dijalankan berkas ini.
 *
 * Dipisah jadi konstanta sendiri supaya penjaga hanya-baca di bawah tidak
 * perlu diingat-ingat saat daftar baru ditambahkan. Penjaga yang menyebut
 * satu daftar secara harfiah akan berhenti menjaga pada daftar kedua, dan
 * tidak ada yang memberi tahu — itu persis bentuk kegagalan yang sudah
 * berulang di repo ini.
 */
export const SEMUA_DAFTAR = [PEMERIKSAAN, HITUNG_KONTEN];

/** Menolak query yang bukan SELECT tunggal, sebelum ia menyentuh database. */
export function pastikanHanyaBaca(sql) {
  const inti = sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--.*$/gm, '')
    .trim();
  if (!/^select\b/i.test(inti)) {
    throw new Error('pemeriksaan skema menolak query yang bukan SELECT');
  }
  if (inti.includes(';')) {
    throw new Error('pemeriksaan skema menolak lebih dari satu pernyataan');
  }
  if (TULISAN.test(inti)) {
    throw new Error('pemeriksaan skema menolak query yang menulis');
  }
}

function samarkan(pesan) {
  return String(pesan).replace(/postgres(?:ql)?:\/\/[^@\s]*@/gi, 'postgresql://***@');
}

export async function periksaSkema(client) {
  const hasil = [];
  for (const item of PEMERIKSAAN) {
    pastikanHanyaBaca(item.sql);
    const { rows } = await client.query(item.sql);
    const dapat = rows[0]?.n;
    if (dapat !== item.harapan) {
      throw new Error(`${item.nama}: diharapkan ${item.harapan}, dapat ${dapat ?? 'kosong'}`);
    }
    hasil.push(`${item.nama}: ${dapat}`);
  }
  return hasil;
}

function wajibMenolak(sql) {
  try {
    pastikanHanyaBaca(sql);
  } catch {
    return;
  }
  throw new Error(`penjaga lolos untuk query yang seharusnya ditolak: ${sql}`);
}

/** Menjalankan ambang minimal `HITUNG_KONTEN`. Hanya SELECT. */
export async function hitungKonten(client) {
  const hasil = [];
  for (const item of HITUNG_KONTEN) {
    pastikanHanyaBaca(item.sql);
    const { rows } = await client.query(item.sql);
    const dapat = Number(rows[0]?.n ?? -1);
    if (!Number.isInteger(dapat) || dapat < item.minimal) {
      throw new Error(
        `${item.nama}: minimal ${item.minimal}, dapat ${dapat < 0 ? 'kosong' : dapat}`,
      );
    }
    hasil.push(`${item.nama}: ${dapat} (minimal ${item.minimal})`);
  }
  return hasil;
}

function periksaDaftarQuery() {
  for (const daftar of SEMUA_DAFTAR) for (const item of daftar) pastikanHanyaBaca(item.sql);
  // Penjaga yang tidak pernah diuji merah adalah penjaga yang tidak ada.
  wajibMenolak('INSERT INTO coin_ledger (amount) VALUES (1)');
  wajibMenolak('UPDATE coin_ledger SET amount = 1');
  wajibMenolak('DELETE FROM streaks');
  wajibMenolak('SELECT 1; DROP TABLE users');
  const jumlah = SEMUA_DAFTAR.reduce((n, d) => n + d.length, 0);
  console.log(`[schema-check] ${jumlah} query hanya-baca, tanpa koneksi`);
}

if (process.argv[1]?.endsWith('schema-check-readonly.mjs')) {
  const hanyaDaftar = process.argv.includes('--periksa-query');
  try {
    periksaDaftarQuery();
  } catch (error) {
    console.error(`[schema-check] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
  if (hanyaDaftar) process.exit(0);

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error(
      '[schema-check] DATABASE_URL belum diset.\n' +
        '               Untuk staging: secret STAGING_DATABASE_URL (sudah sslmode=require).',
    );
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: url });
  try {
    await client.connect();
    const hasil = process.argv.includes('--hitung-konten')
      ? await hitungKonten(client)
      : await periksaSkema(client);
    for (const baris of hasil) console.log(`[schema-check] ${baris}`);
  } catch (error) {
    const pesan = error instanceof Error ? error.message : String(error);
    console.error(`[schema-check] GAGAL: ${samarkan(pesan)}`);
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
}
