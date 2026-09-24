import { describe, expect, it } from 'vitest';

import { HALAMAN_TERLARANG, putusAksesConsole } from './console-guard';

/**
 * Test unit untuk keputusan akses area konsol (A-04).
 *
 * Yang diuji di sini adalah SELURUH logika keputusan: middleware hanya
 * memasok dua fakta (status HTTP GET /me dan peran dari body-nya), semua
 * percabangan hidup di sini. Itu sebabnya AC A-04 bisa dibuktikan tanpa
 * browser: kasus "student mendapat 403" adalah baris `student → terlarang`
 * di bawah, dan sisanya menjaga agar pintu tidak bocor ke arah lain.
 */
describe('putusAksesConsole', () => {
  it('mentor dan superadmin boleh masuk', () => {
    expect(putusAksesConsole(200, 'mentor')).toBe('lewat');
    expect(putusAksesConsole(200, 'superadmin')).toBe('lewat');
  });

  it('student DILARANG meski sesinya sah (200)', () => {
    expect(putusAksesConsole(200, 'student')).toBe('terlarang');
  });

  it('peran tak dikenal atau hilang ditolak, bukan diasumsikan baik', () => {
    expect(putusAksesConsole(200, undefined)).toBe('terlarang');
    expect(putusAksesConsole(200, 'admin')).toBe('terlarang');
    expect(putusAksesConsole(200, '')).toBe('terlarang');
  });

  it('sesi tidak sah (401/403) dikirim ke login, bukan halaman 403', () => {
    expect(putusAksesConsole(401, undefined)).toBe('login');
    expect(putusAksesConsole(403, undefined)).toBe('login');
  });

  it('sumber peran tak terbaca (timeout/5xx) menutup pintu: gagal-tertutup', () => {
    // Bukan 'login': pengguna MEMANG punya sesi, melemparnya ke /login
    // menuduhnya belum masuk. Bukan 'lewat' juga: konsol terbuka tanpa
    // bukti peran adalah kebocoran. Terlarang adalah pilihan yang jujur.
    expect(putusAksesConsole(0, undefined)).toBe('terlarang');
    expect(putusAksesConsole(500, undefined)).toBe('terlarang');
    expect(putusAksesConsole(502, undefined)).toBe('terlarang');
  });
});

describe('HALAMAN_TERLARANG', () => {
  it('berbahasa Indonesia, menjelaskan siapa yang boleh, dan jalan pulang', () => {
    expect(HALAMAN_TERLARANG).toContain('lang="id"');
    expect(HALAMAN_TERLARANG).toContain('mentor');
    expect(HALAMAN_TERLARANG).toContain('superadmin');
    expect(HALAMAN_TERLARANG).toContain('href="/hub"');
  });

  it('tidak memuat input pengguna apa pun — HTML statis murni', () => {
    // Satu-satunya cara aman memaketkan halaman di dalam middleware:
    // tanpa interpolasi, tanpa refleksi path/cookie ke dalam markup.
    expect(typeof HALAMAN_TERLARANG).toBe('string');
  });
});
