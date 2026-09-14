import { describe, expect, it } from 'vitest';
import { healthResponseSchema } from './health';

describe('healthResponseSchema', () => {
  it('menerima respons yang sah', () => {
    const result = healthResponseSchema.safeParse({
      status: 'ok',
      service: 'api',
      mode: 'api',
      timestamp: '2026-09-14T03:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('menolak timestamp yang bukan ISO 8601', () => {
    // docs/PRD.md §10.1: tanggal SELALU ISO 8601.
    const result = healthResponseSchema.safeParse({
      status: 'ok',
      service: 'api',
      mode: 'api',
      timestamp: '14-09-2026',
    });
    expect(result.success).toBe(false);
  });
});
