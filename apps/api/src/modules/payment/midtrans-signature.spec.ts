import { describe, expect, it } from 'vitest';

import { hitungTandaTangan, tandaTanganSah } from './midtrans-signature';

/**
 * `PA-6` — `SHA512(order_id + status_code + gross_amount + server_key)`.
 *
 * Vektornya **dipaku**, bukan dihitung ulang di dalam test. Test yang
 * menghitung harapannya dengan rumus yang sama dengan kode yang diujinya
 * membuktikan bahwa `createHash` konsisten dengan dirinya sendiri — dan tetap
 * hijau kalau urutan bidangnya tertukar, yang justru satu-satunya hal yang
 * mungkin salah di sini.
 */
const ORDER = 'ORDER-1';
const STATUS = '200';
const JUMLAH = '55000.00';
const KUNCI = 'SB-Mid-server-RAHASIA';
const BENAR =
  'a3c2ed100178d5dcb855809fbbda9d5cdb83279fbd45ef1cd0fe15f345d99ddd' +
  '96195984e3b1c35efa7e21181139ad61a5b5ebb39d0cb78abc3e05ccdb4489a4';

describe('P-03 — tanda tangan Midtrans (PA-6)', () => {
  it('cocok dengan vektor yang dipaku', () => {
    expect(hitungTandaTangan(ORDER, STATUS, JUMLAH, KUNCI)).toBe(BENAR);
  });

  it('urutan bidang tidak bisa ditukar diam-diam', () => {
    // Bukan sekadar "beda": ini yang akan terjadi kalau seseorang menyusun
    // ulang argumennya dan test vektornya tidak dipaku.
    expect(hitungTandaTangan(STATUS, ORDER, JUMLAH, KUNCI)).not.toBe(BENAR);
  });

  it('gross_amount "55000.00" dan "55000" BUKAN hal yang sama', () => {
    // Midtrans mengirim dua desimal. Mengangkakan lalu men-string-kan ulang
    // menghasilkan nilai kedua, dan tanda tangan yang benar pun jadi gagal.
    expect(hitungTandaTangan(ORDER, STATUS, '55000', KUNCI)).not.toBe(BENAR);
  });

  it('menerima tanda tangan yang benar', () => {
    expect(
      tandaTanganSah({
        orderId: ORDER,
        statusCode: STATUS,
        grossAmount: JUMLAH,
        signatureKey: BENAR,
        serverKey: KUNCI,
      }),
    ).toBe(true);
  });

  it('menolak kunci server yang SALAH', () => {
    expect(
      tandaTanganSah({
        orderId: ORDER,
        statusCode: STATUS,
        grossAmount: JUMLAH,
        signatureKey: BENAR,
        serverKey: 'SB-Mid-server-BUKAN-INI',
      }),
    ).toBe(false);
  });

  it('menolak SEMUANYA kalau kunci server kosong', () => {
    // Jebakan yang paling mungkin terjadi sungguhan: `.env` produksi tanpa
    // MIDTRANS_SERVER_KEY. Tanpa penjagaan ini, seluruh bahan tanda tangan ada
    // di badan request, jadi siapa pun bisa menghitungnya sendiri dan menambah
    // koin sungguhan.
    const palsu = hitungTandaTangan(ORDER, STATUS, JUMLAH, '');
    expect(
      tandaTanganSah({
        orderId: ORDER,
        statusCode: STATUS,
        grossAmount: JUMLAH,
        signatureKey: palsu,
        serverKey: '',
      }),
    ).toBe(false);
  });

  it('tanda tangan dengan panjang berbeda ditolak, bukan melempar', () => {
    // `timingSafeEqual` melempar untuk panjang yang tidak sama — dan galat
    // yang tidak tertangani di webhook berarti 500, lalu Midtrans mengirim
    // ulang selamanya.
    for (const busuk of ['', 'pendek', BENAR + 'a']) {
      expect(() =>
        tandaTanganSah({
          orderId: ORDER,
          statusCode: STATUS,
          grossAmount: JUMLAH,
          signatureKey: busuk,
          serverKey: KUNCI,
        }),
      ).not.toThrow();
      expect(
        tandaTanganSah({
          orderId: ORDER,
          statusCode: STATUS,
          grossAmount: JUMLAH,
          signatureKey: busuk,
          serverKey: KUNCI,
        }),
      ).toBe(false);
    }
  });
});
