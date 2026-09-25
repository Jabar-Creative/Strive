import { afterEach, describe, expect, it } from 'vitest';

import { envTeks, produksi } from './env';

const KUNCI = 'STRIVE_UJI_ENV';
const asliNodeEnv = process.env['NODE_ENV'];

afterEach(() => {
  delete process.env[KUNCI];
  if (asliNodeEnv === undefined) delete process.env['NODE_ENV'];
  else process.env['NODE_ENV'] = asliNodeEnv;
});

describe('envTeks', () => {
  it('tidak disetel → undefined', () => {
    expect(envTeks(KUNCI)).toBeUndefined();
  });

  it('KOSONG diperlakukan sebagai tidak disetel — ini seluruh gunanya', () => {
    // Kelas bug yang sama dengan `APP_URL` (R-03): `??` meloloskan string
    // kosong, lalu konsumennya memakainya sebagai nilai sah.
    for (const kosong of ['', ' ', '\t', '\n  ']) {
      process.env[KUNCI] = kosong;
      expect(envTeks(KUNCI), JSON.stringify(kosong)).toBeUndefined();
    }
  });

  it('nilai sungguhan dikembalikan sudah ter-trim', () => {
    process.env[KUNCI] = '  https://api.contoh.test  ';
    expect(envTeks(KUNCI)).toBe('https://api.contoh.test');
  });
});

describe('produksi', () => {
  it('hanya `production` yang dihitung produksi', () => {
    for (const [nilai, harap] of [
      ['production', true],
      ['development', false],
      ['test', false],
      ['', false],
      ['  ', false],
    ] as const) {
      process.env['NODE_ENV'] = nilai;
      expect(produksi(), JSON.stringify(nilai)).toBe(harap);
    }
  });
});
