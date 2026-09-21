/**
 * Keputusan akses area konsol, A-04 (Dev B).
 *
 * SELURUH percabangan (student) vs (console) hidup di file ini sebagai fungsi
 * murni; middleware hanya memasok dua fakta dan menjalankan hasilnya. Alasannya
 * sama dengan pola guard di API (A-02): keputusan otorisasi harus bisa dibaca
 * dan diuji di satu tempat, bukan tersebar di glue code.
 *
 * Sumber peran: GET /api/v1/me (A-05) — objek sesi Better-Auth tidak memuat
 * `role`, dan clausul CLAUDE.md 9 berlaku juga di sini: client tidak pernah
 * dipercaya menentukan perannya sendiri, cookie hanyalah kendaraan menuju
 * keputusan yang diambil server.
 */

/** Peran yang diakui sistem (PRD §2.3). */
export type PeranConsole = 'student' | 'mentor' | 'superadmin';

/** Tiga kemungkinan jawaban untuk permintaan masuk area konsol. */
export type KeputusanConsole = 'lewat' | 'login' | 'terlarang';

/**
 * Memutuskan nasib satu permintaan berdasar jawaban GET /me.
 *
 * - `statusMe` 0 berarti fetch gagal total (timeout / API mati).
 * - `peran` diambil dari body /me; hilang berarti sesi sah tapi peran tak
 *   terbaca, dan itu TIDAK diasumsikan baik.
 *
 * Kegagalan membaca peran memilih `terlarang` (gagal-tertutup), bukan
 * `login`: pengguna memang punya sesi, melemparnya ke /login menuduhnya
 * belum masuk. Bukan `lewat` juga: konsol terbuka tanpa bukti peran adalah
 * kebocoran. Harga kecilnya, mentor sesaat melihat 403 saat API terganggu,
 * tertulis di halamannya sebagai saran muat ulang.
 */
export function putusAksesConsole(
  statusMe: number,
  peran: string | null | undefined,
): KeputusanConsole {
  if (statusMe === 401 || statusMe === 403) return 'login';
  if (statusMe !== 200) return 'terlarang';
  if (peran === 'mentor' || peran === 'superadmin') return 'lewat';
  return 'terlarang';
}

/**
 * Halaman 403 yang dikirim middleware.
 *
 * Kenapa HTML statis di dalam bundle, bukan rute React: hanya Response dari
 * middleware yang bisa membawa status 403 sungguhan untuk halaman (rute dan
 * rewrite selalu 200), dan AC A-04 menuntut keduanya sekaligus: 403 DAN
 * halaman yang jelas. String ini TIDAK PERNAH diinterpolasi apa pun, jadi
 * tidak ada jalan masuk bagi input pengguna (XSS) ke sini.
 */
export const HALAMAN_TERLARANG = `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>403, Area konsol, Strive Academy</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; margin: 0; }
  body {
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    min-height: 100svh; display: grid; place-items: center; padding: 24px;
    background: #ffffff; color: #171717;
  }
  @media (prefers-color-scheme: dark) {
    body { background: #0f0f10; color: #ededed; }
    a { color: #a5b4fc; }
  }
  main { max-width: 26rem; text-align: center; }
  .kode {
    font-size: 3.5rem; font-weight: 700; letter-spacing: -0.04em;
    color: #4f46e5;
  }
  h1 { font-size: 1.25rem; font-weight: 600; margin: 4px 0 12px; }
  p { font-size: 0.95rem; line-height: 1.6; }
  .sub { color: #6b7280; margin-top: 8px; font-size: 0.875rem; }
  a {
    display: inline-block; margin-top: 20px; padding: 10px 20px;
    border-radius: 8px; background: #4f46e5; color: #ffffff;
    font-weight: 600; text-decoration: none; font-size: 0.95rem;
  }
  a:hover { background: #4338ca; }
</style>
</head>
<body>
<main>
  <p class="kode">403</p>
  <h1>Area konsol</h1>
  <p>Halaman ini hanya untuk <strong>mentor</strong> dan
  <strong>superadmin</strong>.</p>
  <p class="sub">Kalau akunmu memang mentor atau superadmin, coba muat ulang
  halaman ini; kalau tetap muncul, keluar lalu masuk kembali.</p>
  <a href="/hub">Kembali ke Hub</a>
</main>
</body>
</html>`;
