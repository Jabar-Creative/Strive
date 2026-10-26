import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import {
  MAKS_KOMENTAR,
  RUBRIC_KRITERIA,
  RUBRIC_MAX_SCORE,
  RUBRIC_TOTAL_MAX,
  pastikanKomentarWajar,
  totalRubrik,
} from './review.service';

/**
 * Rubrik peer review — PRD §7 E11 `PR-10`, isu #73.
 *
 * Yang dijaga di sini bukan aritmetikanya. `rubric_scores` datang DARI KLIEN
 * dan `PR-5` mengalikannya jadi poin liga, jadi setiap batas di bawah adalah
 * jalan masuk yang pernah atau bisa dipakai mencetak poin:
 *
 *   {"apa_saja": 999999}          -> 999.999 poin  (lubang versi pertama)
 *   {"kejelasan": 5.9}            -> pecahan
 *   {"kejelasan": 5, "x": 5}      -> nama karangan menambah plafon
 *   {"kejelasan": 5}              -> rubrik separuh, total terlihat sah
 *
 * Yang terakhir itu yang paling mudah terlewat: ia tidak melanggar satu pun
 * batas NILAI, dan tetap menghasilkan angka yang dibandingkan di papan yang
 * sama dengan reviewer yang mengirim empat.
 */

const penuh = () => Object.fromEntries(RUBRIC_KRITERIA.map((k) => [k, RUBRIC_MAX_SCORE]));

describe('totalRubrik — batas (isu #73)', () => {
  it('rubrik lengkap bernilai maksimum = RUBRIC_TOTAL_MAX', () => {
    expect(totalRubrik(penuh())).toBe(RUBRIC_TOTAL_MAX);
    // Angkanya ikut dikunci: plafon poin satu review = 20 × bobot 1,50 = 30,
    // dan itu harus bisa dihitung tangan saat memeriksa papan.
    expect(RUBRIC_TOTAL_MAX).toBe(20);
  });

  it('nol di seluruh kriteria sah — "tidak terpenuhi" bukan "tidak diisi"', () => {
    const nol = Object.fromEntries(RUBRIC_KRITERIA.map((k) => [k, 0]));
    expect(totalRubrik(nol)).toBe(0);
  });

  it('nama kriteria KARANGAN ditolak — ini lubang poin versi pertama', () => {
    expect(() => totalRubrik({ ...penuh(), apa_saja: 999999 })).toThrow(BadRequestException);
    expect(() => totalRubrik({ apa_saja: 1 })).toThrow(BadRequestException);
  });

  it('rubrik SEPARUH ditolak — totalnya terlihat sah dan tetap tidak sebanding', () => {
    expect(() => totalRubrik({ kejelasan: 5 })).toThrow(BadRequestException);
    const { sitasi: _buang, ...tigaSaja } = penuh();
    expect(() => totalRubrik(tigaSaja)).toThrow(BadRequestException);
  });

  it('galatnya menyebut kriteria yang DIHARAPKAN — klien tidak perlu menebak', () => {
    let badan: unknown;
    try {
      totalRubrik({ kejelasan: 5 });
    } catch (e) {
      badan = (e as BadRequestException).getResponse();
    }
    const teks = JSON.stringify(badan);
    expect(teks).toContain('VALIDATION_ERROR');
    for (const k of RUBRIC_KRITERIA) expect(teks).toContain(k);
  });

  it('nilai di luar 0..5, pecahan, NaN, dan Infinity ditolak', () => {
    for (const v of [-1, RUBRIC_MAX_SCORE + 1, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => totalRubrik({ ...penuh(), kejelasan: v }), String(v)).toThrow(
        BadRequestException,
      );
    }
  });

  it('rubrik kosong ditolak', () => {
    expect(() => totalRubrik({})).toThrow(BadRequestException);
  });

  it('`sitasi` ada di daftar — ia yang membedakan rubrik ini dari rubrik generik', () => {
    // Bukan test aritmetika: kalau seseorang menyederhanakan daftarnya nanti,
    // yang hilang pertama biasanya kriteria yang paling spesifik ke produk.
    expect([...RUBRIC_KRITERIA]).toContain('sitasi');
    expect(RUBRIC_KRITERIA).toHaveLength(4);
  });
});

/**
 * Panjang `comment` — isu #257 (@kemalzaki, audit PR-03).
 *
 * `maxLength={500}` di DOM bukan batas: ia tidak ada di jalur mana pun selain
 * browser yang menurutinya. Yang diuji di sini penjaga SERVICE-nya, karena
 * itu satu-satunya tempat yang juga berlaku untuk worker dan skrip
 * perbaikan data.
 */
describe('pastikanKomentarWajar — batas panjang comment (isu #257)', () => {
  it('tanpa comment (undefined) lolos — komentar memang opsional', () => {
    expect(() => pastikanKomentarWajar(undefined)).not.toThrow();
  });

  it('komentar kosong lolos — kosong bukan terlalu panjang', () => {
    expect(() => pastikanKomentarWajar('')).not.toThrow();
  });

  it('TEPAT di batas lolos, satu karakter di atasnya ditolak', () => {
    // Batas diuji dari kedua sisinya. Test yang hanya mengirim 1 MB akan
    // tetap hijau untuk implementasi yang salah menulis `>=`, dan off-by-one
    // di batas yang dikirim klien berarti UI 500 karakter menolak sendiri.
    expect(() => pastikanKomentarWajar('a'.repeat(MAKS_KOMENTAR))).not.toThrow();
    expect(() => pastikanKomentarWajar('a'.repeat(MAKS_KOMENTAR + 1))).toThrow(BadRequestException);
  });

  it('1 MB ditolak dengan VALIDATION_ERROR, bukan kode baru', () => {
    // §10.2 daftar TERTUTUP (#92). #257 mengusulkan `COMMENT_TOO_LONG`;
    // keadaan ini persis arti `VALIDATION_ERROR`, dan menambah kode untuk
    // keadaan yang sudah punya kodenya membuat daftar tertutup berhenti
    // berarti.
    try {
      pastikanKomentarWajar('x'.repeat(1024 * 1024));
      throw new Error('seharusnya melempar');
    } catch (e) {
      const isi = (e as BadRequestException).getResponse() as {
        error: { code: string; details: { field: string; length: number; max: number } };
      };
      expect(isi.error.code).toBe('VALIDATION_ERROR');
      expect(isi.error.details.field).toBe('comment');
      expect(isi.error.details.max).toBe(MAKS_KOMENTAR);
      // Panjang SEBENARNYA ikut dilaporkan: klien yang memotong sendiri perlu
      // tahu seberapa jauh ia melewati, bukan cuma bahwa ia melewati.
      expect(isi.error.details.length).toBe(1024 * 1024);
    }
  });
});
