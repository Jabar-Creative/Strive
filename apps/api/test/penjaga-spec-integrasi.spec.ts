import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Penjaga atas PENJAGA — setiap spec integrasi wajib memerahkan ketiadaan
 * database.
 *
 * Seluruh berkas `*.integration.spec.ts` memakai pola yang sama: `reachable`
 * disetel di `beforeAll`, dan tiap test membuka dengan `if (!reachable)
 * return`. Pola itu benar, dan ia **hanya aman kalau ada satu test yang
 * meng-assert `reachable`**. Tanpa itu, berkasnya melaporkan semua hijau
 * terhadap database mati — nol cakupan, nol tanda.
 *
 * Bukan hipotesis. `grading.integration.spec.ts` melakukannya persis:
 * empat test "lulus" dalam lima milidetik terhadap `postgres://…:1/tidak_ada`,
 * dan yang diujinya aturan keras 9 (penilaian selalu di server).
 *
 * Ini kejadian KEDUA dari kelas yang sama. Yang pertama
 * `pricing-config.service.spec.ts` (isu #128), yang tidak pernah dijalankan
 * CI di job mana pun. Dua kali berarti bukan kelalaian satu orang — berarti
 * polanya butuh penjaga.
 *
 * ── Kenapa di suite UNIT ──
 *
 * Namanya sengaja `*.spec.ts`, bukan `*.integration.spec.ts`: ia tidak butuh
 * database, dan justru harus jalan di job CI yang TIDAK punya database. Kalau
 * ia ikut suite integrasi, ia akan jadi contoh dari masalah yang dijaganya.
 */

const DIR = join(__dirname);

/** Nama test penjaga tidak diseragamkan; yang diperiksa PERILAKUNYA. */
function mengassertReachable(isi: string): boolean {
  // `expect(reachable...` boleh ditulis satu baris atau dipecah prettier jadi
  // beberapa baris, jadi yang dicocokkan bentuk yang sudah dinormalkan.
  return /expect\(\s*reachable\b/.test(isi);
}

describe('Setiap spec integrasi memerahkan ketiadaan database', () => {
  const berkas = readdirSync(DIR).filter((f) => f.endsWith('.integration.spec.ts'));

  it('ada spec integrasi yang terbaca — kalau nol, test ini tidak menjaga apa pun', () => {
    expect(berkas.length).toBeGreaterThan(20);
  });

  it('yang memakai `if (!reachable) return` WAJIB meng-assert `reachable`', () => {
    const lalai: string[] = [];
    for (const nama of berkas) {
      const isi = readFileSync(join(DIR, nama), 'utf8');
      if (!isi.includes('if (!reachable) return')) continue;
      if (!mengassertReachable(isi)) lalai.push(nama);
    }

    expect(
      lalai,
      'Spec ini melewati SEMUA test-nya tanpa suara kalau database tidak ada. ' +
        'Tambahkan satu test yang meng-assert `reachable` — lihat pola di berkas lain.',
    ).toEqual([]);
  });
});
