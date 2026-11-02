import {
  BadRequestException,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Kysely } from 'kysely';

import { DATABASE, type DB } from '../../infra/kysely';
import {
  AI_SERVICE_CLIENT,
  GalatAiPermanen,
  GalatAiSementara,
  kodeGalat,
  type AiServiceClient,
} from '../ai';
import { PricingConfigService } from '../payment';
import { CoinLedgerService } from '../wallet';

import { pastikanKuotaAi } from './kuota-ai';

/**
 * `PL-01` sisi Node — `POST /career/prompt-lab/run` (PRD §7 E13, §10.3).
 *
 * ── Uang: hold → settle | release, BUKAN debit langsung ──
 *
 * PRD PL-3 menulis "dipotong langsung (bukan hold — tidak ada yang bisa
 * gagal setelah respons diterima)". Premisnya salah: LLM BISA gagal setelah
 * niat bayar terbentuk, dan itulah yang dilarang aturan keras 4 (CLAUDE.md).
 * Keputusan #245 (Dev A, pemilik ledger): `RefType 'prompt_run'` ditambahkan
 * JUSTRU supaya jalur ini bisa mematuhi aturan 4 — hold sebelum LLM, settle
 * saat berhasil, release saat gagal. Penyuntingan PRD menyusul (dicatat PR).
 *
 * ── Kuota PL-4: 10 run AI/hari, GABUNGAN ──
 *
 * Helper bersama `kuota-ai.ts` (dipakai juga CV builder AI-07): percobaan
 * dihitung dari hold ledger `ref_type IN ('prompt_run','ai_job')` plus
 * `mastery_sessions`, hari LOKAL pengguna (`AT TIME ZONE st.timezone`;
 * streaks.timezone — pelajaran #193: satu sumber dengan penulis attempt).
 * "Hari ini" = sejak tengah malam lokal, bukan 24 jam bergulir.
 *
 * ── Idempotensi ⚡ ──
 *
 * Replay kunci yang sudah SETTLE mengembalikan run tersimpan tanpa menyentuh
 * LLM (ledger memegang pemetaan kunci → `ref_id` = baris run — #245). Replay
 * saat run masih berjalan dilayani jalur normal: `hold` idempoten, `settle`
 * idempoten, `coin_ledger_ref_uniq` menjaga satu potongan per baris run.
 * Biaya LLM ganda pada replay yang BENAR-BERSAMAAN adalah risiko yang diterima
 * dan dicatat — klien sinkron kita memakai retry berurutan.
 */

/** §7 E13 PL-2: sinkron, timeout 30 detik — DI BAWAH 60 dtk milik klien AI. */
export const BATAS_RUN_MS = 30_000;

/** Batas per bagian — sama dengan `promptLabSectionsSchema` (koreksi F-08 T-4). */
const MAKS_BAGIAN = 2000;

export interface PromptRunSections {
  role: string;
  context: string;
  task: string;
  format: string;
  constraints: string;
}

@Injectable()
export class PromptLabService {
  constructor(
    @Inject(DATABASE) private readonly db: Kysely<DB>,
    private readonly coins: CoinLedgerService,
    private readonly pricing: PricingConfigService,
    @Inject(AI_SERVICE_CLIENT) private readonly ai: AiServiceClient,
  ) {
    // `batasMs` BUKAN parameter konstruktor: Nest membaca metadata tipe
    // (`Number`) sebagai token DI dan gagal resolve saat boot — jebakan yang
    // sama dengan `retryDelayMs` (catatan di notifications.service). Field
    // publik yang bisa ditimpa test, tanpa transit DI sama sekali.
  }

  /** Batas waktu run — ditimpa test (AC-PL-2 tanpa menunggu 30 dtk nyata). */
  batasMs: number = BATAS_RUN_MS;

  async run(
    userId: string,
    bagian: PromptRunSections,
    idempotencyKey: string,
  ): Promise<{ id: string; output: string; balance: number }> {
    this.validasi(bagian);

    const cfg = await this.pricing.getCurrentVersion();
    if (!cfg) {
      throw new ServiceUnavailableException({
        error: { code: 'PRICING_NOT_CONFIGURED', message: 'Harga belum diterbitkan', details: {} },
      });
    }
    const biaya = cfg.prompt_run_cost_coins;

    // ── Replay kunci yang sudah selesai: jawab dari simpanan ──
    const replay = await this.cariRunSelesai(userId, idempotencyKey);
    if (replay) return replay;

    // ── TRX 1: kunci users → kuota (anti-balapan) → baris run + hold ──
    // (ref menunjuk BARIS run — pola ST-01). Kunci FOR UPDATE baris users
    // menyerialisasi pemanggil satu pengguna; kuota membaca keadaan yang
    // tidak bisa lagi berubah di bawahnya.
    const runId = await this.db.transaction().execute(async (trx) => {
      await trx.selectFrom('users').select('id').where('id', '=', userId).forUpdate().execute();

      await pastikanKuotaAi(trx, userId);

      const baris = await trx
        .insertInto('prompt_runs')
        .values({
          user_id: userId,
          structure: bagian as unknown as import('../../infra/kysely').Json,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const hold = await this.coins.hold(trx, {
        userId,
        amount: biaya,
        refType: 'prompt_run',
        refId: baris.id,
        idempotencyKey,
        note: 'PL-3: run prompt lab',
      });
      // T3 (audit): hold yang dikembalikan bisa REPLAY kunci dari run lain
      // (paralel kunci sama / kunci tabrakan lintas percobaan). refId yang
      // berbeda berarti run INI tidak punya hold sendiri — panggil LLM hanya
      // membayar vendor dua kali. Berhenti di sini, jawab 409 yang jujur.
      if (hold.refId !== baris.id) {
        throw new HttpException(
          {
            error: {
              code: 'KEY_CONFLICT',
              message: 'Idempotency-Key ini sedang dipakai run lain — tunggu selesai lalu ulangi',
              details: {},
            },
          },
          HttpStatus.CONFLICT,
        );
      }
      return baris.id;
    });

    // ── LLM DI LUAR transaksi: panggilan jaringan tidak boleh menahan
    //    koneksi/lock Postgres (semangat aturan 6) ──
    try {
      const hasil = await this.denganBatas(
        this.ai.run({
          jobId: runId,
          kind: 'prompt_run',
          input: { ...bagian, bahasa: 'id' },
        }),
      );
      const output = typeof hasil.output === 'string' ? hasil.output : JSON.stringify(hasil.output);

      // ── TRX 2: settle + simpan output ──
      return await this.db.transaction().execute(async (trx) => {
        await this.coins.settle(trx, {
          userId,
          refType: 'prompt_run',
          refId: runId,
          note: 'PL-1: run selesai',
        });
        await trx.updateTable('prompt_runs').set({ output }).where('id', '=', runId).execute();
        const u = await trx
          .selectFrom('users')
          .select('coin_balance')
          .where('id', '=', userId)
          .executeTakeFirstOrThrow();
        return { id: runId, output, balance: u.coin_balance };
      });
    } catch (err) {
      // ── TRX 3: release + hapus baris (riwayat hanya run BERHASIL, PL-6;
      //    jejak keuangannya tetap utuh di pasangan hold+release ledger) ──
      await this.db.transaction().execute(async (trx) => {
        await this.coins.release(trx, {
          userId,
          refType: 'prompt_run',
          refId: runId,
          // Alasan GENERIK: note ledger tampil di riwayat dompet — teks
          //      mentah respons vendor/proxy tidak boleh sampai ke sana
          //      (audit PL-01 T4). Detailnya cukup di log proses.
          reason: 'run gagal',
        });
        await trx.deleteFrom('prompt_runs').where('id', '=', runId).execute();
      });
      throw this.petaGalat(err);
    }
  }

  private validasi(b: PromptRunSections): void {
    const kunci: (keyof PromptRunSections)[] = ['role', 'context', 'task', 'format', 'constraints'];
    for (const k of kunci) {
      const v = (b ?? ({} as PromptRunSections))[k];
      if (typeof v !== 'string' || v.trim().length === 0 || v.length > MAKS_BAGIAN) {
        throw new BadRequestException({
          error: {
            code: 'VALIDATION_ERROR',
            message: `Bagian ${k} wajib diisi 1–${MAKS_BAGIAN} karakter`,
            details: { bagian: k },
          },
        });
      }
    }
  }

  /** Replay: entri ledger kunci ini menunjuk baris run yang SUDAH ber-output. */
  private async cariRunSelesai(
    userId: string,
    idempotencyKey: string,
  ): Promise<{ id: string; output: string; balance: number } | null> {
    const entri = await this.db
      .selectFrom('coin_ledger')
      .select(['ref_id'])
      .where('user_id', '=', userId)
      .where('idempotency_key', '=', idempotencyKey)
      .executeTakeFirst();
    if (!entri?.ref_id) return null;

    const run = await this.db
      .selectFrom('prompt_runs')
      .select(['id', 'output'])
      .where('id', '=', entri.ref_id)
      .where('user_id', '=', userId)
      .executeTakeFirst();
    if (!run?.output) return null; // belum selesai / terhapus — jalur normal

    const u = await this.db
      .selectFrom('users')
      .select('coin_balance')
      .where('id', '=', userId)
      .executeTakeFirstOrThrow();
    return { id: run.id, output: run.output, balance: u.coin_balance };
  }

  private denganBatas<T>(p: Promise<T>): Promise<T> {
    return Promise.race([
      p,
      new Promise<never>((_, tolak) =>
        setTimeout(() => tolak(new Error('Layanan AI tidak menjawab tepat waktu')), this.batasMs),
      ),
    ]);
  }

  /**
   * Kode layanan AI di luar §10.2 WAJIB dipetakan di batas klien (aturan
   * tertulis di ai-service.client). Sementara/jaringan/timeout →
   * PROVIDER_UNAVAILABLE — AC-PL-2: pesan yang bisa dipahami, bukan 500 mentah.
   */
  private petaGalat(err: unknown): HttpException {
    if (err instanceof HttpException) return err;
    // Error internal (bug ledger, dsb.) TIDAK boleh menyamar jadi galat
    // vendor — pesan "koin tidak terpotong" yang salah lebih berbahaya
    // daripada 500 yang jujur (audit PL-01 T3).
    if (!(err instanceof GalatAiPermanen) && !(err instanceof GalatAiSementara)) {
      return new InternalServerErrorException();
    }
    const kode = kodeGalat(err);
    if (err instanceof GalatAiPermanen && kode) {
      const status =
        kode === 'LLM_OUTPUT_INVALID' ? HttpStatus.UNPROCESSABLE_ENTITY : HttpStatus.BAD_REQUEST;
      return new HttpException(
        {
          error: { code: kode, message: `Layanan AI menolak input (${err.message})`, details: {} },
        },
        status,
      );
    }
    const timeout = err instanceof Error && err.message.includes('tepat waktu');
    return new ServiceUnavailableException({
      error: {
        code: 'PROVIDER_UNAVAILABLE',
        message: timeout
          ? 'Layanan AI tidak menjawab tepat waktu — koin tidak terpotong, silakan coba lagi'
          : 'Layanan AI sedang tidak bisa dihubungi — koin tidak terpotong, silakan coba lagi',
        details: {},
      },
    });
  }
}
