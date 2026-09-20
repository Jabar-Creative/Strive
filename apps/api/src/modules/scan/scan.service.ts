import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { type Kysely, sql } from 'kysely';

import { DATABASE, type DB } from '../../infra/kysely';
import { CoinLedgerService, InsufficientCoinsError, type Trx } from '../wallet';
import { PricingConfigService } from '../payment';
import { DocumentUploadService, type UploadedDocument } from './document-upload.service';

/** KL-8: hold yang menggantung lebih lama dari ini dilepas reaper. */
export const STALE_HOLD_MINUTES = 30;

/**
 * Vendor pertama — PRD §5 Q7, dan sama dengan DEFAULT kolom
 * `plagiarism_scans.provider`.
 *
 * Konstanta, BUKAN kolom `pricing_config`: harga bisa berubah tiap minggu
 * lewat `SA-02`, vendor tidak. Menaruhnya di tabel harga akan membuat
 * penggantian vendor terlihat seperti perubahan harga — dan dedup (KL-3)
 * berkunci `(hash, provider)`, jadi menggantinya berarti seluruh cache
 * kedaluwarsa sekaligus. Itu keputusan yang pantas lewat migrasi dan mata
 * manusia, bukan lewat formulir Retool.
 */
export const PROVIDER_DEFAULT = 'copyleaks';

/** Status yang masih menahan koin. `done`/`failed`/`released` sudah selesai. */
const STATUS_MENGGANTUNG = ['queued', 'running'] as const;

export interface SubmitScanInput {
  userId: string;
  document: UploadedDocument;
  /** Wajib untuk `POST /scans` (PRD §10.3 ⚡). Diteruskan ke ledger. */
  idempotencyKey: string;
}

export interface SubmitScanResult {
  scanId: string;
  status: 'queued' | 'done';
  costCoins: number;
  /**
   * `false` pada cache hit — **vendor tidak boleh dipanggil** (KL-3).
   *
   * Bukan sekadar petunjuk: pada cache hit `status` sudah `done`, jadi tidak
   * ada pekerjaan yang tersisa untuk dikerjakan worker. Bendera ini ada supaya
   * pemanggil tidak perlu menyimpulkannya dari status.
   */
  needsVendor: boolean;
  /** Diisi pada cache hit — scan asal yang hasilnya disalin. */
  cachedFrom?: string;
  similarityScore?: number;
}

export interface ReaperResult {
  released: string[];
  coinsReturned: number;
}

/**
 * Klinik plagiarisme, jalur uangnya — `K-02`, PRD §7 E7 `KL-3` … `KL-9`.
 *
 * ── Urutan di `submit()` adalah keseluruhan itemnya ──
 *
 *   1. dokumen divalidasi + di-hash + disimpan   (K-01, DI LUAR transaksi)
 *   2. TRANSAKSI:
 *        a. dedup: hash+provider pernah `done`?  -> salin, tarif cache, SELESAI
 *        b. kalau tidak: hold penuh, baris scan `queued`
 *   3. enqueue — SETELAH commit, oleh PEMANGGIL
 *
 * **Upload di luar transaksi, sengaja.** Mengunggah 25 MB ke object storage
 * bisa memakan detik; menahan transaksi Postgres selama itu berarti menahan
 * kunci baris `users` si pengguna selama itu juga. Kalau transaksinya gagal
 * setelah upload, yang tertinggal adalah objek yatim di bucket — murah, dan
 * dibersihkan oleh kunci berbasis hash (dokumen yang sama menimpa dirinya
 * sendiri). Kebalikannya tidak murah.
 *
 * **`queue.add()` TIDAK di sini** (aturan keras 10). Service ini hanya
 * menyatakan `needsVendor`; yang mengantre adalah pemanggil, setelah commit.
 * Job yang berjalan sebelum commit akan membaca baris scan yang belum ada.
 *
 * ── Kenapa reaper, padahal sudah ada release di jalur gagal ──
 *
 * Jalur gagal hanya menyelamatkan kegagalan yang SEMPAT DILIHAT prosesnya.
 * Worker yang dimatikan paksa di tengah jalan tidak sempat melihat apa pun —
 * dan koin pengguna tertahan selamanya. AC item ini menyebutnya harfiah.
 */
@Injectable()
export class ScanService {
  private readonly logger = new Logger(ScanService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Kysely<DB>,
    private readonly upload: DocumentUploadService,
    private readonly coins: CoinLedgerService,
    private readonly pricing: PricingConfigService,
  ) {}

  async submit(input: SubmitScanInput): Promise<SubmitScanResult> {
    // 1 · DI LUAR transaksi. Lihat catatan kelas.
    const doc = await this.upload.accept(input.document);

    const harga = await this.pricing.getCurrentVersion();
    if (!harga) {
      throw new ConflictException({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Belum ada pricing_config aktif — jalankan `pnpm seed`',
          details: {},
        },
      });
    }

    return this.db.transaction().execute(async (trx) => {
      // Kunci baris pengguna DULU. Dua unggahan bersamaan dari orang yang sama
      // akan sama-sama membaca "belum ada hold" dan sama-sama menahan koin.
      await trx
        .selectFrom('users')
        .select('id')
        .where('id', '=', input.userId)
        .forUpdate()
        .executeTakeFirst();

      // 2a · Dedup (KL-3). Yang dicari scan `done` dengan hash DAN provider
      // yang sama — hasil dari vendor lain tidak bisa disalin, karena skornya
      // dihitung dengan indeks yang berbeda.
      const asal = await trx
        .selectFrom('plagiarism_scans')
        .select(['id', 'similarity_score', 'report_key', 'word_count', 'provider_scan_id'])
        .where('document_sha256', '=', doc.sha256)
        .where('provider', '=', PROVIDER_DEFAULT)
        .where('status', '=', 'done')
        .orderBy('completed_at', 'asc')
        .executeTakeFirst();

      if (asal) return this.salinDariCache(trx, input, doc, harga, asal);

      // 2b · Jalur normal: hold PENUH sebelum apa pun dienqueue (KL-5).
      const scan = await trx
        .insertInto('plagiarism_scans')
        .values({
          user_id: input.userId,
          document_sha256: doc.sha256,
          document_key: doc.key,
          filename: input.document.filename,
          provider: PROVIDER_DEFAULT,
          status: 'queued',
          cost_coins: harga.scan_cost_coins,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      let hold;
      try {
        hold = await this.coins.hold(trx, {
          userId: input.userId,
          amount: harga.scan_cost_coins,
          refType: 'scan',
          refId: scan.id,
          idempotencyKey: input.idempotencyKey,
          note: `scan ${doc.sha256.slice(0, 12)}`,
        });
      } catch (e) {
        // Saldo kurang: seluruh transaksi di-rollback, termasuk baris scan.
        // KL-5 berbunyi "kalau saldo kurang, job tidak pernah dibuat" — dan
        // yang menjaminnya rollback, bukan urutan pemanggilan.
        if (e instanceof InsufficientCoinsError) throw e;
        throw e;
      }

      await trx
        .updateTable('plagiarism_scans')
        .set({ hold_ledger_id: Number(hold.id) })
        .where('id', '=', scan.id)
        .execute();

      return {
        scanId: scan.id,
        status: 'queued' as const,
        costCoins: harga.scan_cost_coins,
        needsVendor: true,
      };
    });
  }

  /**
   * Hasil vendor masuk — `settle` hold, scan jadi `done` (KL-4, KL-9).
   *
   * Cache dedup "diisi" oleh baris ini sendiri: ia baru bisa jadi sumber salin
   * setelah `status='done'`, dan itu baru terjadi di sini. KL-9 terpenuhi
   * tanpa tabel cache terpisah.
   */
  async complete(
    scanId: string,
    hasil: {
      providerScanId: string;
      similarityScore: number;
      reportKey: string;
      wordCount: number;
    },
  ): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      const scan = await this.ambilUntukUpdate(trx, scanId);
      if (scan.status === 'done') return; // webhook dikirim dua kali — no-op

      // Hasil yang tiba SETELAH koinnya dilepas.
      //
      // Nyata, dan jalurnya persis AC item ini: reaper melepas hold pada menit
      // ke-30, vendor menjawab pada menit ke-31. `coins.settle()` MELEMPAR di
      // keadaan ini — sengaja, karena dua jalur mengklaim hold yang sama.
      //
      // Tapi melempar dari sini mengubah anomali jadi galat 500 dan MEMBUANG
      // hasil yang vendornya sudah kita bayar. Yang benar: simpan hasilnya
      // sebagai bukti, jangan sentuh uangnya, dan berisik.
      //
      // Statusnya sengaja TIDAK diubah jadi `done`: `done` berarti dua hal
      // yang keduanya tidak benar di sini — bahwa penggunanya membayar, dan
      // bahwa baris ini layak jadi sumber dedup dengan tarif diskon.
      if (!STATUS_MENGGANTUNG.includes(scan.status as 'queued' | 'running')) {
        await trx
          .updateTable('plagiarism_scans')
          .set({
            provider_scan_id: hasil.providerScanId,
            similarity_score: String(hasil.similarityScore),
            report_key: hasil.reportKey,
            word_count: hasil.wordCount,
            error_message: `hasil tiba setelah status '${scan.status}' — koin TIDAK ditagih`,
          })
          .where('id', '=', scanId)
          .execute();

        this.logger.error(
          `Hasil scan ${scanId} tiba setelah statusnya '${scan.status}'. Vendor sudah ` +
            `dibayar, pengguna TIDAK ditagih. Kalau ini sering terjadi, ambang reaper ` +
            `(${STALE_HOLD_MINUTES} menit) lebih pendek daripada waktu jawab vendor.`,
        );
        return;
      }

      await this.coins.settle(trx, {
        userId: scan.user_id,
        refType: 'scan',
        refId: scanId,
        note: 'hasil scan diterima',
      });

      await trx
        .updateTable('plagiarism_scans')
        .set({
          status: 'done',
          provider_scan_id: hasil.providerScanId,
          similarity_score: String(hasil.similarityScore),
          report_key: hasil.reportKey,
          word_count: hasil.wordCount,
          completed_at: sql`now()`,
        })
        .where('id', '=', scanId)
        .execute();
    });
  }

  /** Vendor gagal / timeout — koin KEMBALI PENUH (KL-7). */
  async fail(scanId: string, reason: string): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      const scan = await this.ambilUntukUpdate(trx, scanId);
      if (!STATUS_MENGGANTUNG.includes(scan.status as 'queued' | 'running')) return;

      await this.coins.release(trx, {
        userId: scan.user_id,
        refType: 'scan',
        refId: scanId,
        reason,
      });

      await trx
        .updateTable('plagiarism_scans')
        .set({ status: 'failed', error_message: reason, completed_at: sql`now()` })
        .where('id', '=', scanId)
        .execute();
    });
  }

  /**
   * **Reaper (KL-8).** Melepas hold yang menggantung lebih dari 30 menit.
   *
   * Ini yang menjawab AC item ini: *"worker dimatikan paksa di tengah jalan →
   * koin kembali otomatis dalam ≤30 menit"*. Jalur `fail()` di atas hanya
   * menyelamatkan kegagalan yang sempat DILIHAT prosesnya; worker yang mati
   * mendadak tidak sempat melihat apa pun.
   *
   * Satu transaksi PER SCAN, bukan satu untuk semuanya: satu scan yang
   * bermasalah tidak boleh menggagalkan pelepasan koin pengguna lain.
   */
  async releaseStale(): Promise<ReaperResult> {
    const menggantung = await this.db
      .selectFrom('plagiarism_scans')
      .select(['id', 'user_id', 'cost_coins'])
      .where('status', 'in', [...STATUS_MENGGANTUNG])
      .where(
        sql<boolean>`created_at < now() - ${sql.lit(STALE_HOLD_MINUTES)} * interval '1 minute'`,
      )
      .execute();

    const released: string[] = [];
    let coinsReturned = 0;

    for (const s of menggantung) {
      try {
        await this.db.transaction().execute(async (trx) => {
          const scan = await this.ambilUntukUpdate(trx, s.id);
          // Diperiksa ULANG di dalam transaksi: antara SELECT di atas dan
          // kunci di sini, webhook-nya bisa saja tiba.
          if (!STATUS_MENGGANTUNG.includes(scan.status as 'queued' | 'running')) return;

          const entri = await this.coins.release(trx, {
            userId: scan.user_id,
            refType: 'scan',
            refId: s.id,
            reason: `hold menggantung > ${STALE_HOLD_MINUTES} menit`,
          });

          await trx
            .updateTable('plagiarism_scans')
            .set({
              status: 'released',
              error_message: `dilepas reaper setelah ${STALE_HOLD_MINUTES} menit`,
              completed_at: sql`now()`,
            })
            .where('id', '=', s.id)
            .execute();

          released.push(s.id);
          coinsReturned += entri?.amount ?? 0;
        });
      } catch (e) {
        // Satu scan gagal tidak boleh menghentikan sisanya. Dicatat `error`:
        // koin pengguna tertahan, dan itu selalu pantas dilihat orang.
        this.logger.error(
          `Reaper gagal melepas scan ${s.id}: ${e instanceof Error ? e.message : String(e)}. ` +
            `Koin pengguna ${s.user_id} masih tertahan.`,
        );
      }
    }

    if (released.length > 0) {
      this.logger.warn(
        `Reaper melepas ${released.length} hold menggantung (${coinsReturned} koin kembali). ` +
          `Hold yang menggantung berarti ada worker yang mati atau vendor yang diam — periksa.`,
      );
    }
    return { released, coinsReturned };
  }

  // ── internal ──────────────────────────────────────────────────────────

  /** Cache hit: tarif diskon, hasil disalin, **vendor tidak disentuh** (KL-3). */
  private async salinDariCache(
    trx: Trx,
    input: SubmitScanInput,
    doc: { sha256: string; key: string },
    harga: { scan_cached_cost_coins: number },
    asal: {
      id: string;
      similarity_score: string | null;
      report_key: string | null;
      word_count: number | null;
      provider_scan_id: string | null;
    },
  ): Promise<SubmitScanResult> {
    const scan = await trx
      .insertInto('plagiarism_scans')
      .values({
        user_id: input.userId,
        document_sha256: doc.sha256,
        document_key: doc.key,
        filename: input.document.filename,
        provider: PROVIDER_DEFAULT,
        provider_scan_id: asal.provider_scan_id,
        status: 'done',
        cost_coins: harga.scan_cached_cost_coins,
        cached_from: asal.id,
        similarity_score: asal.similarity_score,
        report_key: asal.report_key,
        word_count: asal.word_count,
        completed_at: sql`now()`,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    // `spend_scan`, BUKAN hold+settle. Tidak ada yang bisa gagal setelah ini —
    // hasilnya sudah ada di baris yang barusan disalin. Hold untuk pekerjaan
    // yang sudah selesai adalah dua penulisan untuk satu kejadian.
    await this.coins.write(trx, {
      userId: input.userId,
      entryType: 'spend_scan',
      amount: -harga.scan_cached_cost_coins,
      refType: 'scan',
      refId: scan.id,
      idempotencyKey: input.idempotencyKey,
      note: `cache hit dari ${asal.id}`,
    });

    return {
      scanId: scan.id,
      status: 'done',
      costCoins: harga.scan_cached_cost_coins,
      needsVendor: false,
      cachedFrom: asal.id,
      ...(asal.similarity_score !== null ? { similarityScore: Number(asal.similarity_score) } : {}),
    };
  }

  private async ambilUntukUpdate(trx: Trx, scanId: string) {
    const scan = await trx
      .selectFrom('plagiarism_scans')
      .select(['id', 'user_id', 'status', 'cost_coins'])
      .where('id', '=', scanId)
      .forUpdate()
      .executeTakeFirst();

    if (!scan) throw new Error(`Scan ${scanId} tidak ditemukan`);
    return scan;
  }
}
