import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  GalatAiPermanen,
  GalatAiSementara,
  HttpAiServiceClient,
  kodeGalat,
  permanenMenurutStatus,
} from './ai-service.client';

/**
 * Jahitan galat Node ↔ layanan AI — isu #190 dan #184.
 *
 * Yang diuji di sini BUKAN "fungsinya berjalan", melainkan dua keputusan yang
 * dulu salah dan tidak punya penjaga apa pun:
 *
 * 1. `code` §10.1 yang dikirim layanan AI benar-benar DIBACA, bukan ikut
 *    tenggelam ke dalam string pesan (#190).
 * 2. 401/403 TIDAK dihitung permanen, jadi token yang tidak cocok tidak
 *    mengubur setiap job di percobaan pertama (#184).
 */

function balasan(status: number, body: string, tipe = 'application/json'): Response {
  return new Response(body, { status, headers: { 'content-type': tipe } });
}

function klien(): HttpAiServiceClient {
  return new HttpAiServiceClient();
}

const JOB = { jobId: '00000000-0000-4000-8000-000000000001', kind: 'ats_cv' as const, input: {} };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('permanenMenurutStatus', () => {
  it('4xx biasa permanen — input yang ditolak hari ini ditolak lagi besok', () => {
    for (const s of [400, 404, 409, 413, 422, 429]) {
      expect(permanenMenurutStatus(s), `status ${s}`).toBe(true);
    }
  });

  it('401 dan 403 TIDAK permanen — keduanya soal kredensial, bukan soal job', () => {
    // Isu #184. Satu salah ketik AI_SERVICE_TOKEN di dashboard akan menandai
    // SETIAP ai_jobs failed di percobaan pertama, dan membetulkan env-nya tidak
    // menghidupkan satu pun kembali — tidak ada penyapu (isu #131).
    expect(permanenMenurutStatus(401)).toBe(false);
    expect(permanenMenurutStatus(403)).toBe(false);
  });

  it('5xx tidak permanen, dan 3xx/2xx bukan urusannya', () => {
    for (const s of [500, 502, 503, 504])
      expect(permanenMenurutStatus(s), `status ${s}`).toBe(false);
    expect(permanenMenurutStatus(302)).toBe(false);
    expect(permanenMenurutStatus(200)).toBe(false);
  });
});

describe('HttpAiServiceClient — membaca `code`, bukan mem-parsing pesan', () => {
  it('4xx berbentuk §10.1: kodenya dibawa, bukan hanya tersisa di teks', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        balasan(
          400,
          JSON.stringify({
            error: { code: 'DOCUMENT_TOO_LONG', message: 'Dokumen melebihi 20 halaman' },
          }),
        ),
      ),
    );

    const err = await klien()
      .run(JOB)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(GalatAiPermanen);
    // INI yang tidak ada sebelumnya: kode sebagai nilai, bukan substring.
    expect(kodeGalat(err)).toBe('DOCUMENT_TOO_LONG');
    expect((err as Error).message).toContain('Dokumen melebihi 20 halaman');
  });

  it('401 berbentuk §10.1: kodenya dibawa DAN galatnya SEMENTARA', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        balasan(
          401,
          JSON.stringify({
            error: { code: 'UNAUTHENTICATED', message: 'Token layanan tidak sah atau tidak ada' },
          }),
        ),
      ),
    );

    const err = await klien()
      .run(JOB)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(GalatAiSementara);
    expect(err).not.toBeInstanceOf(GalatAiPermanen);
    expect(kodeGalat(err)).toBe('UNAUTHENTICATED');
  });

  it('kode di LUAR §10.2 dibawa apa adanya — ini kolom diagnosis, bukan kontrak klien', async () => {
    // `NOT_IMPLEMENTED` (503) dan `PAYLOAD_TOO_LARGE` (413) memang bukan kode
    // §10.2. Menyaringnya DI SINI akan membuang justru informasi yang dicari
    // saat mendiagnosis; penyaringan ke §10.2 adalah pekerjaan batas KLIEN,
    // dan batas itu belum ada (AI-07/MT-02 masih todo).
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          balasan(503, JSON.stringify({ error: { code: 'NOT_IMPLEMENTED', message: 'skeleton' } })),
        ),
    );
    expect(
      kodeGalat(
        await klien()
          .run(JOB)
          .catch((e: unknown) => e),
      ),
    ).toBe('NOT_IMPLEMENTED');
  });

  it('badan HTML dari proxy tidak menukar galat sungguhan dengan SyntaxError', async () => {
    // `res.json()` langsung akan melempar di sini, dan kegagalannya akan
    // menunjuk ke parser alih-alih ke layanan yang sedang mati.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(balasan(502, '<html><body>Bad Gateway</body></html>', 'text/html')),
    );

    const err = await klien()
      .run(JOB)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(GalatAiSementara);
    expect(kodeGalat(err)).toBeUndefined();
    expect((err as Error).message).toContain('Bad Gateway');
  });

  it('`{ error: "Not Found" }` TIDAK dibaca sebagai kode — bentuknya diperiksa, bukan kuncinya', async () => {
    // Bentuk bawaan Nest dan banyak proxy: `error` bertipe STRING. Pemeriksaan
    // `'error' in isi` meloloskannya, dan jebakan yang sama sudah pernah
    // menggigit di AllExceptionsFilter.
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(balasan(404, JSON.stringify({ statusCode: 404, error: 'Not Found' }))),
    );

    const err = await klien()
      .run(JOB)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(GalatAiPermanen);
    expect(kodeGalat(err)).toBeUndefined();
  });

  it('kegagalan JARINGAN sementara dan TANPA kode — kolom diisi tebakan lebih buruk daripada kosong', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    const err = await klien()
      .run(JOB)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(GalatAiSementara);
    expect(kodeGalat(err)).toBeUndefined();
  });
});
