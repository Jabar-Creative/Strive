import { describe, expect, it } from 'vitest';

import { hitungKoin, hitungPoin } from './attempts.service';

/**
 * Formula PRD §6.1, diuji terhadap angkanya sendiri.
 *
 * ```
 * coins  = max(5, round(base_coins  × (0,4 + (score / 100) × 0,6)))
 * points = max(1, round(base_points × (0,5 + score / 200)))
 * ```
 *
 * Berkas terpisah dari test integrasi karena formula tidak butuh database —
 * dan karena CLAUDE.md mewajibkan **setiap formula punya unit test**.
 */

/** Default kolom `lessons` di migrasi 001. */
const BASE_COINS = 20;
const BASE_POINTS = 10;

describe('PRD §6.1 — penskalaan koin & poin', () => {
  it('AC-LE-1: skor 100 memberi base penuh', () => {
    // Acceptance criteria menyebut angkanya harfiah: "coins=20".
    expect(hitungKoin(BASE_COINS, 100)).toBe(20);
    expect(hitungPoin(BASE_POINTS, 100)).toBe(10);
  });

  it('skor 0 tetap berhadiah — 40% base, bukan nol', () => {
    // "Menghukum percobaan yang jujur membuat orang berhenti mencoba."
    expect(hitungKoin(BASE_COINS, 0)).toBe(8);
    expect(hitungPoin(BASE_POINTS, 0)).toBe(5);
  });

  it('monoton naik: skor lebih tinggi tidak pernah berhadiah lebih kecil', () => {
    // Yang dijaga di sini bukan satu angka, tapi BENTUK kurvanya. Formula yang
    // salah tanda atau salah urutan operasi masih bisa lolos beberapa titik
    // uji dan gagal di sini.
    for (let s = 1; s <= 100; s++) {
      expect(hitungKoin(BASE_COINS, s)).toBeGreaterThanOrEqual(hitungKoin(BASE_COINS, s - 1));
      expect(hitungPoin(BASE_POINTS, s)).toBeGreaterThanOrEqual(hitungPoin(BASE_POINTS, s - 1));
    }
  });

  it('lantai 5 koin / 1 poin benar-benar MENGGIGIT untuk base kecil', () => {
    // Dengan base 20, lantai itu tidak pernah tercapai (skor 0 → 8), jadi
    // menghapus `Math.max` dari kode TIDAK akan terlihat di test mana pun
    // yang hanya memakai angka default. Ini yang menangkapnya.
    expect(hitungKoin(4, 0)).toBe(5); // round(1,6) = 2 → dinaikkan ke 5
    expect(hitungKoin(1, 100)).toBe(5); // round(1) = 1 → dinaikkan ke 5
    expect(hitungPoin(0, 100)).toBe(1); // round(0) = 0 → dinaikkan ke 1
  });

  it('selalu integer — koin dan poin tidak pernah pecahan', () => {
    // CLAUDE.md: "Uang dan koin selalu integer, tidak pernah float."
    for (const base of [1, 3, 7, 20, 33, 250]) {
      for (const s of [0, 1, 33, 50, 67, 99, 100]) {
        expect(Number.isInteger(hitungKoin(base, s))).toBe(true);
        expect(Number.isInteger(hitungPoin(base, s))).toBe(true);
      }
    }
  });

  it('skor tengah: 60 dari 100 memberi 76% base koin', () => {
    // 0,4 + 0,6×0,6 = 0,76 → 20 × 0,76 = 15,2 → 15
    expect(hitungKoin(BASE_COINS, 60)).toBe(15);
    // 0,5 + 60/200 = 0,8 → 10 × 0,8 = 8
    expect(hitungPoin(BASE_POINTS, 60)).toBe(8);
  });
});
