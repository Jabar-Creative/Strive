/**
 * KERANGKA typed API client. Belum ada satu pun endpoint — itu disengaja.
 *
 * Endpoint ditambahkan bersama skema zod-nya di `@strive/contracts` (item F-08,
 * Dev B), supaya request/response punya SATU definisi yang dipakai dua sisi:
 * pipe validasi di NestJS dan form resolver di web. Lihat docs/PRD.md §10.1.
 *
 * Dua aturan yang harus bertahan saat file ini diisi:
 *   1. Percabangan error SELALU pada `error.code`, tidak pernah pada `message`.
 *      `code` adalah kontrak, `message` bukan — docs/PRD.md §10.1.
 *   2. Setiap POST yang mengubah saldo atau memberi hadiah mengirim
 *      header `Idempotency-Key` — docs/PRD.md §10.3 (ditandai ⚡).
 */

/** Bentuk error API yang dijanjikan docs/PRD.md §10.1. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

/** Dilempar untuk setiap respons non-2xx. Cabang pada `code`, bukan `message`. */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Wajib untuk rute bertanda ⚡ di docs/PRD.md §10.3. */
  idempotencyKey?: string;
  signal?: AbortSignal;
}

export interface ApiClientConfig {
  baseUrl: string;
  /** Dipanggil tiap request; mengembalikan access token yang masih berlaku. */
  getAccessToken?: () => string | null | Promise<string | null>;
}

export function createApiClient(_config: ApiClientConfig) {
  // Implementasi menyusul bersama endpoint pertama (F-08 -> A-03).
  throw new Error(
    'api-client belum diimplementasikan — lihat F-08 di docs/BACKLOG.md sebelum memakainya.',
  );
}

export type ApiClient = ReturnType<typeof createApiClient>;
