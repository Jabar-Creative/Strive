import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ORIGIN_DEV, appOrigins } from './app-origin';

const asli = process.env['APP_URL'];

describe('R-03 — daftar origin CORS', () => {
  beforeEach(() => delete process.env['APP_URL']);
  afterEach(() => {
    if (asli === undefined) delete process.env['APP_URL'];
    else process.env['APP_URL'] = asli;
  });

  it('tidak disetel → origin dev', () => {
    expect(appOrigins()).toEqual([ORIGIN_DEV]);
  });

  it('KOSONG diperlakukan sebagai tidak disetel — tidak pernah menjadi `*`', () => {
    // Jebakan yang sebenarnya: `??` meloloskan string kosong, dan paket `cors`
    // membaca origin falsy sebagai `*`. Template env produksi PRD §17
    // mengirimkan `APP_URL=` kosong.
    for (const kosong of ['', '   ', ',', ' , ']) {
      process.env['APP_URL'] = kosong;
      expect(appOrigins(), JSON.stringify(kosong)).toEqual([ORIGIN_DEV]);
    }
  });

  it('satu origin dipakai apa adanya', () => {
    process.env['APP_URL'] = 'https://app.striveacademy.id';
    expect(appOrigins()).toEqual(['https://app.striveacademy.id']);
  });

  it('beberapa origin dipisah koma — whitelist eksplisit', () => {
    process.env['APP_URL'] = 'https://app.striveacademy.id, https://www.striveacademy.id';
    expect(appOrigins()).toEqual(['https://app.striveacademy.id', 'https://www.striveacademy.id']);
  });

  it('tidak pernah mengembalikan daftar kosong maupun nilai falsy', () => {
    for (const nilai of ['', 'a', 'a,b', '  ,  ,  ']) {
      process.env['APP_URL'] = nilai;
      const hasil = appOrigins();
      expect(hasil.length).toBeGreaterThan(0);
      expect(hasil.every((x) => typeof x === 'string' && x.length > 0)).toBe(true);
      expect(hasil).not.toContain('*');
    }
  });
});
