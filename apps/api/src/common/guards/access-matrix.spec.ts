import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';

import { ACCESS_MATRIX, ROLES } from './access-matrix';
import { ROLES_KEY, type UserRole } from './roles.decorator';
import { RolesGuard } from './roles.guard';

/**
 * PRD §2.4 menuntut ini secara harfiah:
 *
 * > Setiap baris di bawah wajib punya test yang membuktikan peran lain
 * > **ditolak**.
 *
 * Jadi test ini tidak memeriksa "peran yang benar diterima" saja — itu separuh
 * yang mudah, dan separuh yang tidak pernah menangkap bug keamanan. Yang
 * dijalankan adalah **hasil kali silang penuh**: setiap rute × setiap peran,
 * dengan yang tidak ada di `allow` WAJIB ditolak `FORBIDDEN_ROLE`.
 */

function konteks(role: UserRole | null): ExecutionContext {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({
      getRequest: () => (role ? { headers: {}, user: { id: 'u', role } } : { headers: {} }),
    }),
  } as unknown as ExecutionContext;
}

function guardDengan(allow: readonly UserRole[] | undefined): RolesGuard {
  const reflector = {
    getAllAndOverride: (key: string) => (key === ROLES_KEY ? allow : undefined),
  } as unknown as Reflector;
  return new RolesGuard(reflector);
}

const dijaga = ACCESS_MATRIX.filter((r) => r.allow.length > 0);
const takDijaga = ACCESS_MATRIX.filter((r) => r.allow.length === 0);

describe('ACCESS_MATRIX (PRD §2.4)', () => {
  it('matriksnya lengkap dan tidak ada rute ganda', () => {
    const rute = ACCESS_MATRIX.map((r) => r.route);
    expect(new Set(rute).size, 'ada rute yang ditulis dua kali').toBe(rute.length);
    expect(ACCESS_MATRIX.length).toBeGreaterThanOrEqual(28);
  });

  it('setiap rute tak-berperan punya alasan tertulis', () => {
    // Rute tanpa penjagaan peran harus MENYATAKAN kenapa, bukan diam.
    // `POST /webhooks/payment` yang lupa dijelaskan adalah koin gratis.
    for (const r of takDijaga) {
      expect(r.note, `${r.route} tidak dijaga peran tapi tidak ada alasannya`).toBeTruthy();
    }
  });

  // ── inti: hasil kali silang penuh ───────────────────────────────────────
  describe.each(dijaga.map((r) => [r.route, r.allow] as const))('%s', (route, allow) => {
    it.each(ROLES.map((role) => [role] as const))('peran %s', (role) => {
      const guard = guardDengan(allow);
      const boleh = allow.includes(role);

      if (boleh) {
        expect(guard.canActivate(konteks(role)), `${role} seharusnya BOLEH di ${route}`).toBe(true);
      } else {
        expect(
          () => guard.canActivate(konteks(role)),
          `${role} seharusnya DITOLAK di ${route}`,
        ).toThrow(ForbiddenException);
      }
    });
  });

  // ── jebakan yang paling mudah dilakukan ─────────────────────────────────
  it('superadmin TIDAK otomatis lolos rute student', () => {
    const ruteStudent = dijaga.filter((r) => !r.allow.includes('superadmin'));
    expect(
      ruteStudent.length,
      'matriksnya salah kalau superadmin boleh di mana-mana',
    ).toBeGreaterThan(10);

    for (const r of ruteStudent) {
      expect(
        () => guardDengan(r.allow).canActivate(konteks('superadmin')),
        `superadmin lolos di ${r.route} — panel admin jadi pintu belakang`,
      ).toThrow(ForbiddenException);
    }
  });

  it('student DITOLAK di seluruh rute konsol', () => {
    for (const r of dijaga.filter(
      (x) => x.route.startsWith('GET /admin') || x.route.includes('/mentor/'),
    )) {
      expect(
        () => guardDengan(r.allow).canActivate(konteks('student')),
        `student lolos di ${r.route}`,
      ).toThrow(ForbiddenException);
    }
  });

  it('mentor DITOLAK di /admin/*', () => {
    for (const r of dijaga.filter((x) => x.route.includes('/admin'))) {
      expect(() => guardDengan(r.allow).canActivate(konteks('mentor'))).toThrow(ForbiddenException);
    }
  });

  // ── default TERTUTUP ────────────────────────────────────────────────────
  it('rute TANPA @Roles ditolak untuk semua peran, bukan dibuka', () => {
    // Lupa menulis dekorator harus berakhir 403, bukan kebocoran. Ini satu
    // baris di RolesGuard, dan arah defaultnya menentukan apakah kesalahan
    // manusia jadi gangguan atau jadi lubang.
    for (const role of ROLES) {
      expect(() => guardDengan(undefined).canActivate(konteks(role))).toThrow(ForbiddenException);
      expect(() => guardDengan([]).canActivate(konteks(role))).toThrow(ForbiddenException);
    }
  });

  it('permintaan tanpa sesi ditolak meski rutenya mengizinkan perannya', () => {
    expect(() => guardDengan(['student']).canActivate(konteks(null))).toThrow(ForbiddenException);
  });
});
