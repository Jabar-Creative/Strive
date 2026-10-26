import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  KUNCI_RUBRIK,
  RUBRIC_KRITERIA,
  RUBRIC_MAKS,
  RUBRIC_TOTAL_MAKS,
  hapusDraf,
  mulaiDraf,
  muatDraf,
  pesanGalatReview,
  pesanHasil,
  rubrikLengkap,
  simpanDraf,
  totalRubrik,
  type DrafReview,
} from './review-queue';

/**
 * Mesin antrean review + rubrik — PR-03 (pola C-03: perilaku tanpa browser).
 *
 * Dua hal yang dijaga di sini:
 * 1. Kriteria rubrik TIDAK BOLEH menyimpang dari PRD PR-10 — penjaga yang
 *    sama dengan `error-codes.spec.ts` di API: sumber kebenaran dibaca dari
 *    `docs/PRD.md`, bukan dari ingatan orang yang menulis konstanta.
 * 2. Draf penilaian bertahan melewati tutup halaman (AC PR-03), dan kunci
 *    idempoten milik PERCOBAAN: retry memakai kunci yang sama.
 */

/** Penyimpanan tiruan — Map dalam memori, bentuk sama dengan localStorage. */
function buatTiruan() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

/** Penyimpanan yang selalu melempar — private mode / quota penuh. */
function buatRusak() {
  return {
    getItem: () => {
      throw new Error('quota');
    },
    setItem: () => {
      throw new Error('quota');
    },
    removeItem: () => {
      throw new Error('quota');
    },
  };
}

const SKOR_PENUH: Record<(typeof RUBRIC_KRITERIA)[number], number> = {
  kejelasan: 4,
  ketepatan: 5,
  kelengkapan: 3,
  sitasi: 2,
};

describe('kriteria rubrik = PRD PR-10 (drift guard)', () => {
  const prd = readFileSync(join(__dirname, '..', '..', '..', 'docs', 'PRD.md'), 'utf8');
  const baris = prd.split('\n').find((l) => l.includes('PR-10') && l.includes('Rubrik TETAP'));

  it('baris PR-10 ada di PRD (penjaga tidak menguji apa-apa kalau barisnya hilang)', () => {
    expect(baris).toBeDefined();
  });

  it('keempat nama kriteria persis PRD, urutan sama', () => {
    expect(baris).toBeDefined();
    const segmen = baris!.slice(
      baris!.indexOf('Rubrik TETAP'),
      baris!.indexOf('Nilai bilangan bulat'),
    );
    const nama = [...segmen.matchAll(/`([a-z]+)`/g)].map((m) => m[1]);
    expect(nama).toEqual([...RUBRIC_KRITERIA]);
  });

  it('rentang nilai dan total maksimum persis PRD (0..5, maksimum 20)', () => {
    expect(RUBRIC_MAKS).toBe(5);
    expect(RUBRIC_TOTAL_MAKS).toBe(RUBRIC_KRITERIA.length * RUBRIC_MAKS);
    expect(RUBRIC_TOTAL_MAKS).toBe(20);
    expect(baris!).toContain('**0..5**');
    expect(baris!).toContain('**20**');
  });

  it('keempat kriteria punya label tampilan (tidak ada yang mengarang nama lain)', () => {
    for (const k of RUBRIC_KRITERIA) {
      expect(KUNCI_RUBRIK[k].label.length).toBeGreaterThan(0);
      expect(KUNCI_RUBRIK[k].bantu.length).toBeGreaterThan(0);
    }
  });
});

describe('mulaiDraf — kunci idempoten milik percobaan', () => {
  it('draf baru: skor kosong, komentar kosong, kunci berbentuk uuid', () => {
    const d = mulaiDraf();
    expect(Object.keys(d.skor).length).toBe(0);
    expect(d.komentar).toBe('');
    expect(d.kunci).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('dua draf baru tidak berbagi kunci', () => {
    expect(mulaiDraf().kunci).not.toBe(mulaiDraf().kunci);
  });
});

describe('draf bertahan melewati tutup halaman (AC PR-03)', () => {
  it('simpan lalu muat ulang: draf sama persis, kunci TIDAK lahir ulang', () => {
    const s = buatTiruan();
    const d: DrafReview = {
      skor: { kejelasan: 3 },
      komentar: 'cukup jelas',
      kunci: mulaiDraf().kunci,
    };
    simpanDraf(s, 'user-1', 'attempt-a', d);
    const balik = muatDraf(s, 'user-1', 'attempt-a');
    expect(balik).toEqual(d);
  });

  it('draf per attempt terpisah — mengisi B tidak menghapus A', () => {
    const s = buatTiruan();
    const a: DrafReview = { skor: { sitasi: 5 }, komentar: '', kunci: mulaiDraf().kunci };
    const b: DrafReview = { skor: { kejelasan: 1 }, komentar: 'b', kunci: mulaiDraf().kunci };
    simpanDraf(s, 'user-1', 'attempt-a', a);
    simpanDraf(s, 'user-1', 'attempt-b', b);
    expect(muatDraf(s, 'user-1', 'attempt-a')).toEqual(a);
    expect(muatDraf(s, 'user-1', 'attempt-b')).toEqual(b);
  });

  it('draf separuh terisi SAH sebagai draf (belum lengkap ≠ rusak)', () => {
    const s = buatTiruan();
    const d: DrafReview = {
      skor: { kejelasan: 3, ketepatan: 0 },
      komentar: '',
      kunci: mulaiDraf().kunci,
    };
    simpanDraf(s, 'user-1', 'attempt-a', d);
    expect(muatDraf(s, 'user-1', 'attempt-a')).toEqual(d);
  });

  it('hapusDraf setelah sukses: muat ulang memberi null', () => {
    const s = buatTiruan();
    simpanDraf(s, 'user-1', 'attempt-a', mulaiDraf());
    hapusDraf(s, 'user-1', 'attempt-a');
    expect(muatDraf(s, 'user-1', 'attempt-a')).toBeNull();
  });
});

describe('draf terisolasi per pengguna (temuan audit PR-03)', () => {
  it('akun lain di profil browser yang sama TIDAK melihat draf — muatDraf null', () => {
    const s = buatTiruan();
    const d: DrafReview = {
      skor: { kejelasan: 4 },
      komentar: 'rahasia penilai',
      kunci: mulaiDraf().kunci,
    };
    simpanDraf(s, 'user-1', 'attempt-a', d);
    expect(muatDraf(s, 'user-2', 'attempt-a')).toBeNull();
    // draf pemilik aslinya tidak tersentuh oleh pembacaan akun lain
    expect(muatDraf(s, 'user-1', 'attempt-a')).toEqual(d);
  });

  it('kunci draf memuat userId SETELAH versi — bukan hanya attempt', () => {
    const m = new Map<string, string>(); // Map terlihat, bukan buatTiruan yang menutupnya
    const s = {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
    };
    simpanDraf(s, 'user-9', 'attempt-z', mulaiDraf());
    expect([...m.keys()]).toEqual(['strive:draf-review:v1:user-9:attempt-z']);
  });

  it('hapusDraf akun lain tidak menghapus draf pemiliknya', () => {
    const s = buatTiruan();
    const d: DrafReview = { skor: { sitasi: 2 }, komentar: 'x', kunci: mulaiDraf().kunci };
    simpanDraf(s, 'user-1', 'attempt-a', d);
    hapusDraf(s, 'user-2', 'attempt-a');
    expect(muatDraf(s, 'user-1', 'attempt-a')).toEqual(d);
  });
});

describe('draf rusak dibuang diam-diam, bukan meledakkan layar', () => {
  it('JSON tidak bisa di-parse → null dan entrinya dibuang', () => {
    const m = new Map<string, string>();
    const s = {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
    };
    m.set('strive:draf-review:v1:user-1:attempt-a', '{tidak-valid');
    expect(muatDraf(s, 'user-1', 'attempt-a')).toBeNull();
    expect(m.has('strive:draf-review:v1:user-1:attempt-a')).toBe(false);
  });

  it('draf dengan kriteria asing → null (server akan menolaknya; draf tidak boleh menipu)', () => {
    const s = buatTiruan();
    simpanDraf(s, 'user-1', 'attempt-a', {
      skor: { kejelasan: 3 },
      komentar: '',
      kunci: mulaiDraf().kunci,
    });
    s.setItem(
      'strive:draf-review:v1:user-1:attempt-a',
      JSON.stringify({ skor: { hack: 1 }, komentar: '', kunci: 'x' }),
    );
    expect(muatDraf(s, 'user-1', 'attempt-a')).toBeNull();
  });

  it('draf dengan nilai pecahan / negatif / di atas 5 / string → null', () => {
    const s = buatTiruan();
    for (const salah of [3.5, -1, 6, '3', null]) {
      s.setItem(
        'strive:draf-review:v1:user-1:attempt-a',
        JSON.stringify({ skor: { kejelasan: salah }, komentar: '', kunci: 'k' }),
      );
      expect(muatDraf(s, 'user-1', 'attempt-a')).toBeNull();
    }
  });

  it('draf tanpa kunci idempoten → null (kunci wajib, bukan pelengkap)', () => {
    const s = buatTiruan();
    s.setItem(
      'strive:draf-review:v1:user-1:attempt-a',
      JSON.stringify({ skor: { kejelasan: 3 }, komentar: '' }),
    );
    expect(muatDraf(s, 'user-1', 'attempt-a')).toBeNull();
  });

  it('penyimpanan yang melempar (quota/private mode) tidak menjatuhkan layar', () => {
    const s = buatRusak();
    expect(() => simpanDraf(s, 'u', 'a', mulaiDraf())).not.toThrow();
    expect(muatDraf(s, 'u', 'a')).toBeNull();
    expect(() => hapusDraf(s, 'u', 'a')).not.toThrow();
  });

  it('muatDraf dari penyimpanan kosong → null', () => {
    expect(muatDraf(buatTiruan(), 'u', 'tak-ada')).toBeNull();
  });
});

describe('rubrikLengkap — gerbang kirim di sisi tampilan', () => {
  it('kosong → false', () => {
    expect(rubrikLengkap({})).toBe(false);
  });

  it('kurang satu kriteria → false', () => {
    const { sitasi: _buang, ...tiga } = SKOR_PENUH;
    expect(rubrikLengkap(tiga)).toBe(false);
  });

  it('keempat ada, bulat 0..5 → true (termasuk semua nol)', () => {
    expect(rubrikLengkap(SKOR_PENUH)).toBe(true);
    expect(rubrikLengkap({ kejelasan: 0, ketepatan: 0, kelengkapan: 0, sitasi: 0 })).toBe(true);
  });

  it('nilai pecahan atau kriteria asing → false', () => {
    expect(rubrikLengkap({ ...SKOR_PENUH, kejelasan: 2.5 })).toBe(false);
    expect(rubrikLengkap({ ...SKOR_PENUH, hack: 1 })).toBe(false);
  });
});

describe('totalRubrik — jumlah untuk ditampilkan sebelum kirim', () => {
  it('menjumlahkan keempat kriteria yang dikenal', () => {
    expect(totalRubrik(SKOR_PENUH)).toBe(14);
  });

  it('kunci asing diabaikan, tidak dihitung', () => {
    expect(totalRubrik({ ...SKOR_PENUH, hack: 99 } as Record<string, number>)).toBe(14);
  });

  it('draf kosong → 0', () => {
    expect(totalRubrik({})).toBe(0);
  });
});

describe('pesanHasil / pesanGalatReview', () => {
  it('berpoin: menyebut angka poin', () => {
    expect(pesanHasil({ id: 'r1', weighted_points: 14, scored_today: 3, capped: false })).toContain(
      '14',
    );
  });

  it('capped (AC-PR-3): tersimpan TANPA poin, bukan gagal', () => {
    const p = pesanHasil({ id: 'r2', weighted_points: 0, scored_today: 5, capped: true });
    expect(p).toContain('tanpa poin');
  });

  it('galat yang dikenal dapat pesan spesifik, yang asing dapat pesan umum', () => {
    for (const kode of [
      'SELF_REVIEW_FORBIDDEN',
      'ALREADY_PURCHASED',
      'KEY_CONFLICT',
      'VALIDATION_ERROR',
    ]) {
      expect(pesanGalatReview(kode).length).toBeGreaterThan(0);
    }
    expect(pesanGalatReview('KODE_ASLING')).not.toBe(pesanGalatReview('VALIDATION_ERROR'));
  });
});
