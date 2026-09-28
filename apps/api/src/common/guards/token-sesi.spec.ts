import { afterEach, describe, expect, it } from 'vitest';

import { NAMA_COOKIE_SESI, asalTepercaya, tokenSesiDari, uraiCookie } from './token-sesi';

const WEB = 'https://strive-staging-web.vercel.app';
const asli = process.env['APP_URL'];

afterEach(() => {
  if (asli === undefined) delete process.env['APP_URL'];
  else process.env['APP_URL'] = asli;
});

describe('uraiCookie', () => {
  it('memisah pada `=` PERTAMA — tanda tangan base64 memuat `=`', () => {
    // `split('=')` biasa memotong tanda tangannya dan membuat token yang sah
    // terlihat rusak. Nilai Better-Auth sungguhan berakhir dengan padding.
    const c = uraiCookie('a=1; better-auth.session_token=tok.c2lnbmF0dXJl==; b=2');
    expect(c['better-auth.session_token']).toBe('tok.c2lnbmF0dXJl==');
    expect(c['a']).toBe('1');
  });

  it('header kosong atau tidak ada → objek kosong, bukan lempar', () => {
    expect(uraiCookie(undefined)).toEqual({});
    expect(uraiCookie('')).toEqual({});
    expect(uraiCookie('tanpa-tanda-sama-dengan')).toEqual({});
  });
});

describe('tokenSesiDari — Bearer', () => {
  it('Bearer dipakai apa adanya', () => {
    expect(tokenSesiDari({ authorization: 'Bearer abc123' })).toBe('abc123');
  });

  it('Bearer MENANG atas cookie, walau Bearer-nya nanti tidak sah', () => {
    // Kalau pemanggil menyebut Bearer eksplisit, itu yang ia maksud. Cookie
    // yang kebetulan ikut terbawa tidak boleh diam-diam menggantikannya —
    // galatnya jadi menunjuk sesi yang salah.
    const t = tokenSesiDari({
      authorization: 'Bearer dari-header',
      cookie: 'better-auth.session_token=dari-cookie.sig',
      origin: WEB,
    });
    expect(t).toBe('dari-header');
  });

  it('Bearer lintas situs TETAP jalan — header tidak bisa dipalsukan browser', () => {
    process.env['APP_URL'] = WEB;
    expect(tokenSesiDari({ authorization: 'Bearer abc', origin: 'https://jahat.example' })).toBe(
      'abc',
    );
  });

  it('tanpa apa pun → string kosong, bukan undefined', () => {
    expect(tokenSesiDari({})).toBe('');
  });
});

describe('tokenSesiDari — cookie', () => {
  it('tanda tangan dibuang, token diambil', () => {
    for (const nama of NAMA_COOKIE_SESI) {
      expect(tokenSesiDari({ cookie: `${nama}=tok123.tandaTangan==` }), nama).toBe('tok123');
    }
  });

  it('cookie tanpa titik dipakai apa adanya', () => {
    expect(tokenSesiDari({ cookie: 'better-auth.session_token=polos' })).toBe('polos');
  });

  it('nama __Secure- diprioritaskan saat keduanya ada', () => {
    const t = tokenSesiDari({
      cookie: 'better-auth.session_token=polos.sig; __Secure-better-auth.session_token=aman.sig',
    });
    expect(t).toBe('aman');
  });
});

describe('CSRF — cookie hanya dipercaya dari asal yang tidak asing', () => {
  it('asal ASING → cookie DIABAIKAN, request jadi anonim', () => {
    process.env['APP_URL'] = WEB;
    const t = tokenSesiDari({
      cookie: '__Secure-better-auth.session_token=curian.sig',
      origin: 'https://jahat.example',
    });
    expect(t).toBe('');
  });

  it('asal kita sendiri → cookie dipercaya', () => {
    process.env['APP_URL'] = WEB;
    expect(
      tokenSesiDari({ cookie: '__Secure-better-auth.session_token=sah.sig', origin: WEB }),
    ).toBe('sah');
  });

  it('TANPA Origin → dipercaya: browser selalu mengirimnya lintas situs', () => {
    process.env['APP_URL'] = WEB;
    expect(tokenSesiDari({ cookie: '__Secure-better-auth.session_token=sah.sig' })).toBe('sah');
  });

  it('asalTepercaya memakai daftar yang SAMA dengan CORS', () => {
    process.env['APP_URL'] = `${WEB},https://apex.contoh.id`;
    expect(asalTepercaya(WEB)).toBe(true);
    expect(asalTepercaya('https://apex.contoh.id')).toBe(true);
    expect(asalTepercaya('https://jahat.example')).toBe(false);
    expect(asalTepercaya(undefined)).toBe(true);
  });
});
