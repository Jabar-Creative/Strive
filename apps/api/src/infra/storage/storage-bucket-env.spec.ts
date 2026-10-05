import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Setiap `S3_BUCKET_*` di `.env.example` WAJIB dibaca kode — isu #159.
 *
 * `S3_BUCKET_ASSETS` tercantum di `.env.example` dan PRD §12.6 sejak awal, dan
 * nol kode membacanya. Akibatnya bukan sepele: ia terbaca seperti konfigurasi
 * yang bekerja, jadi orang yang menyetelnya di dashboard akan percaya aset
 * store pindah bucket — dan tidak ada apa pun yang memberitahunya bahwa
 * nilainya diabaikan.
 *
 * Kelas yang sama sudah menggigit empat kali sekaligus saat deploy `F-05`
 * (`LOG_LEVEL`, `S3_BUCKET_ASSETS`, dan empat kill switch `FEATURE_*`), jadi
 * yang dibutuhkan bukan kehati-hatian melainkan penjaga.
 *
 * Disengaja `*.spec.ts` biasa, bukan `*.integration.spec.ts`: ia hanya membaca
 * berkas, jadi ia harus jalan di job CI yang TIDAK punya database — pola yang
 * sama dengan `penjaga-spec-integrasi.spec.ts`.
 */

const AKAR = join(__dirname, '..', '..', '..', '..', '..');

function sumberTs(dir: string, hasil: string[] = []): string[] {
  for (const nama of readdirSync(dir)) {
    const jalur = join(dir, nama);
    if (statSync(jalur).isDirectory()) {
      sumberTs(jalur, hasil);
    } else if (nama.endsWith('.ts') && !nama.endsWith('.spec.ts') && !nama.endsWith('.d.ts')) {
      hasil.push(jalur);
    }
  }
  return hasil;
}

describe('S3_BUCKET_* di .env.example (isu #159)', () => {
  const contoh = readFileSync(join(AKAR, '.env.example'), 'utf8');
  const nama = [...contoh.matchAll(/^(S3_BUCKET_[A-Z_]+)=/gm)].map((m) => m[1]!);

  it('.env.example memang mencantumkan bucket — kalau nol, penjaga ini hampa', () => {
    expect(nama.length).toBeGreaterThan(0);
  });

  it('setiap nama bucket dibaca oleh kode apps/api', () => {
    const kode = sumberTs(join(AKAR, 'apps', 'api', 'src'))
      .map((f) => readFileSync(f, 'utf8'))
      .join('\n');

    const tidakDibaca = nama.filter((n) => !kode.includes(n));
    expect(
      tidakDibaca,
      `variabel ini JANJI di .env.example tapi nol kode membacanya: ${tidakDibaca.join(', ')}`,
    ).toEqual([]);
  });
});
