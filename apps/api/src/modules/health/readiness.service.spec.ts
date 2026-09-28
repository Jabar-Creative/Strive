import { describe, expect, it, vi } from 'vitest';

import { BATAS_MS, ReadinessService, dalamBatas } from './readiness.service';

/**
 * Yang diuji di sini BUKAN "Postgres jalan" — itu urusan test integrasi.
 * Yang diuji: probe ini menjawab, dan jawabannya berubah saat dependensinya
 * berubah. Probe yang selalu `siap` sama tidak bergunanya dengan yang tidak ada.
 */

function layanan(db: unknown, redis: unknown): ReadinessService {
  return new ReadinessService(db as never, redis as never);
}

const dbSehat = { executeQuery: vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }) };
const redisSehat = { ping: vi.fn().mockResolvedValue('PONG') };

describe('ReadinessService', () => {
  it('keduanya sehat → siap', async () => {
    await expect(layanan(dbSehat, redisSehat).check()).resolves.toEqual({
      status: 'siap',
      checks: { database: 'ok', redis: 'ok' },
    });
  });

  it('Postgres mati → belum siap, dan Redis tetap dilaporkan apa adanya', async () => {
    const dbMati = { executeQuery: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) };
    await expect(layanan(dbMati, redisSehat).check()).resolves.toEqual({
      status: 'belum',
      checks: { database: 'gagal', redis: 'ok' },
    });
  });

  it('Redis mati → belum siap', async () => {
    const redisMati = { ping: vi.fn().mockRejectedValue(new Error("Stream isn't writeable")) };
    await expect(layanan(dbSehat, redisMati).check()).resolves.toEqual({
      status: 'belum',
      checks: { database: 'ok', redis: 'gagal' },
    });
  });

  it('dependensi yang MENGGANTUNG dilaporkan gagal, bukan membuat probe ikut menggantung', async () => {
    // Inti isu #155. Probe yang menggantung membuat orkestrator menunggu
    // sampai timeout-nya sendiri, dan selama itu ia tidak tahu apa-apa.
    const dbGantung = { executeQuery: vi.fn().mockReturnValue(new Promise(() => {})) };
    const mulai = Date.now();
    const hasil = await layanan(dbGantung, redisSehat).check();
    expect(hasil.checks.database).toBe('gagal');
    expect(Date.now() - mulai).toBeLessThan(BATAS_MS + 1_500);
  });

  it('keduanya ditembak BERSAMAAN — dua dependensi sakit tidak memakan dua kali batas waktu', async () => {
    const gantung = () => new Promise(() => {});
    const mulai = Date.now();
    await layanan({ executeQuery: gantung }, { ping: gantung }).check();
    expect(Date.now() - mulai).toBeLessThan(BATAS_MS * 2 - 200);
  });
});

describe('dalamBatas', () => {
  it('mengembalikan hasil kerja yang selesai tepat waktu', async () => {
    await expect(dalamBatas(async () => 'sudah', 500)).resolves.toBe('sudah');
  });

  it('menolak saat lewat batas', async () => {
    await expect(dalamBatas(() => new Promise(() => {}), 50)).rejects.toThrow(/lewat 50 ms/);
  });
});
