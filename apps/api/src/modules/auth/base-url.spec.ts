import { afterEach, describe, expect, it } from 'vitest';

import { createAuthFromEnv } from './auth-http.provider';

/**
 * `API_URL` kosong tidak boleh menjadi baseURL kosong.
 *
 * Better-Auth menyusun tautan verifikasi email dan reset password dari
 * `baseURL`. Dengan `??`, `API_URL=` yang di-set tapi kosong lolos sebagai
 * string kosong — dan pengguna sungguhan yang lupa password menerima tautan
 * yang menunjuk entah ke mana. Kelas bug yang sama dengan `APP_URL` (R-03),
 * yang lubangnya memang tersalin ke berkas ini dan tidak ikut ditutup saat itu.
 */
describe('baseURL Better-Auth dari API_URL', () => {
  const asli = process.env['API_URL'];

  afterEach(() => {
    if (asli === undefined) delete process.env['API_URL'];
    else process.env['API_URL'] = asli;
  });

  it('KOSONG diperlakukan sebagai tidak disetel — jatuh ke bawaan dev, bukan ""', async () => {
    for (const kosong of ['', '   ']) {
      process.env['API_URL'] = kosong;
      const auth = createAuthFromEnv();
      try {
        expect(auth.options.baseURL, JSON.stringify(kosong)).toBe('http://localhost:3001');
      } finally {
        await tutupPool(auth);
      }
    }
  });

  it('nilai sungguhan dipakai apa adanya (ter-trim)', async () => {
    process.env['API_URL'] = '  https://api-staging-af8c.up.railway.app  ';
    const auth = createAuthFromEnv();
    try {
      expect(auth.options.baseURL).toBe('https://api-staging-af8c.up.railway.app');
    } finally {
      await tutupPool(auth);
    }
  });
});

async function tutupPool(auth: { options: { database?: unknown } }): Promise<void> {
  const db = auth.options.database;
  if (db && typeof db === 'object' && 'end' in db && typeof db.end === 'function') {
    await db.end();
  }
}
