import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Kysely } from 'kysely';

import { DATABASE, type DB } from '../../infra/kysely';

export type MasteryKind = 'interview' | 'statement';
export type MasteryTarget = 'chevening' | 'lpdp' | 'fulbright';

/** Satu giliran tanya-jawab. Disimpan apa adanya di `turns` (JSONB). */
export interface MasteryTurn {
  role: 'question' | 'answer';
  text: string;
  /** ISO 8601 — dibentuk server, tidak pernah dari klien. */
  at: string;
}

export interface MasterySession {
  id: string;
  kind: MasteryKind;
  target: string | null;
  turns: MasteryTurn[];
  feedback: unknown;
  status: string;
  created_at: string;
}

/**
 * Mastery Track — PRD §7 E12, item `MT-01`.
 *
 * ── Dua janji yang membentuk berkas ini ──
 *
 * **1 · Seluruh giliran tanya-jawab disimpan sebagai JSONB** (AC harfiah).
 * Bukan tabel `turns` terpisah: satu sesi selalu dibaca utuh, tidak pernah
 * satu giliran saja, dan tidak ada query yang memfilter per-giliran. Tabel
 * terpisah akan menambah join tanpa menambah kemampuan apa pun.
 *
 * **2 · Pengguna hanya bisa membaca sesinya sendiri** (AC harfiah). Itu
 * KEPEMILIKAN, bukan peran — jadi ditegakkan di service, bukan di guard
 * (PRD §2.5). Setiap method di bawah menerima `userId` dan menyaring dengan
 * itu; tidak ada satu pun yang menerima id sesi saja.
 *
 * Yang TIDAK ada di sini: pemanggilan LLM. Node tidak pernah memanggil LLM
 * langsung (aturan 8) — umpan balik AI datang lewat `ai_jobs` + AI service,
 * dan itu item `MT-02`.
 */
@Injectable()
export class MasteryService {
  constructor(@Inject(DATABASE) private readonly db: Kysely<DB>) {}

  async create(userId: string, kind: MasteryKind, target?: string): Promise<MasterySession> {
    const row = await this.db
      .insertInto('mastery_sessions')
      .values({ user_id: userId, kind, target: target ?? null, turns: JSON.stringify([]) })
      .returningAll()
      .executeTakeFirstOrThrow();
    return serialize(row);
  }

  /**
   * Satu sesi MILIK pengguna itu.
   *
   * `user_id` masuk ke WHERE, bukan diperiksa setelah baris diambil. Bedanya
   * penting: mengambil dulu lalu membandingkan berarti barisnya sempat ada di
   * memori proses, dan satu `return` yang lupa akan membocorkannya.
   */
  async byId(userId: string, sessionId: string): Promise<MasterySession> {
    const row = await this.db
      .selectFrom('mastery_sessions')
      .selectAll()
      .where('id', '=', sessionId)
      .where('user_id', '=', userId)
      .executeTakeFirst();

    // Sesi milik orang lain dan sesi yang tidak ada menghasilkan jawaban yang
    // SAMA. Membedakannya memberi tahu penebak bahwa id itu nyata.
    if (!row) {
      throw new NotFoundException({
        error: { code: 'NOT_FOUND', message: 'Sesi tidak ditemukan', details: { sessionId } },
      });
    }
    return serialize(row);
  }

  async listFor(userId: string): Promise<MasterySession[]> {
    const rows = await this.db
      .selectFrom('mastery_sessions')
      .selectAll()
      .where('user_id', '=', userId)
      .orderBy('created_at', 'desc')
      .execute();
    return rows.map(serialize);
  }

  /**
   * Menambah satu giliran.
   *
   * `jsonb ||` di database, bukan baca-ubah-tulis di Node: dua giliran yang
   * ditambahkan bersamaan akan saling menimpa kalau array-nya dirakit di
   * memori, dan yang hilang adalah jawaban pengguna.
   */
  async appendTurn(
    userId: string,
    sessionId: string,
    turn: Omit<MasteryTurn, 'at'>,
  ): Promise<MasterySession> {
    await this.byId(userId, sessionId); // memastikan kepemilikan sebelum menulis

    const row = await this.db
      .updateTable('mastery_sessions')
      .set((eb) => ({
        turns: eb.fn('jsonb_insert', [
          'turns',
          eb.val('{-1}'),
          // `at` dibentuk SERVER. Waktu dari klien bisa dipalsukan, dan urutan
          // giliran adalah satu-satunya hal yang membuat transkrip berarti.
          eb.val(JSON.stringify({ ...turn, at: new Date().toISOString() })),
          eb.val(true),
        ]) as never,
      }))
      .where('id', '=', sessionId)
      .where('user_id', '=', userId)
      .returningAll()
      .executeTakeFirstOrThrow();

    return serialize(row);
  }

  /** Menandai sesi siap dinilai. `MT-02` yang mengirimkannya ke AI service. */
  async submit(userId: string, sessionId: string): Promise<MasterySession> {
    const sesi = await this.byId(userId, sessionId);
    if (sesi.status !== 'draft') {
      throw new ForbiddenException({
        error: {
          code: 'ALREADY_PURCHASED',
          message: 'Sesi ini sudah dikirim',
          details: { status: sesi.status },
        },
      });
    }

    const row = await this.db
      .updateTable('mastery_sessions')
      .set({ status: 'submitted' })
      .where('id', '=', sessionId)
      .where('user_id', '=', userId)
      .returningAll()
      .executeTakeFirstOrThrow();
    return serialize(row);
  }
}

function serialize(row: {
  id: string;
  kind: string;
  target: string | null;
  turns: unknown;
  feedback: unknown;
  status: string;
  created_at: Date;
}): MasterySession {
  return {
    id: row.id,
    kind: row.kind as MasteryKind,
    target: row.target,
    turns: (row.turns ?? []) as MasteryTurn[],
    feedback: row.feedback,
    status: row.status,
    created_at: row.created_at.toISOString(),
  };
}
