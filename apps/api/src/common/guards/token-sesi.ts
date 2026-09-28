/**
 * Mengambil token sesi dari sebuah request — `Authorization: Bearer` ATAU
 * cookie sesi Better-Auth. Keputusan #154, opsi (b).
 *
 * ── Kenapa dua-duanya, bukan salah satu ──
 *
 * Sampai 28 September 2026 hanya Bearer yang diterima, sementara
 * `apps/web` mengirim cookie (`credentials: 'include'`). Keduanya benar
 * sendiri-sendiri dan tidak pernah bertemu: `/me` selalu 401, `/mentor` dan
 * `/admin` memulangkan pengguna yang sudah masuk ke `/login`, dan pemain
 * lesson `L-04` tidak bisa memuat satu kartu pun. Diukur ke staging dengan
 * cookie sesi bertanda tangan yang SAH — 401 untuk keduanya.
 *
 * Opsi (b) dipilih karena cookie tetap `httpOnly` (tidak ada token di
 * jangkauan JavaScript) DAN karena logout ikut benar secara gratis:
 * Better-Auth mengenali sesi yang dicabut hanya dari cookie, jadi jalur
 * Bearer memberi `POST /sign-out` yang menjawab 200 tanpa mencabut apa pun.
 *
 * Bearer TIDAK dibuang: ia dipakai skrip operasional, test integrasi, dan
 * verifikasi manual. Yang berubah cuma penambahan jalan kedua.
 *
 * ── Kenapa tanda tangan cookie TIDAK diverifikasi di sini ──
 *
 * Cookie Better-Auth berbentuk `<token>.<tanda-tangan>`; yang tersimpan di
 * `sessions.token` hanya bagian pertama. Verifikasi tanda tangan ada supaya
 * nilai cookie bisa dipercaya TANPA menyentuh database. Jalur ini selalu
 * menyentuh database: token dicocokkan ke baris `sessions`, dan baris itu
 * yang menentukan sah atau tidak.
 *
 * Jadi tanda tangan tidak menambah apa pun di sini — token karangan gagal di
 * lookup, dan token CURIAN sudah cukup bagi penyerang dengan atau tanpa
 * tanda tangannya. Yang ia tambahkan adalah ketergantungan pada skema
 * penandatanganan Better-Auth, yang bisa berubah tanpa memberi tahu kita.
 *
 * Konsekuensi yang diterima sadar: kita menerima cookie yang tanda tangannya
 * rusak tapi tokennya benar. Itu hanya bisa terjadi pada orang yang sudah
 * memegang tokennya.
 *
 * ── Harga opsi (b): CSRF, dan di mana ia dibayar ──
 *
 * Cookie dikirim browser OTOMATIS, termasuk pada request yang dipicu situs
 * lain. Bearer tidak — header tidak pernah terpasang sendiri. Jadi menerima
 * cookie membuka vektor yang sebelumnya tertutup, dan `SameSite=None` yang
 * dipakai staging (web dan API dua situs berbeda) mematikan perlindungan
 * bawaan browser sepenuhnya.
 *
 * Yang dipasang di sini BUKAN penjaga global baru, melainkan syarat pada
 * jalur cookie saja: **cookie hanya dipercaya kalau `Origin` request tidak
 * asing.** Konsekuensinya request lintas-situs palsu diperlakukan ANONIM —
 * ia jatuh ke `UNAUTHENTICATED`, kode yang sudah ada dan yang artinya memang
 * benar di situ.
 *
 * Tiga alasan bentuk ini dipilih ketimbang guard global ber-kode baru:
 *
 * 1. Daftar kode error §10.2 **TERTUTUP**, dan `packages/contracts` milik
 *    Dev B. Menambah kode berarti mengubah kontrak lewat PR terpisah; yang
 *    ada sekarang sudah cukup untuk menyatakan kebenarannya.
 * 2. Ia hanya melucuti vektor yang benar-benar ada. Pemanggil Bearer —
 *    skrip, test integrasi, verifikasi manual — tidak terpengaruh sama
 *    sekali, karena Bearer memang tidak bisa dipalsukan lintas situs.
 * 3. Webhook vendor (Midtrans, Copyleaks) tidak mengirim `Origin` dan tidak
 *    memakai cookie. Penjaga global atas semua request yang mengubah keadaan
 *    akan menaruh perangkap di jalur yang tidak punya masalah ini.
 *
 * `Origin` yang TIDAK ADA diperlakukan aman: browser selalu mengirimnya pada
 * request lintas-origin, termasuk form POST. Ketiadaannya berarti pemanggil
 * bukan browser lintas situs — dan itu juga yang membuat navigasi same-origin
 * (yang boleh tanpa `Origin` untuk GET) tetap jalan saat web dan API suatu
 * saat satu domain.
 */

import { appOrigins } from '../app-origin';

/**
 * Nama cookie Better-Auth. Prefiks `__Secure-` dipasang saat `useSecureCookies`
 * menyala (produksi/staging, HTTPS); di lokal HTTP namanya polos. Keduanya
 * diterima karena satu berkas ini melayani kedua lingkungan.
 */
export const NAMA_COOKIE_SESI = [
  '__Secure-better-auth.session_token',
  'better-auth.session_token',
] as const;

const AWALAN_BEARER = 'Bearer ';

/** Satu nilai header, apa pun bentuk yang diberikan Node. */
function satuHeader(nilai: string | string[] | undefined): string | undefined {
  return Array.isArray(nilai) ? nilai[0] : nilai;
}

/**
 * Mengurai header `Cookie` tanpa dependensi.
 *
 * Nilai cookie boleh mengandung `=` (tanda tangan base64), jadi pemisahan
 * dilakukan pada `=` PERTAMA saja — `split('=')` biasa akan memotong tanda
 * tangannya dan membuat token yang sah terlihat rusak.
 */
export function uraiCookie(header: string | undefined): Record<string, string> {
  const hasil: Record<string, string> = {};
  if (!header) return hasil;
  for (const bagian of header.split(';')) {
    const potong = bagian.indexOf('=');
    if (potong < 1) continue;
    const nama = bagian.slice(0, potong).trim();
    const nilai = bagian.slice(potong + 1).trim();
    if (nama.length > 0 && !(nama in hasil)) hasil[nama] = nilai;
  }
  return hasil;
}

/**
 * Token sesi dari request, atau `''` kalau tidak ada.
 *
 * Bearer diperiksa lebih dulu: kalau pemanggil menyebutkannya eksplisit,
 * itu yang ia maksud — cookie yang kebetulan ikut terbawa tidak boleh
 * diam-diam menggantikannya saat Bearer-nya ternyata tidak sah.
 */
export function tokenSesiDari(headers: Record<string, string | string[] | undefined>): string {
  const auth = satuHeader(headers['authorization']);
  if (auth?.startsWith(AWALAN_BEARER)) return auth.slice(AWALAN_BEARER.length).trim();

  // Cookie hanya dipercaya kalau asal request bukan situs asing — lihat
  // catatan CSRF di atas. `Origin` yang tidak ada berarti bukan browser
  // lintas situs, jadi dibiarkan lewat.
  if (!asalTepercaya(satuHeader(headers['origin']))) return '';

  const cookie = uraiCookie(satuHeader(headers['cookie']));
  for (const nama of NAMA_COOKIE_SESI) {
    const mentah = cookie[nama];
    if (!mentah) continue;
    // Buang tanda tangan: `<token>.<tanda-tangan>`. `sessions.token` hanya
    // menyimpan bagian pertama. Cookie tanpa titik dipakai apa adanya.
    const titik = mentah.indexOf('.');
    const token = titik === -1 ? mentah : mentah.slice(0, titik);
    if (token.length > 0) return decodeURIComponent(token);
  }
  return '';
}

/**
 * `Origin` boleh dipercaya untuk autentikasi berbasis cookie?
 *
 * Sumber daftarnya `appOrigins()` — SAMA dengan CORS dan `trustedOrigins`
 * Better-Auth. Tiga tempat yang menjawab "siapa frontend kita" harus tidak
 * bisa berselisih, dan `appOrigins()` sudah gagal-tertutup untuk nilai kosong
 * (temuan `R-03`).
 */
export function asalTepercaya(origin: string | undefined): boolean {
  if (origin === undefined || origin.trim().length === 0) return true;
  return appOrigins().includes(origin.trim());
}
