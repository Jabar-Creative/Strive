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

function periksaDaftarQuery() {
  for (const item of PEMERIKSAAN) pastikanHanyaBaca(item.sql);
  // Penjaga yang tidak pernah diuji merah adalah penjaga yang tidak ada.
  wajibMenolak('INSERT INTO coin_ledger (amount) VALUES (1)');
  wajibMenolak('UPDATE coin_ledger SET amount = 1');
  wajibMenolak('DELETE FROM streaks');
  wajibMenolak('SELECT 1; DROP TABLE users');
  console.log(`[schema-check] ${PEMERIKSAAN.length} query hanya-baca, tanpa koneksi`);
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
    const hasil = await periksaSkema(client);
    for (const baris of hasil) console.log(`[schema-check] ${baris}`);
  } catch (error) {
    const pesan = error instanceof Error ? error.message : String(error);
    console.error(`[schema-check] GAGAL: ${samarkan(pesan)}`);
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
}
