import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

import type { AiJobKind } from '../../infra/kysely';

/** Hasil satu panggilan layanan AI — semua bidang pencatatan biaya §12.3. */
export interface AiRunResult {
  output: unknown;
  model: string;
  promptVersion: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface AiRunInput {
  jobId: string;
  kind: AiJobKind;
  input: unknown;
}

/**
 * Batas antara Node dan layanan AI — aturan keras 8.
 *
 * > Node tidak pernah memanggil LLM langsung. Selalu lewat `ai_jobs` + AI
 * > service, agar biaya bisa diaudit di satu tempat.
 *
 * Antarmuka, bukan kelas konkret, dengan alasan yang sama seperti
 * `PlagiarismProvider` dan `SnapClient`: jalur yang memuat uang dan retry
 * harus bisa dibuktikan **tanpa** memanggil vendor sungguhan. Di sini bahkan
 * lebih penting — layanannya sendiri (`AI-01`, Dev B) belum ada.
 */
export interface AiServiceClient {
  readonly name: string;
  run(p: AiRunInput): Promise<AiRunResult>;
}

/** Token injeksi — implementasinya ditukar di test. */
export const AI_SERVICE_CLIENT = Symbol('AI_SERVICE_CLIENT');

/**
 * Jalur per jenis job.
 *
 * Diturunkan dari router yang sudah tercatat di `CLAUDE.md`
 * (`services/ai/app/routers/`: `cv.py · prompt.py · interview.py ·
 * statement.py`). Ditulis sebagai peta konstan, bukan dirangkai dari nama
 * `kind`, supaya penambahan `ai_job_kind` baru **memerahkan tsc** alih-alih
 * menghasilkan URL 404 saat dijalankan.
 */
export const JALUR_AI: Record<AiJobKind, string> = {
  ats_cv: '/v1/cv',
  prompt_run: '/v1/prompt',
  interview_feedback: '/v1/interview',
  statement_review: '/v1/statement',
};

/** §12.3: timeout 60 detik. */
export const TIMEOUT_MS = 60_000;

/**
 * Klien HTTP ke layanan AI (FastAPI, `AI-01`).
 *
 * ── Galat 4xx TIDAK di-retry ──
 *
 * §12.2 menuliskannya untuk Copyleaks dan alasannya sama persis di sini:
 * input yang ditolak hari ini akan ditolak lagi besok. Mengulanginya tiga kali
 * hanya menunda pesan galat sampai pengguna sudah menutup halamannya. Yang
 * pantas diulang adalah kegagalan jaringan dan 5xx.
 */
@Injectable()
export class HttpAiServiceClient implements AiServiceClient {
  readonly name = 'ai-service';
  private readonly log = new Logger(HttpAiServiceClient.name);

  private get baseUrl(): string {
    return process.env['AI_SERVICE_URL'] ?? 'http://127.0.0.1:8000';
  }

  private get token(): string {
    return process.env['AI_SERVICE_TOKEN'] ?? '';
  }

  async run(p: AiRunInput): Promise<AiRunResult> {
    const url = `${this.baseUrl}${JALUR_AI[p.kind]}`;
    const batal = AbortSignal.timeout(TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify({ job_id: p.jobId, input: p.input }),
        signal: batal,
      });
    } catch (err) {
      // Jaringan: PANTAS diulang, jadi dilempar apa adanya supaya BullMQ
      // menjadwalkannya lagi.
      const pesan = err instanceof Error ? err.message : String(err);
      throw new ServiceUnavailableException(`Layanan AI tidak bisa dihubungi: ${pesan}`);
    }

    if (!res.ok) {
      const teks = (await res.text().catch(() => '')).slice(0, 300);
      if (res.status >= 400 && res.status < 500) {
        // Permanen. `AiDispatchService` mengenali tipe ini dan berhenti
        // mengulang.
        throw new GalatAiPermanen(`Layanan AI menolak job (${res.status}): ${teks}`);
      }
      this.log.warn(`Layanan AI gagal sementara (${res.status}) untuk job ${p.jobId}`);
      throw new ServiceUnavailableException(`Layanan AI gagal (${res.status}): ${teks}`);
    }

    return bacaHasil(await res.json());
  }
}

/** Kegagalan yang TIDAK akan berubah kalau diulang — 4xx, atau bentuk balasan salah. */
export class GalatAiPermanen extends Error {
  readonly permanen = true;
  constructor(message: string) {
    super(message);
    this.name = 'GalatAiPermanen';
  }
}

/** `true` untuk galat yang tidak pantas diulang. */
export function permanen(err: unknown): boolean {
  return err instanceof GalatAiPermanen;
}

/**
 * Balasan layanan AI, diperiksa bentuknya.
 *
 * Bukan kesopanan: `cost_usd` yang datang sebagai `undefined` akan tersimpan
 * sebagai NULL dan **hilang dari laporan biaya** tanpa satu pun galat — persis
 * jenis kerusakan yang paling lama tidak ketahuan, karena yang rusak adalah
 * angka yang hanya dibaca sebulan sekali.
 */
function bacaHasil(body: unknown): AiRunResult {
  if (typeof body !== 'object' || body === null) {
    throw new GalatAiPermanen('Balasan layanan AI bukan objek');
  }
  const b = body as Record<string, unknown>;
  const angka = (k: string): number => {
    const v = b[k];
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new GalatAiPermanen(`Balasan layanan AI tanpa ${k} yang sah`);
    }
    return v;
  };
  const teks = (k: string): string => {
    const v = b[k];
    if (typeof v !== 'string' || v.length === 0) {
      throw new GalatAiPermanen(`Balasan layanan AI tanpa ${k} yang sah`);
    }
    return v;
  };

  return {
    output: b['output'],
    model: teks('model'),
    promptVersion: teks('prompt_version'),
    inputTokens: angka('input_tokens'),
    outputTokens: angka('output_tokens'),
    costUsd: angka('cost_usd'),
  };
}
