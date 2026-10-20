import { afterEach, describe, expect, it } from 'vitest';

import { bucketAssets, bucketDocuments, createS3FromEnv } from './storage.service';

const KUNCI = [
  'NODE_ENV',
  'S3_ENDPOINT',
  'S3_ACCESS_KEY',
  'S3_SECRET_KEY',
  'S3_BUCKET_DOCUMENTS',
  'S3_BUCKET_ASSETS',
] as const;
const asli = Object.fromEntries(KUNCI.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const k of KUNCI) {
    const v = asli[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

function kosongkanS3(): void {
  for (const k of KUNCI) if (k !== 'NODE_ENV') delete process.env[k];
}

/** S3_* lengkap — dipakai test yang menguji NAMA BUCKET-nya, bukan kredensial. */
function isiKredensial(): void {
  process.env['S3_ENDPOINT'] = 'https://contoh.r2.cloudflarestorage.com';
  process.env['S3_ACCESS_KEY'] = 'kunci';
  process.env['S3_SECRET_KEY'] = 'rahasia';
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
      /S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY, S3_BUCKET_DOCUMENTS, S3_BUCKET_ASSETS kosong/,
    );
  });

  it('KOSONG di produksi sama dengan tidak disetel — bukan endpoint bernama ""', () => {
    process.env['NODE_ENV'] = 'production';
    kosongkanS3();
    process.env['S3_ENDPOINT'] = '   ';
    process.env['S3_ACCESS_KEY'] = '';
    process.env['S3_SECRET_KEY'] = 'rahasia-sungguhan';
    process.env['S3_BUCKET_DOCUMENTS'] = 'prod-dokumen';
    process.env['S3_BUCKET_ASSETS'] = 'prod-aset';
    expect(() => createS3FromEnv()).toThrowError(/S3_ENDPOINT, S3_ACCESS_KEY kosong/);
  });

  it('kredensial produksi LENGKAP tapi nama bucket kosong tetap GAGAL (#237)', () => {
    // Inilah separuh gerbang yang dilaporkan #237: kredensialnya produksi,
    // tujuannya dev. Gerbang lama meloloskan keadaan ini.
    process.env['NODE_ENV'] = 'production';
    isiKredensial();
    delete process.env['S3_BUCKET_DOCUMENTS'];
    delete process.env['S3_BUCKET_ASSETS'];
    expect(() => createS3FromEnv()).toThrowError(/S3_BUCKET_DOCUMENTS, S3_BUCKET_ASSETS kosong/);
  });

  it('di produksi dengan S3_* DAN bucket lengkap, klien berdiri', () => {
    process.env['NODE_ENV'] = 'production';
    isiKredensial();
    process.env['S3_BUCKET_DOCUMENTS'] = 'prod-dokumen';
    process.env['S3_BUCKET_ASSETS'] = 'prod-aset';
    expect(() => createS3FromEnv()).not.toThrow();
  });
});

describe('nama bucket — gagal tertutup di produksi (#237)', () => {
  it('di produksi tanpa env, NAMA BUCKET melempar alih-alih memakai bawaan dev', () => {
    // Penjaga di `createS3FromEnv()` menangkapnya saat boot, dan ini
    // menangkapnya di jalur mana pun yang memanggil fungsi bucket tanpa
    // pernah membuat klien S3 — worker, skrip perbaikan data, test yang
    // merakit modulnya sendiri.
    process.env['NODE_ENV'] = 'production';
    kosongkanS3();
    expect(() => bucketDocuments()).toThrowError(/S3_BUCKET_DOCUMENTS kosong di produksi/);
    expect(() => bucketAssets()).toThrowError(/S3_BUCKET_ASSETS kosong di produksi/);
  });

  it('pesannya MENYEBUT nama bawaan dev-nya — supaya yang membaca log tahu apa yang dihindari', () => {
    process.env['NODE_ENV'] = 'production';
    kosongkanS3();
    expect(() => bucketDocuments()).toThrowError(/strive-documents/);
  });

  it('KOSONG di produksi sama dengan tidak disetel, bukan bucket bernama spasi', () => {
    process.env['NODE_ENV'] = 'production';
    kosongkanS3();
    process.env['S3_BUCKET_DOCUMENTS'] = '   ';
    expect(() => bucketDocuments()).toThrowError(/kosong di produksi/);
  });

  it('di produksi dengan env terisi, nilainya dipakai apa adanya', () => {
    process.env['NODE_ENV'] = 'production';
    process.env['S3_BUCKET_DOCUMENTS'] = 'prod-dokumen';
    process.env['S3_BUCKET_ASSETS'] = 'prod-aset';
    expect(bucketDocuments()).toBe('prod-dokumen');
    expect(bucketAssets()).toBe('prod-aset');
  });

  it('di luar produksi, bawaan dev tetap berlaku (stack jalan tanpa .env)', () => {
    process.env['NODE_ENV'] = 'development';
    kosongkanS3();
    expect(bucketDocuments()).toBe('strive-documents');
    expect(bucketAssets()).toBe('strive-assets');
  });
});
