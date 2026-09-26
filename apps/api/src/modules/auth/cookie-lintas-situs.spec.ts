import { afterEach, describe, expect, it } from 'vitest';

import { createAuthFromEnv } from './auth-http.provider';
import { atributCookieLintasSitus, cookieLintasSitus, createAuth } from './auth.config';

/**
 * F-05 opsi A — cookie sesi lintas situs.
 *
 * Web (vercel.app) dan API (up.railway.app) adalah dua situs: keduanya ada di
 * Public Suffix List. SameSite=Lax bawaan tidak ikut terkirim pada permintaan
 * lintas situs, jadi login menjawab 200 lalu halaman berikutnya anonim.
 *
 * Hanya string `true` yang menyalakan. Nilai lain — termasuk kosong — membiarkan
 * atribut bawaan Better-Auth (SameSite=Lax). Staging menyetel persis `true`.
 */

const RAHASIA = 'rahasia-uji-yang-cukup-panjang-0123456789';
const URL_DB = 'postgres://vitest:vitest@127.0.0.1:1/tidak_terkoneksi';

describe('AUTH_COOKIE_CROSS_SITE', () => {
  it('hanya string true (setelah trim) yang menyala', () => {
    expect(cookieLintasSitus('true')).toBe(true);
    expect(cookieLintasSitus('  true  ')).toBe(true);
    for (const nilai of [undefined, '', '   ', 'false', 'TRUE', 'True', '1', 'yes', 'none']) {
      expect(cookieLintasSitus(nilai), JSON.stringify(nilai)).toBe(false);
    }
  });

  it('nyala → SameSite=None dan Secure, tanpa menimpa httpOnly', () => {
    // Better-Auth menggabungkan objek ini DI ATAS bawaan
    // `{ sameSite: 'lax', httpOnly: true, path: '/' }`. Yang tidak disebut
    // di sini tetap bawaan — termasuk httpOnly.
    expect(atributCookieLintasSitus(true)).toEqual({ sameSite: 'none', secure: true });
  });

  it('mati → tidak memasang defaultCookieAttributes', () => {
    expect(atributCookieLintasSitus(false)).toBeUndefined();
  });

  it('createAuth memasang atribut hanya saat diminta', async () => {
    const dasar = {
      connectionString: URL_DB,
      secret: RAHASIA,
      baseURL: 'https://api-staging-af8c.up.railway.app',
    };
    const mati = createAuth(dasar);
    const nyala = createAuth({ ...dasar, crossSiteCookie: true });
    try {
      expect(mati.options.advanced?.defaultCookieAttributes).toBeUndefined();
      expect(nyala.options.advanced?.defaultCookieAttributes).toEqual({
        sameSite: 'none',
        secure: true,
      });
      expect(nyala.options.advanced?.disableOriginCheck).toBe(false);
    } finally {
      await tutupPool(mati);
      await tutupPool(nyala);
    }
  });

  describe('createAuthFromEnv', () => {
    const asli = process.env['AUTH_COOKIE_CROSS_SITE'];

    afterEach(() => {
      if (asli === undefined) delete process.env['AUTH_COOKIE_CROSS_SITE'];
      else process.env['AUTH_COOKIE_CROSS_SITE'] = asli;
    });

    it('true di env sampai ke opsi Better-Auth', async () => {
      process.env['AUTH_COOKIE_CROSS_SITE'] = 'true';
      const auth = createAuthFromEnv();
      try {
        expect(auth.options.advanced?.defaultCookieAttributes).toEqual({
          sameSite: 'none',
          secure: true,
        });
      } finally {
        await tutupPool(auth);
      }
    });

    it('tidak disetel → perilaku sekarang (tanpa atribut tambahan)', async () => {
      delete process.env['AUTH_COOKIE_CROSS_SITE'];
      const auth = createAuthFromEnv();
      try {
        expect(auth.options.advanced?.defaultCookieAttributes).toBeUndefined();
      } finally {
        await tutupPool(auth);
      }
    });
  });
});

async function tutupPool(auth: { options: { database?: unknown } }): Promise<void> {
  const db = auth.options.database;
  if (db && typeof db === 'object' && 'end' in db && typeof db.end === 'function') {
    await db.end();
  }
}
