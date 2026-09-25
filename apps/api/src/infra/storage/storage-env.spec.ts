import { afterEach, describe, expect, it } from 'vitest';

import { createS3FromEnv } from './storage.service';

const KUNCI = ['NODE_ENV', 'S3_ENDPOINT', 'S3_ACCESS_KEY', 'S3_SECRET_KEY'] as const;
const asli = Object.fromEntries(KUNCI.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const k of KUNCI) {
    const v = asli[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

function kosongkanS3(): void {
  delete process.env['S3_ENDPOINT'];
  delete process.env['S3_ACCESS_KEY'];
  delete process.env['S3_SECRET_KEY'];
}

describe('createS3FromEnv — gagal tertutup di produksi', () => {
  it('di luar produksi, bawaan dev tetap berlaku (stack jalan tanpa .env)', () => {
    process.env['NODE_ENV'] = 'development';
    kosongkanS3();
    expect(() => createS3FromEnv()).not.toThrow();
  });

  it('di produksi tanpa S3_*, boot GAGAL dan pesannya menyebut yang hilang', () => {
    process.env['NODE_ENV'] = 'production';
    kosongkanS3();
    expect(() => createS3FromEnv()).toThrowError(
      /S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY kosong/,
    );
  });

  it('KOSONG di produksi sama dengan tidak disetel — bukan endpoint bernama ""', () => {
    process.env['NODE_ENV'] = 'production';
    process.env['S3_ENDPOINT'] = '   ';
    process.env['S3_ACCESS_KEY'] = '';
    process.env['S3_SECRET_KEY'] = 'rahasia-sungguhan';
    expect(() => createS3FromEnv()).toThrowError(/S3_ENDPOINT, S3_ACCESS_KEY kosong/);
  });

  it('di produksi dengan S3_* lengkap, klien berdiri', () => {
    process.env['NODE_ENV'] = 'production';
    process.env['S3_ENDPOINT'] = 'https://contoh.r2.cloudflarestorage.com';
    process.env['S3_ACCESS_KEY'] = 'kunci';
    process.env['S3_SECRET_KEY'] = 'rahasia';
    expect(() => createS3FromEnv()).not.toThrow();
  });
});
