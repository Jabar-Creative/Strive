/**
 * Klien API terketik untuk web. Implementasi pertamanya datang bersama
 * endpoint pertama yang benar-benar dipakai UI — L-04: GET /lessons/:id/cards
 * (L-01) dan POST /attempts (L-03).
 *
 * Dua aturan yang harus bertahan saat file ini diisi (dari F-08):
 *   1. Percabangan error SELALU pada `error.code`, tidak pernah pada `message`.
 *      `code` adalah kontrak, `message` bukan — docs/PRD.md §10.1.
 *   2. Setiap POST yang mengubah saldo atau memberi hadiah mengirim header
 *      `Idempotency-Key` — docs/PRD.md §10.3 (ditandai ⚡). Untuk POST
 *      /attempts kuncinya MILIK PEMANGGIL: retry attempt yang sama memakai
 *      kunci sama (server mengembalikan respons pertama, LE-8), percobaan
 *      baru membangkitkan kunci baru (LE-4).
 *
 * Autentikasi lewat cookie sesi httpOnly milik API — `credentials:
 * 'include'`, tidak ada token di JavaScript.
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
}

/**
 * Kartu versi PUBLIK hasil serializer L-01: tidak ada `correct`/`why` di
 * mana pun — bentuk ini adalah SATU-SATUNYA shape kartu yang boleh dilihat
 * sisi client (CLAUDE.md aturan 9). Didefinisikan ulang di sini, bukan
 * diimpor dari apps/api, karena itu batas deployable (PRD §8.1).
 */
export interface PublicCard {
  id: string;
  kind: string;
  prompt: string;
  content: { options: { id: string; text: string }[] };
  sortOrder: number;
}

export interface LessonCardsResponse {
  lessonId: string;
  title: string;
  estSeconds: number;
  cards: PublicCard[];
}

/** Respons POST /attempts — AttemptResult di apps/api (L-03), bentuk kontrak. */
export interface AttemptResult {
  attempt_id: string;
  rewarded: boolean;
  score: number;
  points: number;
  coins: number;
  balance: number;
  streak: { kind: string; current: number; longest: number; is_new_record: boolean };
  quest: { done_tasks: number; target_tasks: number; completed: boolean };
  feedback: { card_id: string; correct: boolean; why: string }[];
}

/** Body POST /attempts — bentuk createAttemptRequestSchema (F-08). */
export interface AttemptPayload {
  lesson_id: string;
  answers: { card_id: string; answer: string | boolean; ms: number }[];
  duration_ms: number;
}

export function createApiClient(config: ApiClientConfig) {
  async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
    const headers: Record<string, string> = {};
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    if (opts.idempotencyKey) headers['idempotency-key'] = opts.idempotencyKey;

    const res = await fetch(`${config.baseUrl}/api/v1${path}`, {
      method: opts.method ?? 'GET',
      credentials: 'include',
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: opts.signal,
    });

    let data: unknown = null;
    const teks = await res.text();
    if (teks) {
      try {
        data = JSON.parse(teks);
      } catch {
        data = null; // body bukan JSON — diperlakukan seperti kosong di bawah
      }
    }

    if (!res.ok) {
      const rumpuk = (data as ApiErrorBody | null)?.error;
      throw new ApiError(
        rumpuk?.code ?? 'INTERNAL_ERROR',
        res.status,
        rumpuk?.message ?? `Permintaan gagal (${res.status})`,
        rumpuk?.details,
      );
    }
    return data as T;
  }

  return {
    /** GET /lessons/:id/cards — student & mentor (PRD §2.4). */
    getLessonCards(lessonId: string, opts?: Pick<RequestOptions, 'signal'>) {
      return request<LessonCardsResponse>(`/lessons/${lessonId}/cards`, { signal: opts?.signal });
    },

    /**
     * POST /attempts (⚡). Kunci idempoten MILIK PEMANGGIL, bukan klien:
     * retry atas attempt yang sama wajib memakai kunci yang SAMA (server
     * menjawab dengan hasil tersimpan, LE-8); percobaan baru membangkitkan
     * kunci baru (LE-4). Klien tidak tahu bedanya — pemanggil yang tahu.
     */
    createAttempt(
      payload: AttemptPayload,
      idempotencyKey: string,
      opts?: Pick<RequestOptions, 'signal'>,
    ) {
      return request<AttemptResult>('/attempts', {
        method: 'POST',
        body: payload,
        idempotencyKey,
        signal: opts?.signal,
      });
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
