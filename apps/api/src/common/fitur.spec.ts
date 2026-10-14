import { ServiceUnavailableException } from '@nestjs/common';
import { afterEach, describe, expect, it } from 'vitest';

import { fiturNyala, pastikanTopUpNyala, topUpNyala } from './fitur';

/**
 * Kill switch §19.3 — isu #157.
 *
 * Yang dijaga di sini bukan "fungsinya mengembalikan boolean", melainkan dua
 * keputusan yang kalau terbalik akan merusak hal yang berbeda:
 *
 * 1. **Tidak disetel = NYALA.** Kill switch yang gagal tertutup mematikan
 *    penjualan setiap kali ada yang lupa satu variabel.
 * 2. **Di-set tapi KOSONG = NYALA**, bukan mati. `??` hanya menangkap
 *    `undefined`/`null`, dan jebakan itu sudah menggigit di `APP_URL=` kosong
 *    yang membuat `cors` memulangkan `*`. Di sini arahnya kebetulan aman —
 *    dan "kebetulan aman" bukan alasan membiarkannya tanpa penjaga.
 */

const asli = process.env['FEATURE_TOPUP_ENABLED'];

afterEach(() => {
  if (asli === undefined) delete process.env['FEATURE_TOPUP_ENABLED'];
  else process.env['FEATURE_TOPUP_ENABLED'] = asli;
});

describe('fiturNyala (isu #157)', () => {
  it('tidak disetel = NYALA — gagal TERBUKA, dan itu disengaja', () => {
    delete process.env['FEATURE_TOPUP_ENABLED'];
    expect(topUpNyala()).toBe(true);
    expect(() => pastikanTopUpNyala()).not.toThrow();
  });

  it('di-set tapi KOSONG tetap NYALA — `??` tidak akan menangkap ini', () => {
    process.env['FEATURE_TOPUP_ENABLED'] = '';
    expect(topUpNyala()).toBe(true);
  });

  it('hanya spasi juga tetap NYALA', () => {
    process.env['FEATURE_TOPUP_ENABLED'] = '   ';
    expect(topUpNyala()).toBe(true);
  });

  it('empat ejaan MATI dikenali, apa pun kapitalisasinya', () => {
    for (const v of ['false', 'FALSE', '0', 'off', 'No']) {
      process.env['FEATURE_TOPUP_ENABLED'] = v;
      expect(topUpNyala(), v).toBe(false);
    }
  });

  it('nilai lain = NYALA — tombol yang salah tulis tidak boleh mematikan penjualan', () => {
    for (const v of ['true', '1', 'on', 'ya', 'mungkin']) {
      process.env['FEATURE_TOPUP_ENABLED'] = v;
      expect(topUpNyala(), v).toBe(true);
    }
  });

  it('mati → 503 ber-`code` dari daftar §10.2, bukan kode baru', () => {
    process.env['FEATURE_TOPUP_ENABLED'] = 'false';
    let galat: unknown;
    try {
      pastikanTopUpNyala();
    } catch (e) {
      galat = e;
    }
    expect(galat).toBeInstanceOf(ServiceUnavailableException);
    const badan = (galat as ServiceUnavailableException).getResponse() as {
      error: { code: string; details: Record<string, unknown> };
    };
    expect(badan.error.code).toBe('PROVIDER_UNAVAILABLE');
    expect((galat as ServiceUnavailableException).getStatus()).toBe(503);
    // Pesan yang buntu tidak menolong: ia harus menyebut bahwa ini sementara.
    expect(JSON.stringify(badan)).toContain('nanti');
  });

  it('nama flag lain ikut terbaca — satu pembaca, bukan satu per fitur', () => {
    delete process.env['FEATURE_APA_PUN'];
    expect(fiturNyala('FEATURE_APA_PUN')).toBe(true);
    process.env['FEATURE_APA_PUN'] = 'off';
    expect(fiturNyala('FEATURE_APA_PUN')).toBe(false);
    delete process.env['FEATURE_APA_PUN'];
  });
});
