import { describe, expect, it } from 'vitest';

import { jamSisaHariLokal, statusStreak } from './streak-status';

/**
 * Test unit untuk turunan status & hitungan sisa jam streak (S-03).
 *
 * AC S-03: "Status 'sisa N jam' benar di zona waktu pengguna, bukan UTC."
 * Status sendiri datang dari SERVER (at_risk_today dihitung Postgres di
 * zona waktu baris streaks — S-02); yang diuji di sini adalah presentasi
 * murninya: berapa jam tersisa sampai tengah malam LOKAL pengguna, di
 * tiga zona waktu berbeda dan lintas tengah malam — pola yang sama dengan
 * test streak S-01 di sisi API.
 */

describe('statusStreak', () => {
  it('streak 0 = broken, "mulai lagi"', () => {
    expect(statusStreak({ currentStreak: 0, atRiskToday: false, freezeUsedToday: false })).toEqual({
      status: 'broken',
      kop: 'Mulai lagi hari ini',
    });
  });

  it('belum aktif hari lokal = at_risk (dengan sisa jam), bukan active', () => {
    expect(
      statusStreak({ currentStreak: 5, atRiskToday: true, freezeUsedToday: false }).status,
    ).toBe('at_risk');
  });

  it('sudah aktif hari lokal = active', () => {
    expect(
      statusStreak({ currentStreak: 5, atRiskToday: false, freezeUsedToday: false }).status,
    ).toBe('active');
  });

  it('streak 0 + belum aktif tetap broken — nol hari tidak "berisiko"', () => {
    expect(
      statusStreak({ currentStreak: 0, atRiskToday: true, freezeUsedToday: false }).status,
    ).toBe('broken');
  });

  it('freeze menyelamatkan hari ini = frozen, MENANG atas at_risk (#193)', () => {
    // Keduanya true pada hari yang dibekukan; harinya sudah aman, jadi
    // status bukan at_risk dan kopnya tidak mengancam.
    const hasil = statusStreak({ currentStreak: 5, atRiskToday: true, freezeUsedToday: true });
    expect(hasil.status).toBe('frozen');
    expect(hasil.kop).toBe('Streak 5 hari dibekukan');
  });

  it('freeze hari ini + sudah aktif = tetap frozen (hari ini memang dibekukan)', () => {
    // Sudah aktif lalu memakai freeze di hari yang sama: freeze tidak
    // terpakai di kasus ini (SK-6 hanya sebelum tengah malam dan kalau
    // belum aktik), tapi kalau server melaporkannya, frozen tetap yang
    // paling jujur untuk hari berjalan.
    expect(
      statusStreak({ currentStreak: 5, atRiskToday: false, freezeUsedToday: true }).status,
    ).toBe('frozen');
  });
});

describe('jamSisaHariLokal', () => {
  it('sisa jam sampai tengah malam zona waktu PENGGUNA, bukan UTC proses', () => {
    // 2026-10-01 12:00 UTC. Di Jayapura (WIT, UTC+9) pukul 21:00 —
    // tersisa 3 jam. Di UTC sendiri tersisa 12 jam. Di Los Angeles
    // (UTC-7, DST) pukul 05:00 — tersisa 19 jam.
    const kini = Date.UTC(2026, 9, 1, 12, 0, 0);
    expect(jamSisaHariLokal(kini, 'Asia/Jayapura')).toBeCloseTo(3, 6);
    expect(jamSisaHariLokal(kini, 'UTC')).toBeCloseTo(12, 6);
    expect(jamSisaHariLokal(kini, 'America/Los_Angeles')).toBeCloseTo(19, 6);
  });

  it('menit terakhir hari lokal: sisa hampir nol, tidak negatif', () => {
    const kini = Date.UTC(2026, 9, 1, 16, 59, 30); // 23:59:30 WIB
    const sisa = jamSisaHariLokal(kini, 'Asia/Jakarta');
    expect(sisa).toBeGreaterThanOrEqual(0);
    expect(sisa).toBeLessThanOrEqual(30.5 / 3600 + 1e-6); // ≤ ~30,5 detik
  });

  it('tepat tengah malam lokal: satu hari penuh tersisa (24 jam)', () => {
    const kini = Date.UTC(2026, 9, 1, 17, 0, 0); // 00:00 WIB hari baru
    expect(jamSisaHariLokal(kini, 'Asia/Jakarta')).toBeCloseTo(24, 6);
  });

  it('pukul 20:00 lokal (SK-8, jam peringatan): tersisa 4 jam', () => {
    const kini = Date.UTC(2026, 9, 1, 13, 0, 0); // 20:00 WIB
    expect(jamSisaHariLokal(kini, 'Asia/Jakarta')).toBeCloseTo(4, 6);
  });
});

describe('jamSisaHariLokal — zona tak valid (audit susulan)', () => {
  it('mengembalikan -1, bukan melempar RangeError yang menjatuhkan halaman', () => {
    expect(jamSisaHariLokal(Date.UTC(2026, 9, 1), 'Zona/Tidak-Ada')).toBe(-1);
  });
});
