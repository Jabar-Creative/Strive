import { getIP } from 'better-auth/api';
import { describe, expect, it } from 'vitest';

import { alamatKlien, entriXff, pasangIpBetterAuth, type SumberIp } from './client-ip';

/**
 * Opsi kosong: Better-Auth 1.7.5 tidak diberi `trustedProxies`, jadi hanya
 * header bernilai tunggal yang ia percayai. Sama dengan konfigurasi proses
 * ini — hop dihitung di sini, bukan di pustakanya.
 */
const opsiBa = {} as Parameters<typeof getIP>[1];

function sumber(xff: string | undefined, soket = '10.0.0.8'): SumberIp {
  return {
    headers: xff === undefined ? {} : { 'x-forwarded-for': xff },
    socket: { remoteAddress: soket },
  };
}

describe('alamat klien dari TRUST_PROXY_HOPS', () => {
  it('hop 0 mengabaikan X-Forwarded-For, termasuk yang dipalsukan', () => {
    expect(alamatKlien(sumber('9.9.9.9'), 0)).toBe('10.0.0.8');
    expect(alamatKlien(sumber('9.9.9.9, 203.0.113.9'), 0)).toBe('10.0.0.8');
  });

  it('hop 1 mengambil entri kanan, bukan palsuan di kiri', () => {
    expect(alamatKlien(sumber('9.9.9.9, 203.0.113.9'), 1)).toBe('203.0.113.9');
  });

  it('hop 2 melewati proxy di kanan dan tetap mengabaikan palsuan di kiri', () => {
    expect(alamatKlien(sumber('9.9.9.9, 203.0.113.9, 10.1.1.1'), 2)).toBe('203.0.113.9');
  });

  it('rantai lebih pendek dari hop jatuh ke soket, tidak menebak', () => {
    expect(alamatKlien(sumber('9.9.9.9'), 2)).toBe('10.0.0.8');
  });

  it('jumlah entri dihitung tanpa menyimpan rantainya', () => {
    expect(entriXff({ 'x-forwarded-for': ' 9.9.9.9 , 203.0.113.9 ' })).toEqual([
      '9.9.9.9',
      '203.0.113.9',
    ]);
    expect(entriXff({})).toEqual([]);
  });
});

describe('header yang diserahkan ke Better-Auth', () => {
  it('rantai dengan palsuan di kiri menjadi satu IP kanan', () => {
    const req = sumber('9.9.9.9, 203.0.113.9');
    const ringkas = pasangIpBetterAuth(req, 1);

    expect(ringkas).toMatchObject({ clientIp: '203.0.113.9', xffCount: 2, hops: 1, ipSah: true });
    expect(req.headers['x-forwarded-for']).toBe('203.0.113.9');
    expect(getIP(new Headers({ 'x-forwarded-for': '9.9.9.9, 203.0.113.9' }), opsiBa)).not.toBe(
      '9.9.9.9',
    );
    expect(
      getIP(new Headers({ 'x-forwarded-for': String(req.headers['x-forwarded-for']) }), opsiBa),
    ).toBe('203.0.113.9');
  });

  it('hop 0 tidak menyerahkan IP yang dikirim klien', () => {
    const req = sumber('9.9.9.9');
    pasangIpBetterAuth(req, 0);

    expect(req.headers['x-forwarded-for']).toBe('10.0.0.8');
    expect(
      getIP(new Headers({ 'x-forwarded-for': String(req.headers['x-forwarded-for']) }), opsiBa),
    ).toBe('10.0.0.8');
    expect(
      getIP(new Headers({ 'x-forwarded-for': String(req.headers['x-forwarded-for']) }), opsiBa),
    ).not.toBe('9.9.9.9');
  });

  it('alamat tidak sah menghapus header, bukan meneruskan nilai klien', () => {
    const req: SumberIp = { headers: { 'x-forwarded-for': 'bukan-ip' } };
    const ringkas = pasangIpBetterAuth(req, 0);

    expect(ringkas.ipSah).toBe(false);
    expect(ringkas.clientIp).toBeNull();
    expect(req.headers['x-forwarded-for']).toBeUndefined();
  });
});
