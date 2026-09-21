import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Kysely } from 'kysely';

import {
  type HistoryPage,
  clampLimit,
  decodeCursor,
  potongHalaman,
  setelahCursor,
  waktuCursor,
} from '../../common/cursor';
import { DATABASE, type DB } from '../../infra/kysely';
import { StorageService, bucketDocuments } from '../../infra/storage';

const PREFIX_PROMPT = 'pl';

export interface CvResult {
  id: string;
  job_id: string | null;
  structured: unknown;
  ats_score: number | null;
  ats_findings: unknown;
  /** URL bertanda tangan 15 menit, atau `null` kalau PDF-nya belum ada. */
  pdf_url: string | null;
  created_at: Date;
}

export interface PromptRunItem {
  id: string;
  job_id: string | null;
  structure: unknown;
  output: string | null;
  self_rating: number | null;
  created_at: Date;
}

/**
 * `GET /career/cv/:id` + `GET /career/prompt-lab/history` — `F-14` (isu #88),
 * PRD §10.3.
 *
 * ── Modul ini BACA saja ──
 *
 * `POST /career/cv` dan `POST /career/prompt-lab/run` bukan milik `F-14`;
 * keduanya membuat `ai_jobs` dan itu item `AI-06`. Aturan 8 tetap berlaku
 * penuh: tidak ada satu pun pemanggilan LLM di sini, dan tidak akan ada.
 *
 * ── Kenapa baris yang belum ada penulisnya tetap dibangun sekarang ──
 *
 * `cv_documents` dan `prompt_runs` sudah ada di migrasi 001 dengan bentuk yang
 * dikunci PRD §9. Yang belum ada penulisnya (`AI-03`, `PL-02`, milik Dev B),
 * dan itu membuat test rute ini memakai baris yang disemai langsung — bukan
 * baris hasil alur sungguhan. Yang DIBUKTIKAN di sini kepemilikan dan
 * pagination, dan keduanya tidak bergantung pada siapa yang menulis barisnya.
 */
@Injectable()
export class CareerReadService {
  constructor(
    @Inject(DATABASE) private readonly db: Kysely<DB>,
    private readonly storage: StorageService,
  ) {}

  /**
   * Satu hasil CV MILIK pemanggil.
   *
   * `user_id` masuk ke WHERE. Dokumen orang lain dan dokumen yang tidak ada
   * menjawab IDENTIK — membedakannya memberi tahu penebak bahwa id itu nyata.
   */
  async cvById(userId: string, cvId: string): Promise<CvResult> {
    const row = await this.db
      .selectFrom('cv_documents')
      .select(['id', 'job_id', 'structured', 'ats_score', 'ats_findings', 'pdf_key', 'created_at'])
      .where('id', '=', cvId)
      .where('user_id', '=', userId)
      .executeTakeFirst();

    if (!row) {
      throw new NotFoundException({
        error: { code: 'NOT_FOUND', message: 'Dokumen CV tidak ditemukan', details: { id: cvId } },
      });
    }

    return {
      id: row.id,
      job_id: row.job_id,
      structured: row.structured,
      ats_score: row.ats_score,
      ats_findings: row.ats_findings,
      // Ditandatangani SETELAH kepemilikan terbukti. Urutan sebaliknya
      // menghasilkan URL yang sah untuk berkas yang bukan miliknya — dan URL
      // itu tetap berlaku 15 menit walau request-nya dijawab 404.
      pdf_url: row.pdf_key
        ? await this.storage.signedDownloadUrl(bucketDocuments(), row.pdf_key)
        : null,
      created_at: row.created_at,
    };
  }

  async promptHistory(
    userId: string,
    opts: { cursor?: string | undefined; limit?: unknown } = {},
  ): Promise<HistoryPage<PromptRunItem>> {
    const limit = clampLimit(opts.limit);

    let q = this.db
      .selectFrom('prompt_runs')
      .select([
        'id',
        'job_id',
        'structure',
        'output',
        'self_rating',
        'created_at',
        waktuCursor('created_at').as('cursor_ts'),
      ])
      .where('user_id', '=', userId)
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(limit + 1);

    if (opts.cursor) {
      q = q.where(setelahCursor('created_at', 'id', decodeCursor(PREFIX_PROMPT, opts.cursor)));
    }

    return potongHalaman(await q.execute(), limit, PREFIX_PROMPT, (row) => ({
      id: row.id,
      job_id: row.job_id,
      structure: row.structure,
      output: row.output,
      self_rating: row.self_rating,
      created_at: row.created_at,
    }));
  }
}
