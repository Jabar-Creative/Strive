import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { muatEnv, uraiEnv } from '../../../scripts/env-berkas.mjs';

/**
 * `.env` tidak pernah dimuat siapa pun, sementara galat `pnpm dev:api`
 * menyuruh menyalinnya. Ditemukan Dev B saat onboarding (PR #178).
 */

const AKAR_REPO = join(__dirname, '..', '..', '..');
const KUNCI = 'STRIVE_UJI_ENV_BERKAS';

afterEach(() => delete process.env[KUNCI]);

function repoTiruan(isi: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'strive-env-'));
  writeFileSync(join(dir, '.env'), isi, 'utf8');
  return dir;
}

describe('uraiEnv', () => {
  it('melewati baris kosong dan komentar', () => {
    expect(uraiEnv('\n# komentar\n\n  # menjorok\nA=1\n')).toEqual({ A: '1' });
  });

  it('memisah pada `=` PERTAMA — AUTH_SECRET base64 berakhir `==`', () => {
    // `split('=')` naif memotong nilainya dan membuat rahasia yang sah
    // terlihat rusak. Jebakan yang sama sudah menggigit di uraiCookie.
    expect(uraiEnv('AUTH_SECRET=c2VjcmV0/aGFsbG8==')).toEqual({
      AUTH_SECRET: 'c2VjcmV0/aGFsbG8==',
    });
  });

  it('kutip yang MENGAPIT dibuang, yang di tengah tidak', () => {
    expect(uraiEnv(`A="satu"\nB='dua'\nC=ti"ga"\nD="belum-tutup`)).toEqual({
      A: 'satu',
      B: 'dua',
      C: 'ti"ga"',
      D: '"belum-tutup',
    });
  });

  it('`export ` di depan ditoleransi', () => {
    expect(uraiEnv('export A=1')).toEqual({ A: '1' });
  });

  it('TIDAK mengekspansi $VAR — nilai dipakai harfiah', () => {
    // Ekspansi berarti satu cara baru untuk salah membaca berkas rahasia.
    expect(uraiEnv('A=$HOME/x')).toEqual({ A: '$HOME/x' });
  });

  it('komentar di UJUNG baris dipotong — `.env.example` memakainya hampir di tiap baris', () => {
    // Versi pertama berkas ini hanya melewati `#` di AWAL baris. Akibatnya
    // `API_URL` bernilai "http://localhost:3001      # URL Core API (NestJS)"
    // dan Better-Auth mati saat boot dengan ERR_INVALID_URL. Ditemukan bukan
    // oleh test, melainkan oleh menjalankan `pnpm dev:api` seperti dokumen.
    expect(uraiEnv('API_URL=http://localhost:3001      # URL Core API (NestJS)')).toEqual({
      API_URL: 'http://localhost:3001',
    });
  });

  it('`#` TANPA spasi di depannya bukan komentar — rahasia boleh memuatnya', () => {
    expect(uraiEnv('PASS=rahasia#bukan-komentar')).toEqual({ PASS: 'rahasia#bukan-komentar' });
  });

  it('di dalam kutip, `#` tetap isi', () => {
    expect(uraiEnv('A="satu # dua"')).toEqual({ A: 'satu # dua' });
  });

  it('BERKAS SUNGGUHAN: .env.example terurai jadi nilai yang bisa dipakai', () => {
    // Penjaga yang mengikat parser ke berkas yang memang harus dibacanya.
    // Test buatan sendiri akan selalu cocok dengan parser buatan sendiri;
    // yang membantahnya cuma berkas yang ditulis orang lain.
    const env = uraiEnv(readFileSync(join(AKAR_REPO, '.env.example'), 'utf8'));
    expect(env['API_URL']).toBe('http://localhost:3001');
    expect(env['APP_URL']).toBe('http://localhost:3000');
    expect(env['S3_BUCKET_DOCUMENTS']).toBe('strive-documents');
    for (const [nama, nilai] of Object.entries(env)) {
      expect(nilai, `${nama} masih membawa komentar`).not.toMatch(/\s#/);
    }
  });

  it('baris tanpa `=` diabaikan, bukan melempar', () => {
    expect(uraiEnv('bukan-pasangan\n=tanpa-nama\nA=1')).toEqual({ A: '1' });
  });
});

describe('muatEnv', () => {
  it('mengisi yang belum ada', () => {
    const dir = repoTiruan(`${KUNCI}=dari-berkas\n`);
    expect(muatEnv(dir)).toEqual({ [KUNCI]: 'dari-berkas' });
    expect(process.env[KUNCI]).toBe('dari-berkas');
  });

  it('SHELL MENANG — nilai yang sudah ada tidak ditimpa', () => {
    // Bukan selera: CI menyetel DATABASE_URL eksplisit, dan satu `.env` yang
    // tertinggal di mesin seseorang tidak boleh mengambil alih diam-diam.
    process.env[KUNCI] = 'dari-shell';
    const dir = repoTiruan(`${KUNCI}=dari-berkas\n`);
    expect(muatEnv(dir)).toEqual({});
    expect(process.env[KUNCI]).toBe('dari-shell');
  });

  it('tanpa `.env` → tidak melempar, tidak mengubah apa pun', () => {
    const dir = mkdtempSync(join(tmpdir(), 'strive-env-kosong-'));
    expect(muatEnv(dir)).toEqual({});
  });
});

describe('penjaga: setiap pintu masuk yang MENYURUH menyalin .env harus memuatnya', () => {
  it('tidak ada skrip yang menyebut `.env` di galatnya tanpa memanggil muatEnv', () => {
    // Inilah penjaga untuk bug aslinya. Tanpa baris ini, berkas ini cuma
    // membuktikan sebuah fungsi bekerja — sementara pemanggilnya bebas tidak
    // memakainya, yang PERSIS keadaan sebelum PR ini.
    const folder = [join(AKAR_REPO, 'scripts'), join(AKAR_REPO, 'db', 'seeds')];
    const lalai: string[] = [];

    for (const dir of folder) {
      for (const nama of readdirSync(dir)) {
        if (!nama.endsWith('.mjs') || nama === 'env-berkas.mjs') continue;
        const isi = readFileSync(join(dir, nama), 'utf8');
        const menyuruh = /\.env\.example ke \.env|Salin \.env/.test(isi);
        const membacaDbUrl = /process\.env\.DATABASE_URL|process\.env\['DATABASE_URL'\]/.test(isi);
        // Pembungkus `dev-*` ikut, DAN itu bukan tambahan kosmetik: berkas
        // tempat bug ini dilaporkan (`dev-api.mjs`) tidak menyebut `.env`
        // maupun `DATABASE_URL` — galatnya datang dari proses yang ia
        // jalankan. Versi pertama penjaga ini melewatkannya persis karena itu.
        const pembungkusDev = /^dev-.*\.mjs$/.test(nama);
        if ((menyuruh || membacaDbUrl || pembungkusDev) && !isi.includes('muatEnv')) {
          lalai.push(nama);
        }
      }
    }

    expect(
      lalai,
      `skrip ini menyuruh/membutuhkan .env tapi tidak memuatnya: ${lalai.join(', ')}`,
    ).toEqual([]);
  });
});
