import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Kysely } from 'kysely';

import { DATABASE, type DB } from '../../infra/kysely';
import { AiJobsService } from '../ai';
import { detectType } from '../scan';
import { PricingConfigService } from '../payment';
import { CoinLedgerService } from '../wallet';

import { pastikanKuotaAi } from './kuota-ai';

/**
 * `AI-07` sisi Node — `POST /career/cv` (PRD §7 E8, §10.3, §13.2 tahap 1).
 *
 * ── ASINKRON, beda fundamental dengan Prompt Lab ──
 *
 * Run prompt lab sinkron 30 detik (PL-2) sehingga uangnya selesai dalam satu
 * request. CV builder TIDAK: ekstraksi + LLM + render PDF bisa jauh di atas
 * batas HTTP, jadi responsnya `202 {job_id}` dan pekerjaannya hidup sebagai
 * baris `ai_jobs` kind `ats_cv` yang dikerjakan `AiDispatchService`
 * (aturan keras 8: Node tidak pernah memanggil LLM langsung).
 *
 * ── Uang tetap hold → settle | release (aturan keras 4) ──
 *
 * Hold `ref_type='ai_job'` ditulis DI DALAM transaksi yang sama dengan baris
 * job; settle saat finalisasi sukses (`CvFinalizeService`), release saat job
 * gagal atau disapu (hook `gagal` — audit AI-07 T1). Ref `'ai_job'` sudah
 * terdaftar di `RefType` sebelum AI-07; yang baru hanyalah pemakainya.
 *
 * ── Enqueue SETELAH commit (aturan keras 10) ──
 *
 * `buat()` baris job di dalam TRX, `jobs.enqueue()` setelah TRX selesai —
 * job yang berjalan sebelum commit membaca baris yang belum ada. Dua langkah
 * itu sengaja terpisah di `AiJobsService` supaya pelanggaran urutannya
 * terlihat dari sisi pemanggil.
 *
 * ── Kuota CV-9: 10 run AI/hari GABUNGAN ──
 *
 * Helper bersama `kuota-ai.ts` setelah baris `users` dikunci FOR UPDATE —
 * sama dengan Prompt Lab; percobaan dihitung dari ledger hold, jadi run CV
 * yang gagal tetap mengonsumsi kuota (LLM-nya benar-benar dijalankan).
 *
 * ── Idempotensi ⚡ ──
 *
 * Replay kunci yang menunjuk job HIDUP (`queued`/`running`/`done`) dijawab
 * `202` dengan `job_id` yang sama tanpa hold baru dan tanpa kuota ulang.
 * Replay atas job `failed` jatuh ke jalur normal: hold lama masih memegang
 * kunci itu, jadi percobaan BARU (job baru) menabrak `KEY_CONFLICT` —
 * kunci idempotensi milik PERCOBAAN, dan klien kita membuat kunci baru untuk
 * setiap percobaan ulang (keputusan yang sama dengan PL-01 #245).
 */

/** Batas panjang `target_role` — SAMA dengan `BagianCv` layanan AI (120). */
export const MAKS_TARGET_ROLE = 120;

/** Batas panjang string base64 yang diterima (body parser 11 MB). */
export const MAKS_B64_KARAKTER = 11_000_000;

/** Batas ukuran dokumen SETELAH didekode — pagar pertama sebelum layanan AI. */
export const MAKS_DOKUMEN_BYTE = 8 * 1024 * 1024;

/** Batas aman umum untuk field teks bebas dalam profil. */
const MAKS_TEKS = 2000;

export interface KontakCv {
  email?: string;
  telepon?: string;
  linkedin?: string;
  website?: string;
}

export interface PengalamanCv {
  judul: string;
  perusahaan: string;
  mulai: string;
  selesai?: string;
  deskripsi?: string;
}

export interface PendidikanCv {
  gelar: string;
  institusi: string;
  mulai: string;
  selesai?: string;
  jurusan?: string;
}

/** Bentuk `profile` — SATU dengan `ProfilCv` layanan AI (`extract.py`). */
export interface ProfilCvInput {
  nama: string;
  headline?: string;
  ringkasan?: string;
  kontak?: KontakCv;
  pengalaman?: PengalamanCv[];
  pendidikan?: PendidikanCv[];
  keterampilan?: string[];
}

export interface CvGenerateInput {
  target_role: string;
  language: 'id' | 'en';
  source: 'profile' | 'upload';
  profile?: ProfilCvInput;
  document_base64?: string;
}

/** Bentuk `ai_jobs.input` untuk kind `ats_cv` — passthrough `BagianCv` Python. */
export interface BagianCvJob {
  source: 'profile' | 'upload';
  target_role: string;
  language: string;
  profile?: unknown;
  document_base64?: string;
}

@Injectable()
export class CvBuilderService {
  constructor(
    @Inject(DATABASE) private readonly db: Kysely<DB>,
    private readonly coins: CoinLedgerService,
    private readonly pricing: PricingConfigService,
    private readonly jobs: AiJobsService,
  ) {}

  async buat(userId: string, input: CvGenerateInput, idempotencyKey: string): Promise<string> {
    const bagian = this.validasi(input);

    const cfg = await this.pricing.getCurrentVersion();
    if (!cfg) {
      throw new ServiceUnavailableException({
        error: { code: 'PRICING_NOT_CONFIGURED', message: 'Harga belum diterbitkan', details: {} },
      });
    }
    const biaya = cfg.cv_cost_coins;

    // ── Replay kunci yang menunjuk job HIDUP: jawab job itu, tanpa biaya ──
    const hidup = await this.cariJobHidup(userId, idempotencyKey);
    if (hidup) return hidup;

    // ── TRX: kunci users → kuota → baris job + hold ──
    const jobId = await this.db.transaction().execute(async (trx) => {
      await trx.selectFrom('users').select('id').where('id', '=', userId).forUpdate().execute();

      await pastikanKuotaAi(trx, userId);

      const id = await this.jobs.buat(trx, { userId, kind: 'ats_cv', input: bagian });

      const hold = await this.coins.hold(trx, {
        userId,
        amount: biaya,
        refType: 'ai_job',
        refId: id,
        idempotencyKey,
        note: 'AI-07: generate CV ATS',
      });
      // Hold yang kembali membawa refId JOB LAIN berarti kunci ini dipakai
      // percobaan lain yang benar-benar bersamaan — 409 yang jujur (pola PL-01
      // T3). Job baris ini tidak punya hold sendiri, dan TRX ini rollback.
      if (hold.refId !== id) {
        throw new HttpException(
          {
            error: {
              code: 'KEY_CONFLICT',
              message: 'Idempotency-Key ini sedang dipakai job lain — tunggu selesai lalu ulangi',
              details: {},
            },
          },
          HttpStatus.CONFLICT,
        );
      }
      return id;
    });

    // SETELAH commit — aturan keras 10. `enqueue()` idempoten terhadap job
    // yang masih hidup dan membuang job selesai supaya antre ulang bisa jalan.
    await this.jobs.enqueue(jobId);

    return jobId;
  }

  /**
   * Validasi input di BATAS SERVER. `apps/api` hanya boleh `import type` dari
   * `@strive/contracts`, jadi aturan yang sama dengan zod contracts
   * ditegakkan ulang di sini secara manual (pola `validasi()` PL-01) —
   * galatnya tetap bentuk §10.1 ber-`code`.
   */
  private validasi(input: CvGenerateInput): BagianCvJob {
    if (typeof input?.target_role !== 'string' || input.target_role.trim().length === 0) {
      galatCv('Target role wajib diisi', 'target_role');
    }
    if (input.target_role.length > MAKS_TARGET_ROLE) {
      galatCv(`Target role maksimal ${MAKS_TARGET_ROLE} karakter`, 'target_role');
    }
    if (input.language !== 'id' && input.language !== 'en') {
      galatCv("language wajib 'id' atau 'en'", 'language');
    }

    if (input.source === 'profile') {
      const profil =
        input.profile ?? galatCv("source 'profile' wajib memuat field profile", 'profile');
      this.validasiProfil(profil);
      return {
        source: 'profile',
        target_role: input.target_role,
        language: input.language,
        profile: profil,
      };
    }

    if (input.source === 'upload') {
      // `?? galatCv(...)`: cabang kosong BERHENTI di sini — `galatCv` balik
      // `never`, jadi `b64` terjamin `string` tanpa bergantung pada
      // penyempitan alir dari panggilan never (yang tidak selalu berlaku
      // untuk arrow di dalam method).
      const b64 =
        input.document_base64 ??
        galatCv("source 'upload' wajib memuat field document_base64", 'document_base64');
      if (typeof b64 !== 'string' || b64.length === 0) {
        galatCv('Dokumen kosong', 'document_base64');
      }
      if (b64.length > MAKS_B64_KARAKTER) {
        throw new BadRequestException({
          error: {
            code: 'FILE_TOO_LARGE',
            message: 'Dokumen melebihi batas unggahan',
            details: { maksimum_base64_karakter: MAKS_B64_KARAKTER },
          },
        });
      }
      // Base64 sah? Buffer Node bersifat lunak (mengabaikan karakter asing),
      // jadi charset diperiksa eksplisit — galat yang jelas di sini lebih baik
      // daripada 422 samar dari layanan AI setelah koin di-hold.
      if (!/^[A-Za-z0-9+/=\r\n]+$/.test(b64)) {
        galatCv('document_base64 bukan base64 sah', 'document_base64');
      }
      const dok = Buffer.from(b64, 'base64');
      if (dok.byteLength === 0) galatCv('Dokumen kosong', 'document_base64');
      if (dok.byteLength > MAKS_DOKUMEN_BYTE) {
        throw new BadRequestException({
          error: {
            code: 'FILE_TOO_LARGE',
            message: `Dokumen ${(dok.byteLength / 1048576).toFixed(1)} MB melebihi batas 8 MB`,
            details: { bytes: dok.byteLength, max_bytes: MAKS_DOKUMEN_BYTE },
          },
        });
      }
      // Tipe dari ISI berkas, bukan nama/Content-Type — `detectType` milik
      // klinik (K-01): `%PDF-` atau ZIP yang memuat `word/document.xml`.
      // Penjaga dekompresi #207 tetap di layanan AI; ini hanya pagar pertama
      // supaya berkas sembarang tidak pernah menjadi baris `ai_jobs`.
      if (detectType(dok) === null) {
        throw new BadRequestException({
          error: {
            code: 'UNSUPPORTED_FILE_TYPE',
            message: 'Hanya PDF dan DOCX yang diterima',
            details: {},
          },
        });
      }
      return {
        source: 'upload',
        target_role: input.target_role,
        language: input.language,
        document_base64: b64,
      };
    }

    return galatCv("source wajib 'profile' atau 'upload'", 'source');
  }

  private validasiProfil(p: ProfilCvInput): void {
    if (typeof p.nama !== 'string' || p.nama.trim().length === 0 || p.nama.length > 200) {
      galatCv('profile.nama wajib diisi 1–200 karakter', 'profile.nama');
    }
    for (const k of ['headline', 'ringkasan'] as const) {
      const v = p[k];
      if (v !== undefined && (typeof v !== 'string' || v.length > MAKS_TEKS)) {
        galatCv(`profile.${k} maksimal ${MAKS_TEKS} karakter`, `profile.${k}`);
      }
    }
    const teks = (v: unknown, bagian: string, wajib: boolean): void => {
      if (v === undefined || v === null) {
        if (wajib) galatCv(`${bagian} wajib diisi`, bagian);
        return;
      }
      if (typeof v !== 'string' || v.length === 0 || v.length > 200) {
        galatCv(`${bagian} wajib teks 1–200 karakter`, bagian);
      }
    };
    if (p.pengalaman !== undefined) {
      if (!Array.isArray(p.pengalaman) || p.pengalaman.length > 50) {
        galatCv('profile.pengalaman maksimal 50 entri', 'profile.pengalaman');
      }
      for (const x of p.pengalaman) {
        teks(x.judul, 'pengalaman.judul', true);
        teks(x.perusahaan, 'pengalaman.perusahaan', true);
        teks(x.mulai, 'pengalaman.mulai', true);
        teks(x.selesai, 'pengalaman.selesai', false);
        if (
          x.deskripsi !== undefined &&
          (typeof x.deskripsi !== 'string' || x.deskripsi.length > MAKS_TEKS)
        ) {
          galatCv(`pengalaman.deskripsi maksimal ${MAKS_TEKS} karakter`, 'pengalaman.deskripsi');
        }
      }
    }
    if (p.pendidikan !== undefined) {
      if (!Array.isArray(p.pendidikan) || p.pendidikan.length > 50) {
        galatCv('profile.pendidikan maksimal 50 entri', 'profile.pendidikan');
      }
      for (const x of p.pendidikan) {
        teks(x.gelar, 'pendidikan.gelar', true);
        teks(x.institusi, 'pendidikan.institusi', true);
        teks(x.mulai, 'pendidikan.mulai', true);
        teks(x.selesai, 'pendidikan.selesai', false);
        teks(x.jurusan, 'pendidikan.jurusan', false);
      }
    }
    if (p.keterampilan !== undefined) {
      if (!Array.isArray(p.keterampilan) || p.keterampilan.length > 100) {
        galatCv('profile.keterampilan maksimal 100 entri', 'profile.keterampilan');
      }
      for (const s of p.keterampilan) {
        if (typeof s !== 'string' || s.length === 0 || s.length > 100) {
          galatCv('keterampilan wajib teks 1–100 karakter', 'profile.keterampilan');
        }
      }
    }
    if (p.kontak !== undefined) {
      if (typeof p.kontak !== 'object' || p.kontak === null) {
        galatCv('profile.kontak harus objek', 'profile.kontak');
      }
      for (const k of ['email', 'telepon', 'linkedin', 'website'] as const) {
        const v = p.kontak[k];
        if (v !== undefined && (typeof v !== 'string' || v.length > 320)) {
          galatCv(`kontak.${k} maksimal 320 karakter`, `kontak.${k}`);
        }
      }
    }
  }

  /**
   * Kunci idempotensi → entri hold ledger → `ref_id` = job id. Job HIDUP
   * (belum `failed`) berarti percobaan yang sama masih/d sudah berjalan —
   * dijawab apa adanya. Job `failed` TIDAK: percobaan ulang adalah percobaan
   * BARU dan memakai kunci BARU (kunci lama masih memegang hold-nya sendiri).
   */
  private async cariJobHidup(userId: string, idempotencyKey: string): Promise<string | null> {
    const entri = await this.db
      .selectFrom('coin_ledger')
      .select(['ref_id'])
      .where('user_id', '=', userId)
      .where('idempotency_key', '=', idempotencyKey)
      .executeTakeFirst();
    if (!entri?.ref_id) return null;

    const job = await this.db
      .selectFrom('ai_jobs')
      .select(['id', 'status'])
      .where('id', '=', entri.ref_id)
      .where('user_id', '=', userId)
      .executeTakeFirst();
    if (!job || job.status === 'failed') return null;
    return job.id;
  }
}

/**
 * Galat validasi bentuk §10.1 — deklarasi TINGKAT MODUL (bukan arrow di dalam
 * method): tipe balikan `never` dari function declaration menghentikan alir
 * kendali TS dengan andal, dan dipakai `validasi`/`validasiProfil` bersama.
 */
function galatCv(pesan: string, bagian: string): never {
  throw new BadRequestException({
    error: { code: 'VALIDATION_ERROR', message: pesan, details: { bagian } },
  });
}
