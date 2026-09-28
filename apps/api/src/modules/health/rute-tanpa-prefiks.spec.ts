import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { ruteHealthTanpaPrefiks } from './rute-tanpa-prefiks';

/**
 * Penjaga untuk kelas bug yang sudah menggigit repo ini berkali-kali: kode
 * yang benar di modulnya, dan salah di jahitannya dengan `main.ts`.
 *
 * `main.ts` tidak pernah disentuh test mana pun — itu sebabnya `AiDispatchService`
 * bisa berdiri sempurna tanpa pernah dinyalakan (#138), dan sebabnya
 * `/health/ready` mendarat di belakang prefiks yang seharusnya tidak berlaku
 * untuknya. Yang bisa diuji adalah DAFTARNYA, dan daftar itu diturunkan dari
 * metadata controller supaya ia tidak bisa menyimpang diam-diam.
 */
describe('rute health yang dikecualikan dari prefiks global', () => {
  it('memuat SETIAP rute HealthController, bukan hanya akarnya', () => {
    const rute = ruteHealthTanpaPrefiks();
    expect(rute).toContain('health');
    expect(rute).toContain('health/ready');
  });

  it('turunannya dari metadata, jadi rute health BARU ikut tanpa diingat', () => {
    // Kalau seseorang menambah `@Get('live')` di HealthController, daftar ini
    // bertambah sendiri. Yang gagal kalau tidak: orkestrator yang menembak
    // /health/live mendapat 404 dan me-restart proses yang sehat.
    const rute = ruteHealthTanpaPrefiks();
    expect(rute.length).toBeGreaterThanOrEqual(2);
    for (const r of rute) expect(r.startsWith('health')).toBe(true);
  });

  it('main.ts BENAR-BENAR memakai daftar ini, bukan daftar yang diketik ulang', () => {
    // Tanpa baris ini, seluruh berkas cuma membuktikan bahwa sebuah fungsi
    // mengembalikan daftar yang benar — sementara `main.ts` bebas
    // mengabaikannya. Itu persis bentuk kegagalan yang sedang dijaga:
    // benar di modulnya, salah di jahitannya. `main.ts` tidak dijalankan
    // test mana pun, jadi yang bisa diperiksa adalah teksnya.
    const main = readFileSync(join(__dirname, '../../main.ts'), 'utf8');
    const baris = main.split('\n').find((b) => b.includes('setGlobalPrefix'));

    expect(baris, 'setGlobalPrefix tidak ditemukan di main.ts').toBeDefined();
    expect(baris).toContain('ruteHealthTanpaPrefiks()');
    // Daftar harfiah apa pun di situ berarti seseorang mengetiknya ulang.
    expect(baris).not.toMatch(/exclude:\s*\[\s*'/);
  });
});
