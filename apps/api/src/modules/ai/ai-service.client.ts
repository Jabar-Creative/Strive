import { Injectable, Logger } from '@nestjs/common';

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
 * ── Galat 4xx TIDAK di-retry, KECUALI 401 dan 403 ──
 *
 * §12.2 menuliskannya untuk Copyleaks dan alasannya sama persis di sini:
 * input yang ditolak hari ini akan ditolak lagi besok. Mengulanginya tiga kali
 * hanya menunda pesan galat sampai pengguna sudah menutup halamannya. Yang
 * pantas diulang adalah kegagalan jaringan dan 5xx.
 *
 * **401 dan 403 bukan salah satunya** (isu #184). Keduanya tidak mengatakan
 * apa pun tentang job-nya; keduanya mengatakan **dua proses tidak sepakat soal
 * kredensial** — keadaan operasional, dan satu-satunya 4xx yang bisa berubah
 * tanpa job-nya berubah. Memperlakukannya permanen berarti satu salah ketik
 * `AI_SERVICE_TOKEN` di dashboard menandai SETIAP `ai_jobs` `failed` pada
 * percobaan PERTAMA, dan membetulkan variabelnya tidak menghidupkan satu pun
 * kembali — tidak ada penyapu yang mengantrekannya ulang (isu #131).
 *
 * Yang dipilih jalan tengah: 401/403 ikut jatah percobaan biasa (tiga, dengan
 * backoff), tidak dikubur di percobaan pertama dan tidak diulang abadi. Kalau
 * kredensialnya diperbaiki di dalam jendela itu, job-nya selamat sendiri.
 *
 * ── `code` dibaca, bukan dijejalkan ke dalam pesan ──
 *
 * Layanan AI mengirim bentuk §10.1 (`{error:{code,message}}`), dan docstring
 * `services/ai/app/core/errors.py` menuliskan alasannya: supaya sisi ini
 * **mencabang pada `code`**. Versi pertama berkas ini tidak pernah mem-parse
 * badannya — ia membaca `res.status` lalu menjejalkan 300 karakter pertama ke
 * dalam string pesan, dan satu-satunya cara mengetahui galat apa yang terjadi
 * jadi mem-parsing teks: persis yang dilarang CLAUDE.md ("Kode error adalah
 * KONTRAK. Pesan bukan."). Janji yang tidak ditegakkan apa pun selama tidak ada
 * yang mencobanya (isu #190).
 *
 * Kodenya dibawa di `kode` dan disimpan di `ai_jobs.error_code` (migrasi 009)
 * APA ADANYA, termasuk kode yang tidak ada di daftar TERTUTUP §10.2. Itu kolom
 * DIAGNOSIS, bukan kontrak klien: `PAYLOAD_TOO_LARGE`, `NOT_IMPLEMENTED`,
 * `METHOD_NOT_ALLOWED`, dan `HTTP_ERROR` memang bukan kode §10.2, dan
 * menyaringnya di sini akan membuang justru informasi yang dicari saat
 * mendiagnosis. Penyaringan ke §10.2 adalah pekerjaan batas KLIEN — dan batas
 * itu BELUM ADA: tidak satu pun rute yang menyajikan kegagalan `ai_jobs` ke
 * pengguna hari ini (`AI-07`, `MT-02`, keduanya `todo`). Siapa pun yang
 * membuatnya WAJIB memetakan kode di luar §10.2 ke `INTERNAL_ERROR`.
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
      // menjadwalkannya lagi. Tanpa `kode` — tidak ada badan respons untuk
      // dibaca, dan menebak satu akan mencatat kode yang tidak pernah dikirim
      // siapa pun.
      const pesan = err instanceof Error ? err.message : String(err);
      throw new GalatAiSementara(`Layanan AI tidak bisa dihubungi: ${pesan}`);
    }

    if (!res.ok) {
      const { kode, pesan } = await bacaGalat(res);
      const ringkas = `(${res.status}${kode === undefined ? '' : ` ${kode}`}): ${pesan}`;

      if (permanenMenurutStatus(res.status)) {
        // Permanen. `AiDispatchService` mengenali tipe ini dan berhenti
        // mengulang.
        throw new GalatAiPermanen(`Layanan AI menolak job ${ringkas}`, kode);
      }
      // 401/403 sampai di sini DENGAN SENGAJA (isu #184) — kredensial yang
      // tidak cocok pantas diulang, bukan dikubur.
      this.log.warn(`Layanan AI gagal sementara ${ringkas} untuk job ${p.jobId}`);
      throw new GalatAiSementara(`Layanan AI gagal ${ringkas}`, kode);
    }

    return bacaHasil(await res.json());
  }
}

/**
 * 4xx yang permanen — SEMUA kecuali 401 dan 403.
 *
 * Fungsi tersendiri, bukan ekspresi inline, supaya pengecualiannya punya satu
 * tempat dan satu test. Isu #184.
 */
export const STATUS_KREDENSIAL = [401, 403] as const;

export function permanenMenurutStatus(status: number): boolean {
  if (STATUS_KREDENSIAL.includes(status as (typeof STATUS_KREDENSIAL)[number])) return false;
  return status >= 400 && status < 500;
}

/** Galat layanan AI yang membawa `code` §10.1 kalau balasannya punya. */
abstract class GalatAi extends Error {
  /**
   * `code` dari badan respons, APA ADANYA — termasuk yang di luar §10.2.
   * `undefined` kalau balasannya tidak berbentuk §10.1 (proxy yang mengirim
   * HTML, atau badan kosong).
   */
  readonly kode: string | undefined;
  constructor(message: string, kode: string | undefined) {
    super(message);
    this.kode = kode;
  }
}

/** Kegagalan yang TIDAK akan berubah kalau diulang — 4xx bukan-kredensial, atau bentuk balasan salah. */
export class GalatAiPermanen extends GalatAi {
  readonly permanen = true;
  constructor(message: string, kode?: string) {
    super(message, kode);
    this.name = 'GalatAiPermanen';
  }
}

/**
 * Kegagalan yang PANTAS diulang — 5xx, dan 401/403 (isu #184).
 *
 * Menggantikan `ServiceUnavailableException` di jalur ini: Nest-nya tidak salah,
 * tapi ia tidak bisa membawa `kode`, dan yang membaca galat ini adalah worker —
 * bukan klien HTTP. Status 503 yang ikut dibawanya tidak pernah sampai ke
 * siapa pun.
 */
export class GalatAiSementara extends GalatAi {
  readonly permanen = false;
  constructor(message: string, kode?: string) {
    super(message, kode);
    this.name = 'GalatAiSementara';
  }
}

/** `true` untuk galat yang tidak pantas diulang. */
export function permanen(err: unknown): boolean {
  return err instanceof GalatAiPermanen;
}

/** `code` galat layanan AI kalau ada — untuk `ai_jobs.error_code`. */
export function kodeGalat(err: unknown): string | undefined {
  return err instanceof GalatAi ? err.kode : undefined;
}

/**
 * Badan galat layanan AI: `code` kalau bentuknya §10.1, teks apa adanya kalau
 * tidak.
 *
 * `res.json()` TIDAK dipakai langsung: respons yang datang dari proxy atau load
 * balancer berisi HTML, dan `json()` yang melempar di sini akan menukar galat
 * sungguhan dengan `SyntaxError` — kegagalan yang menunjuk ke tempat salah.
 * Jadi teksnya dibaca dulu, lalu DICOBA diurai.
 *
 * Bentuknya diperiksa, bukan keberadaan kuncinya: `{ error: 'Not Found' }`
 * (bentuk bawaan Nest, dan bentuk banyak proxy) punya `error` bertipe STRING,
 * dan `'error' in isi` meloloskannya — jebakan yang sama sudah pernah menggigit
 * di `AllExceptionsFilter`.
 */
async function bacaGalat(res: Response): Promise<{ kode?: string; pesan: string }> {
  const teks = (await res.text().catch(() => '')).slice(0, 1_000);
  let urai: unknown;
  try {
    urai = JSON.parse(teks);
  } catch {
    return { pesan: teks.slice(0, 300) };
  }
  if (typeof urai !== 'object' || urai === null) return { pesan: teks.slice(0, 300) };
  const galat = (urai as { error?: unknown }).error;
  if (typeof galat !== 'object' || galat === null) return { pesan: teks.slice(0, 300) };
  const { code, message } = galat as { code?: unknown; message?: unknown };
  if (typeof code !== 'string' || code.length === 0) return { pesan: teks.slice(0, 300) };
  return {
    kode: code,
    pesan: typeof message === 'string' && message.length > 0 ? message.slice(0, 300) : code,
  };
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
