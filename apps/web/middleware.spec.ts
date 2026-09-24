import { afterEach, describe, expect, it, vi } from 'vitest';

import { NextRequest } from 'next/server';

import { config, middleware } from './middleware';

/**
 * Test unit untuk middleware (student) vs (console) — A-04.
 *
 * `fetch` ke GET /api/v1/me dimock di level global karena satu-satunya hal
 * yang diuji di sini adalah perilaku middleware terhadap tiap jawaban API.
 * Bagaimana API menghasilkan jawaban itu sudah punya test integrasinya
 * sendiri di apps/api (A-02, A-05).
 */

/** Mock fetch yang menjawab status + role seperti GET /me sungguhan. */
function mockMe(status: number, body?: unknown) {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function permintaan(lokasi: string, cookie?: string) {
  const headers = new Headers();
  if (cookie) headers.set('cookie', cookie);
  return new NextRequest(`http://localhost:3000${lokasi}`, { headers });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('middleware console (A-04)', () => {
  it('tanpa cookie sesi → redirect ke /login', async () => {
    mockMe(401);
    const res = await middleware(permintaan('/admin'));
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    expect(new URL(res.headers.get('location')!).pathname).toBe('/login');
  });

  it('student → 403 dengan halaman HTML yang jelas', async () => {
    mockMe(200, { role: 'student' });
    const res = await middleware(permintaan('/mentor', 'better-auth.session_token=x'));
    expect(res.status).toBe(403);
    expect(res.headers.get('content-type')).toContain('text/html');
    const body = await res.text();
    expect(body).toContain('konsol');
    expect(body).toContain('mentor');
    expect(body).toContain('superadmin');
  });

  it('mentor → lewat tanpa diubah', async () => {
    mockMe(200, { role: 'mentor' });
    const res = await middleware(permintaan('/mentor', 'better-auth.session_token=x'));
    expect(res.status).toBe(200);
  });

  it('sesi basi (401 dari API) → redirect ke /login', async () => {
    mockMe(401);
    const res = await middleware(permintaan('/admin', 'better-auth.session_token=kadaluarsa'));
    expect(new URL(res.headers.get('location')!).pathname).toBe('/login');
  });

  it('API tak terjangkau → gagal-tertutup: 403, bukan pintu terbuka', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    const res = await middleware(permintaan('/admin', 'better-auth.session_token=x'));
    expect(res.status).toBe(403);
  });

  it('menjaga /mentor dan /admin beserta turunannya', () => {
    expect(config.matcher).toContain('/mentor/:path*');
    expect(config.matcher).toContain('/admin/:path*');
  });
});
