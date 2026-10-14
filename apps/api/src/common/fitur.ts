import { ServiceUnavailableException } from '@nestjs/common';

import { envTeks } from './env';

/**
 * Kill switch fitur — PRD §19.3, isu #157.
 *
 * ── Satu yang dibangun, bukan empat ──
 *
 * §19.3 menjanjikan EMPAT kill switch dan kode membaca NOL. Keputusan Dev A
 * 14 Okt: bangun satu, lalu tulis ulang §19.3 untuk tiga sisanya — karena
 * ketiga sisanya sudah punya cara dimatikan yang lebih baik daripada flag:
 *
 * - `FEATURE_SCAN_ENABLED`: `K-03` sudah GAGAL TERTUTUP tanpa kredensial
 *   Copyleaks — setiap webhook ditolak dan provider tidak pernah dipanggil.
 *   Flag di atasnya hanya menambah satu tempat lagi yang bisa salah.
 * - `FEATURE_WS_ENABLED`: `RT-5` sudah mewajibkan setiap layar benar TANPA
 *   satu pun event WS, dan `Q-05` membuktikannya di browser. Mematikan WS
 *   berarti tidak menyalakan gateway-nya, bukan menyetel variabel.
 * - `FEATURE_MASTERY_ENABLED`: `MT-02`/`MT-03` belum ada. Flag untuk fitur
 *   yang belum dibangun adalah tombol yang tidak tersambung ke apa pun.
 *
 * **`FEATURE_TOPUP_ENABLED` yang berbeda**, dan itu yang membuatnya pantas
 * punya kodenya sendiri: ia memindahkan uang sungguhan, kredensialnya ADA di
 * produksi (jadi tidak gagal tertutup), dan alasan mematikannya — masalah di
 * sisi payment — adalah keadaan yang muncul mendadak dan menuntut jawaban
 * dalam menit, bukan dalam satu siklus deploy. "Hentikan penjualan, bukan
 * seluruh app" hanya bisa dilakukan tanpa deploy kalau tombolnya ada.
 *
 * ── Bawaannya NYALA, dan kosong berarti tidak disetel ──
 *
 * Kill switch yang gagal tertutup adalah kill switch yang mematikan penjualan
 * setiap kali ada yang lupa menyetel satu variabel. Jadi: tidak disetel =
 * nyala.
 *
 * `envTeks` dipakai, bukan `process.env[...] ?? '...'` — `??` hanya menangkap
 * `undefined`/`null`, dan `FEATURE_TOPUP_ENABLED=` yang di-set tapi KOSONG
 * akan terbaca sebagai nilai. Itu jebakan yang sama dengan `APP_URL=` kosong
 * yang membuat `cors` memulangkan `*`, dan di sini arahnya kebetulan aman —
 * tapi "kebetulan aman" bukan alasan menulisnya dua kali dengan dua cara.
 */
const MATI = new Set(['false', '0', 'off', 'no']);

export function fiturNyala(nama: string): boolean {
  const v = envTeks(nama);
  if (v === undefined) return true;
  return !MATI.has(v.toLowerCase());
}

/** `FEATURE_TOPUP_ENABLED` — §19.3. */
export function topUpNyala(): boolean {
  return fiturNyala('FEATURE_TOPUP_ENABLED');
}

/**
 * Melempar kalau top-up sedang dimatikan.
 *
 * `PROVIDER_UNAVAILABLE` 503, bukan kode baru: §10.2 baru saja ditutup ulang
 * dengan tujuh tambahan (#92), dan membukanya lagi sehari kemudian demi satu
 * keadaan yang sudah punya kode yang bisa dipakai adalah urutan yang salah.
 * Dari sudut pandang klien keadaannya memang "kemampuan ini tidak tersedia
 * sekarang, coba lagi nanti" — yang persis arti 503, dan barisnya di §10.2
 * sudah menyebut "belum dikonfigurasi".
 *
 * Kalau nanti UI perlu MEMBEDAKAN "dimatikan sengaja" dari "vendor mati" —
 * mis. untuk menampilkan kalimat yang berbeda — itu keputusan §10.2, bukan
 * perubahan di sini.
 */
export function pastikanTopUpNyala(): void {
  if (topUpNyala()) return;
  throw new ServiceUnavailableException({
    error: {
      code: 'PROVIDER_UNAVAILABLE',
      message: 'Top-up koin sedang dimatikan sementara. Coba lagi nanti.',
      details: {},
    },
  });
}
