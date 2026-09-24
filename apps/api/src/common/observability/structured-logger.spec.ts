import { afterEach, describe, expect, it } from 'vitest';

import { barisLog, formatJson, saring } from './structured-logger';

const asli = process.env['LOG_FORMAT'];
afterEach(() => {
  if (asli === undefined) delete process.env['LOG_FORMAT'];
  else process.env['LOG_FORMAT'] = asli;
});

describe('R-04 — log terstruktur (PRD §17.1)', () => {
  it('membuang bidang rahasia, apa pun kapitalisasinya', () => {
    const keluar = saring({
      user_id: 'u1',
      Password: 'rahasia',
      TOKEN: 'abc',
      Authorization: 'Bearer xyz',
      signature_key: 'ff00',
    }) as Record<string, unknown>;

    expect(keluar['user_id']).toBe('u1');
    for (const k of ['Password', 'TOKEN', 'Authorization', 'signature_key']) {
      expect(keluar[k], k).toBe('[dibuang]');
    }
  });

  it('membuang yang BERSARANG, bukan hanya di permukaan', () => {
    // Bidang rahasia hampir tidak pernah ada di tingkat atas — ia ada di
    // dalam `headers`, `body`, atau objek galat yang ikut di-log.
    const keluar = saring({
      request: { headers: { authorization: 'Bearer xyz', accept: 'json' } },
      daftar: [{ secret: 's' }, { aman: 1 }],
    }) as Record<string, Record<string, Record<string, unknown>>>;

    expect(keluar['request']!['headers']!['authorization']).toBe('[dibuang]');
    expect(keluar['request']!['headers']!['accept']).toBe('json');
    expect(JSON.stringify(keluar)).not.toContain('Bearer xyz');
  });

  it('bidang yang dibuang tetap TERLIHAT ada', () => {
    // Diganti, bukan dihapus: kehadiran bidangnya sering informasi yang
    // berguna saat menelusuri ("request ini memang membawa Authorization").
    const keluar = saring({ token: 'x' }) as Record<string, unknown>;
    expect(Object.keys(keluar)).toContain('token');
  });

  it('tidak melingkar tanpa batas pada struktur dalam', () => {
    let dalam: Record<string, unknown> = { token: 'x' };
    for (let i = 0; i < 20; i++) dalam = { lapis: dalam };
    expect(() => saring(dalam)).not.toThrow();
  });

  it('barisLog menghasilkan JSON sah dengan ts, level, msg', () => {
    const b = JSON.parse(barisLog('error', 'gagal', { request_id: 'r1', status: 500 })) as Record<
      string,
      unknown
    >;
    expect(b['level']).toBe('error');
    expect(b['msg']).toBe('gagal');
    expect(b['request_id']).toBe('r1');
    expect(b['status']).toBe(500);
    expect(typeof b['ts']).toBe('string');
  });

  it('barisLog tetap SATU baris meski pesannya memuat newline', () => {
    // Log agregat memecah per baris. Pesan multi-baris yang tidak di-escape
    // menghasilkan baris kedua yang bukan JSON, dan parser membuangnya —
    // biasanya tepat pada stack trace, yang justru isinya.
    const b = barisLog('error', 'baris1\nbaris2', { stack: 'a\nb\nc' });
    expect(b.includes('\n')).toBe(false);
    expect(() => JSON.parse(b)).not.toThrow();
  });

  it('format JSON hanya saat LOG_FORMAT=json', () => {
    delete process.env['LOG_FORMAT'];
    expect(formatJson()).toBe(false);
    process.env['LOG_FORMAT'] = 'pretty';
    expect(formatJson()).toBe(false);
    process.env['LOG_FORMAT'] = 'JSON';
    expect(formatJson()).toBe(true);
  });
});
