/** Origin web saat pengembangan, dan satu-satunya cadangan yang dipakai. */
export const ORIGIN_DEV = 'http://localhost:3000';

/**
 * Daftar origin yang boleh memanggil API — temuan audit `R-03`.
 *
 * ── Kenapa ini ada, padahal `process.env['APP_URL'] ?? ORIGIN_DEV` muat satu
 *    baris ──
 *
 * Karena baris itu punya lubang, dan lubangnya tersalin di tiga tempat
 * (`main.ts`, `squad.gateway.ts`, `auth-http.provider.ts`).
 *
 * `??` hanya menangkap `undefined`/`null`, **bukan string kosong**. Dengan
 * `APP_URL=` yang di-set tapi kosong, hasilnya `origin: ''` — dan paket `cors`
 * memperlakukan origin falsy sebagai **`*`**:
 *
 * > `if (!options.origin || options.origin === '*') { … value: '*' }`
 *
 * Itu bukan kemungkinan teoretis. Template env produksi di `docs/PRD.md` §17
 * mengirimkan `APP_URL=` kosong dengan contohnya di komentar, jadi siapa pun
 * yang menyalinnya untuk deploy mendapat `Access-Control-Allow-Origin: *` di
 * REST **dan** WebSocket sekaligus, tanpa satu pun galat.
 *
 * ── Gagal tertutup, bukan terbuka ──
 *
 * Nilai kosong diperlakukan sebagai TIDAK DISETEL, jadi jatuh ke origin dev.
 * Di produksi itu berarti frontend sungguhan ditolak CORS — keras, terlihat,
 * dan diperbaiki dalam lima menit. Kebalikannya (`*`) tidak terlihat sama
 * sekali sampai seseorang menyadarinya.
 *
 * ── Daftar, bukan satu nilai ──
 *
 * §16.1 meminta *"CORS whitelist eksplisit"*. Satu string tidak bisa memuat
 * apex + `www`, atau produksi + staging. Dipisah koma.
 */
export function appOrigins(): string[] {
  const daftar = (process.env['APP_URL'] ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
  return daftar.length > 0 ? daftar : [ORIGIN_DEV];
}
