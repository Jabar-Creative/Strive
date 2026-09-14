import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { healthResponseSchema } from '@strive/contracts';
import { HealthService } from './health.service';

describe('HealthService', () => {
  let service: HealthService;

  beforeEach(() => {
    service = new HealthService();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('mengembalikan status ok dengan waktu saat ini', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-14T03:00:00.000Z'));

    const result = service.check();

    expect(result.status).toBe('ok');
    expect(result.service).toBe('api');
    expect(result.timestamp).toBe('2026-09-14T03:00:00.000Z');
  });

  it('responsnya cocok dengan skema zod di @strive/contracts', () => {
    // Kontrak dipegang SATU definisi yang dipakai web dan api — docs/PRD.md §10.1.
    expect(healthResponseSchema.safeParse(service.check()).success).toBe(true);
  });

  it('melaporkan mode dari env MODE', () => {
    const previous = process.env['MODE'];
    process.env['MODE'] = 'worker';
    try {
      expect(service.check().mode).toBe('worker');
    } finally {
      if (previous === undefined) delete process.env['MODE'];
      else process.env['MODE'] = previous;
    }
  });
});
