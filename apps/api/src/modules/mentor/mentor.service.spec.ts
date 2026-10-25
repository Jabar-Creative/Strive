import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { CATATAN_MAKS, KOIN_VALIDASI_REVIEW, validasiKeputusan } from './mentor.service';

/**
 * `PR-04` (Dev B) — konsol mentor, sisi murni tanpa database.
 *
 * Yang dijaga di sini bukan alur penuh (itu `test/mentor-validate.integration.spec.ts`
 * dengan PostgreSQL sungguhan), tapi DUA angka yang datang dari dokumen dan SATU
 * fungsi gerbang yang dipakai semua jalur:
 *
 *   1. `KOIN_VALIDASI_REVIEW` — PRD §6 menuliskannya sebagai angka ekonomi
 *      TERKUNCI. Salah angka di sini = salah harga produk, bukan salah varibel.
 *   2. `CATATAN_MAKS` — batas panjang catatan mentor. PRD TIDAK menuliskan
 *      angkanya; 500 dipilih mengikuti batas `comment` review di `PR-03`
 *      supaya dua teks yang tampil berdampingan di konsol punya aturan yang sama.
 *   3. `validasiKeputusan` — dipanggil controller DAN service, supaya jalur
 *      non-HTTP (skrip perbaikan data, worker) tidak bisa melewatinya. Pola yang
 *      sama dengan `totalRubrik()` di review.service.
 */

const AKAR_REPO = join(__dirname, '../../../../..');

describe('KOIN_VALIDASI_REVIEW — dijaga drift-guard PRD §6 (isu #73 kelas)', () => {
  it('PRD masih menuliskan barisnya, dan angkanya 15', () => {
    const prd = readFileSync(join(AKAR_REPO, 'docs/PRD.md'), 'utf8');
    const baris = prd.split('\n').find((l) => l.includes('Peer review disetujui mentor'));

    // Barisnya harus ADA: kalau seseorang menghapus/mengganti nama item di §6,
    // penjaga ini merah supaya konstanta ikut ditinjau, bukan ditebak.
    expect(baris).toBeDefined();
    // Bentuk baris §6: "| Peer review disetujui mentor | 15 | Rp 375 | ... |"
    expect(baris!).toMatch(/\|\s*15\s*\|/);
    // Konstanta kode = angka PRD. Inilah tautannya; tanpa test ini dua
    // tempat itu bisa diam-diam berbeda.
    expect(KOIN_VALIDASI_REVIEW).toBe(15);
  });
});

describe('validasiKeputusan — gerbang bentuk body POST /mentor/reviews/:id/validate', () => {
  it('approve dan reject diterima apa adanya', () => {
    expect(validasiKeputusan('approve', undefined)).toEqual({ decision: 'approve' });
    expect(validasiKeputusan('reject', 'kurang sitasi')).toEqual({
      decision: 'reject',
      note: 'kurang sitasi',
    });
  });

  it('keputusan selain approve/reject ditolak — bukan default diam-diam', () => {
    for (const salah of ['setuju', 'APPROVE', '', null, 1, undefined]) {
      expect(() => validasiKeputusan(salah, undefined), String(salah)).toThrow(BadRequestException);
    }
  });

  it('galat keputusan memakai kode VALIDATION_ERROR (kontrak §10.2, bukan pesan)', () => {
    let badan: unknown;
    try {
      validasiKeputusan('hapus', undefined);
    } catch (e) {
      badan = (e as BadRequestException).getResponse();
    }
    expect(JSON.stringify(badan)).toContain('VALIDATION_ERROR');
  });

  it('catatan wajib saat MENOLAK — penolakan tanpa alasan tidak bisa dipelajari reviewer', () => {
    for (const kosong of [undefined, null, '', '   ']) {
      expect(() => validasiKeputusan('reject', kosong), JSON.stringify(kosong)).toThrow(
        BadRequestException,
      );
    }
  });

  it('catatan opsional saat menyetujui', () => {
    expect(validasiKeputusan('approve', 'rubrik rapi')).toEqual({
      decision: 'approve',
      note: 'rubrik rapi',
    });
    expect(validasiKeputusan('approve', '   ')).toEqual({ decision: 'approve' });
  });

  it('catatan bukan string ditolak', () => {
    for (const salah of [15, { teks: 'x' }, ['x']]) {
      expect(() => validasiKeputusan('approve', salah), JSON.stringify(salah)).toThrow(
        BadRequestException,
      );
    }
  });

  it(`catatan lebih dari ${CATATAN_MAKS} karakter ditolak — batas yang sama dengan comment PR-03`, () => {
    expect(CATATAN_MAKS).toBe(500);
    const tepat = 'x'.repeat(CATATAN_MAKS);
    expect(validasiKeputusan('reject', tepat)).toEqual({ decision: 'reject', note: tepat });
    expect(() => validasiKeputusan('reject', 'x'.repeat(CATATAN_MAKS + 1))).toThrow(
      BadRequestException,
    );
  });
});
