/**
 * Satu tempat untuk pertanyaan "variabel ini benar-benar disetel?".
 *
 * ── Kenapa ini ada ──
 *
 * `process.env['X'] ?? bawaan` hanya menangkap `undefined`/`null`. Variabel
 * yang di-set TAPI KOSONG lolos sebagai string kosong, dan konsumennya
 * memperlakukannya sebagai nilai yang sah. Itu bukan kemungkinan teoretis di
 * repo ini: `APP_URL=` kosong pernah menghasilkan
 * `Access-Control-Allow-Origin: *` di REST dan WebSocket sekaligus (temuan
 * audit `R-03`), dan template env produksi PRD §17 memang mengirimkannya
 * kosong dengan contohnya di komentar.
 *
 * `appOrigins()` sudah menutup kasus `APP_URL`. Fungsi ini menutup kelasnya —
 * karena lubang yang sama tersalin ke setiap `?? 'http://localhost:…'` yang
 * lain, dan menambalnya satu per satu berarti menunggu yang berikutnya.
 *
 * Trim disengaja: `API_URL=" "` yang tersisa dari salin-tempel dashboard
 * platform adalah "tidak disetel", bukan URL bernama spasi.
 */
export function envTeks(nama: string): string | undefined {
  const nilai = process.env[nama];
  if (typeof nilai !== 'string') return undefined;
  const bersih = nilai.trim();
  return bersih.length > 0 ? bersih : undefined;
}

/**
 * Apakah proses ini berjalan sebagai produksi (termasuk staging).
 *
 * Dipakai untuk memilih GAGAL TERTUTUP: di lokal, bawaan dev boleh menambal
 * env yang kosong supaya `pnpm dev` jalan tanpa `.env` — itu properti yang
 * ditulis CLAUDE.md dan sengaja dipertahankan. Di produksi, bawaan dev adalah
 * cara paling sunyi menyambung ke tempat yang salah dengan kredensial yang
 * salah.
 */
export function produksi(): boolean {
  return envTeks('NODE_ENV') === 'production';
}
