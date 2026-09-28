import { afterEach, describe, expect, it } from 'vitest';

import {
  BATAS_KEDALAMAN,
  StructuredLogger,
  barisLog,
  formatJson,
  levelDariEnv,
  saring,
} from './structured-logger';

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

  it('struktur dalam DIPOTONG, bukan dilewatkan apa adanya', () => {
    // Versi pertama test ini hanya memastikan `saring` tidak MELEMPAR —
    // dua puluh lapis dibungkus di sekeliling `{ token }`, dan tidak satu pun
    // assert memeriksa tokennya. Ia berhenti tepat sebelum pertanyaan yang
    // penting, dan karena itu tidak melihat bahwa versi lama mengembalikan
    // nilai apa adanya begitu melewati batas kedalaman.
    let dalam: Record<string, unknown> = { token: 'rahasia-di-lapis-dalam' };
    for (let i = 0; i < 20; i++) dalam = { lapis: dalam };

    expect(() => saring(dalam)).not.toThrow();
    expect(JSON.stringify(saring(dalam))).not.toContain('rahasia-di-lapis-dalam');
    expect(JSON.stringify(saring(dalam))).toContain('[terlalu dalam]');
  });

  it('bidang rahasia tepat DI batas kedalaman tetap dibuang', () => {
    // Batas itu sendiri adalah tempat paling mudah meleset satu lapis.
    let dalam: Record<string, unknown> = { token: 'tepat-di-batas' };
    for (let i = 0; i < BATAS_KEDALAMAN; i++) dalam = { lapis: dalam };
    expect(JSON.stringify(saring(dalam))).not.toContain('tepat-di-batas');
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

describe('LOG_LEVEL (isu #158)', () => {
  const asliLevel = process.env['LOG_LEVEL'];

  afterEach(() => {
    if (asliLevel === undefined) delete process.env['LOG_LEVEL'];
    else process.env['LOG_LEVEL'] = asliLevel;
  });

  it('tidak disetel → undefined, dan bawaan Nest TIDAK disentuh', () => {
    // Memberi bawaan di sini akan mendiamkan log yang selama ini muncul di
    // setiap lingkungan yang belum menyetelnya. Baris log yang hilang tanpa
    // ada yang memintanya baru ketahuan saat ia dibutuhkan.
    for (const kosong of [undefined, '', '   ']) {
      if (kosong === undefined) delete process.env['LOG_LEVEL'];
      else process.env['LOG_LEVEL'] = kosong;
      expect(levelDariEnv(), JSON.stringify(kosong)).toBeUndefined();
    }
  });

  it('tangga level naik, bukan satu level saja', () => {
    // `LOG_LEVEL=warn` berarti "warn ke atas", bukan "hanya warn". Yang
    // kedua akan menyembunyikan error justru saat orang menaikkan ambang.
    expect(levelDariEnv('error')).toEqual(['fatal', 'error']);
    expect(levelDariEnv('warn')).toEqual(['fatal', 'error', 'warn']);
    expect(levelDariEnv('info')).toEqual(['fatal', 'error', 'warn', 'log']);
    expect(levelDariEnv('debug')).toEqual(['fatal', 'error', 'warn', 'log', 'debug', 'verbose']);
  });

  it('`info` PRD dipetakan ke `log` Nest — dokumen tidak diubah demi nama pustaka', () => {
    expect(levelDariEnv('info')).toContain('log');
    expect(levelDariEnv('info')).not.toContain('debug');
  });

  it('nilai tidak dikenal → undefined, bukan diam-diam dianggap salah satu', () => {
    for (const aneh of ['INFO ', 'trace', 'silly', '3', 'true']) {
      const hasil = levelDariEnv(aneh);
      if (aneh === 'INFO ') expect(hasil).toEqual(['fatal', 'error', 'warn', 'log']);
      else expect(hasil, aneh).toBeUndefined();
    }
  });

  it('JALUR JSON ikut tersaring — ini yang paling mudah terlewat', () => {
    // Jalur JSON tidak lewat `super`, jadi `setLogLevels` tidak menyaringnya.
    // Tanpa penyaringan sendiri, LOG_LEVEL bekerja di dev dan diam-diam tidak
    // bekerja di produksi — satu-satunya tempat ia dibutuhkan.
    process.env['LOG_FORMAT'] = 'json';
    process.env['LOG_LEVEL'] = 'warn';

    const baris: string[] = [];
    const asliTulis = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((teks: string) => {
      baris.push(String(teks));
      return true;
    }) as typeof process.stdout.write;

    try {
      const logger = new StructuredLogger();
      logger.warn('ini harus muncul');
      logger.log('ini harus DIAM');
      logger.debug('ini juga harus DIAM');
    } finally {
      process.stdout.write = asliTulis;
    }

    const gabung = baris.join('');
    expect(gabung).toContain('ini harus muncul');
    expect(gabung).not.toContain('ini harus DIAM');
    expect(gabung).not.toContain('ini juga harus DIAM');
  });
});
