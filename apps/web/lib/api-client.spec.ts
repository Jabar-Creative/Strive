import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError, createApiClient } from './api-client';

/**
 * Test unit untuk api-client (L-04): implementasi pertama createApiClient
 * bersama dua endpoint pertamanya — GET /lessons/:id/cards (L-01) dan
 * POST /attempts (L-03, ⚡ idempoten).
 *
 * fetch dimock di level global; yang diuji adalah BENTUK request (URL,
 * header, body) dan pemetaan error ke ApiError yang bercabang pada `code`,
 * bukan pada `message` (kontrak §10.1).
 */

const BASE = 'http://localhost:3001';

function mockFetch(status: number, body: unknown) {
  // Response per panggilan: body-nya sekali baca, jadi mock yang mengembalikan
  // SATU instance untuk banyak panggilan meledak di panggilan kedua.
  const fetchMock = vi.fn().mockImplementation(() =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createApiClient — getLessonCards', () => {
  it('GET /api/v1/lessons/:id/cards dengan kredensial cookie', async () => {
    const fetchMock = mockFetch(200, {
      lessonId: 'l-1',
      title: 'Menemukan Sudut Pandang',
      estSeconds: 150,
      cards: [
        {
          id: 'c-1',
          kind: 'multiple_choice',
          prompt: 'Apa langkah pertama?',
          content: { options: [{ id: 'a', text: 'Riset audiens' }] },
          sortOrder: 1,
        },
      ],
    });
    const client = createApiClient({ baseUrl: BASE });
    const hasil = await client.getLessonCards('l-1');

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/api/v1/lessons/l-1/cards`);
    expect(init.method).toBe('GET');
    expect(init.credentials).toBe('include');
    expect(hasil.cards).toHaveLength(1);
    expect(hasil.cards[0]?.content.options[0]).toEqual({ id: 'a', text: 'Riset audiens' });
    // Kunci jawaban tidak pernah diharapkan ada — bentuk publik L-01
    expect(hasil.cards[0]).not.toHaveProperty('correct');
  });
});

describe('createApiClient — createAttempt', () => {
  it('POST /attempts dengan header Idempotency-Key dan body kontrak', async () => {
    const fetchMock = mockFetch(201, {
      attempt_id: 'att-1',
      rewarded: true,
      score: 100,
      points: 10,
      coins: 20,
      balance: 120,
      streak: { kind: 'extended', current: 3, longest: 7, is_new_record: false },
      quest: { done_tasks: 1, target_tasks: 3, completed: false },
      feedback: [{ card_id: 'c-1', correct: true, why: 'sebabnya' }],
    });
    const client = createApiClient({ baseUrl: BASE });
    const hasil = await client.createAttempt({
      lesson_id: 'l-1',
      answers: [{ card_id: 'c-1', answer: 'a', ms: 3000 }],
      duration_ms: 45_000,
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/api/v1/attempts`);
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    const headers = new Headers(init.headers);
    expect(headers.get('idempotency-key')).toMatch(/^[\w-]{16,}$/);
    expect(JSON.parse(String(init.body))).toEqual({
      lesson_id: 'l-1',
      answers: [{ card_id: 'c-1', answer: 'a', ms: 3000 }],
      duration_ms: 45_000,
    });
    expect(hasil.score).toBe(100);
    expect(hasil.feedback[0]?.why).toBe('sebabnya');
  });

  it('dua panggilan menghasilkan dua Idempotency-Key BERBEDA', async () => {
    const fetchMock = mockFetch(201, {});
    const client = createApiClient({ baseUrl: BASE });
    const payload = {
      lesson_id: 'l-1',
      answers: [{ card_id: 'c-1', answer: true, ms: 1000 }],
      duration_ms: 1000,
    };
    await client.createAttempt(payload);
    await client.createAttempt(payload);
    const k1 = new Headers((fetchMock.mock.calls[0] as [string, RequestInit])[1].headers).get(
      'idempotency-key',
    );
    const k2 = new Headers((fetchMock.mock.calls[1] as [string, RequestInit])[1].headers).get(
      'idempotency-key',
    );
    // Kunci idempoten mengikat SATU request; percobaan baru = kunci baru.
    // Mengulang kunci lama membuat retry jaringan dan attempt baru tak
    // bisa dibedakan server (LE-8).
    expect(k1).not.toBe(k2);
  });
});

describe('createApiClient — error', () => {
  it('respons gagal menjadi ApiError yang membawa code, bukan cuma message', async () => {
    mockFetch(403, {
      error: { code: 'FORBIDDEN_ROLE', message: 'Peran tidak diizinkan', details: {} },
    });
    const client = createApiClient({ baseUrl: BASE });
    const err = await client.getLessonCards('l-1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('FORBIDDEN_ROLE');
    expect((err as ApiError).status).toBe(403);
  });

  it('respons gagal TANPA bentuk error kontrak tetap jadi ApiError dengan code INTERNAL_ERROR', async () => {
    mockFetch(500, { aneh: true });
    const client = createApiClient({ baseUrl: BASE });
    const err = await client.getLessonCards('l-1').catch((e: unknown) => e);
    expect((err as ApiError).code).toBe('INTERNAL_ERROR');
    expect((err as ApiError).status).toBe(500);
  });
});
