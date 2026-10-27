import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { type Kysely } from 'kysely';

import { DATABASE, type DB } from '../../infra/kysely';
import { CoinLedgerService } from '../wallet';

/**
 * E11 · Konsol mentor — PRD §7 E11, `PR-04` (Dev B). PRD §10.3 "Mentor".
 *
 * `PR-6`: mentor menyetujui review → reviewer dapat koin, TEPAT SEKALI.
 * `PR-7`: mentor hanya melihat/menyentuh review anggota SQUAD BINAANNYA.
 *
 * ── Koin lahir di sini, bukan di submit ──
 *
 * `POST /reviews/:id` (PR-02) TIDAK menulis koin: yang lahir di sana hanya
 * `weighted_points` (poin LIGA). `earn_review` baru terbit saat mentor
 * menyetujui — itulah yang membuat PRD §6 "Peer review disetujui mentor = 15"
 * benar secara konstruksi, bukan secara kebetulan timing.
 *
 * ── Tepat sekali, tiga lapis ──
 *
 *  1. `mentor_checked` dicek SETELAH `FOR UPDATE` barisnya — dua mentor yang
 *     menekan tombol di squad yang sama tidak bisa dua-duanya lolos.
 *  2. `coin_ledger_ref_uniq (user_id, ref_type, ref_id, entry_type)` (migrasi
 *     010) — index database menolak baris kedua apa pun jalurnya.
 *  3. `CoinLedgerService.write()` memeriksa `findExisting` sebelum menulis.
 *
 * ── Kolom BARU: tidak ada, dan itu disengaja ──
 *
 * `peer_reviews` sudah punya `mentor_checked` + `mentor_delta` sejak 001.
 * Catatan mentor TIDAK disimpan sebagai kolom baru (menambah kolom = migrasi
 * Dev A + perubahan PRD §9) — ia masuk `audit_log.after`, preseden
 * `user-role.service.ts`. Konsekuensinya jujur: v0.1 tidak punya rute membaca
 * catatan kembali; itu tugas terpisah kalau produk memintanya.
 */

/** PRD §6 (baris "Peer review disetujui mentor") — dijaga drift-guard di spec. */
export const KOIN_VALIDASI_REVIEW = 15;

/**
 * Batas panjang catatan mentor. PRD tidak menuliskan angkanya; 500 mengikuti
 * batas `comment` reviewer di `PR-03` supaya dua teks yang berdampingan di
 * konsol tunduk pada aturan yang sama.
 */
export const CATATAN_MAKS = 500;

export interface Keputusan {
  decision: 'approve' | 'reject';
  note?: string;
}

/**
 * Gerbang bentuk body `POST /mentor/reviews/:id/validate`.
 *
 * Dipanggil controller DAN di awal `validate()` — jalur non-HTTP (skrip
 * perbaikan data) tidak boleh bisa melewatinya. Pola yang sama dengan
 * `totalRubrik()` di review.service.
 */
export function validasiKeputusan(decision: unknown, note: unknown): Keputusan {
  if (decision !== 'approve' && decision !== 'reject') {
    throw new BadRequestException({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'decision harus "approve" atau "reject"',
        details: { received: decision === null ? 'null' : typeof decision },
      },
    });
  }

  if (note !== undefined && note !== null && typeof note !== 'string') {
    throw new BadRequestException({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'note harus string',
        details: { received: typeof note },
      },
    });
  }

  const catatan = typeof note === 'string' ? note.trim() : '';
  if (catatan.length > CATATAN_MAKS) {
    throw new BadRequestException({
      error: {
        code: 'VALIDATION_ERROR',
        message: `note maksimal ${CATATAN_MAKS} karakter`,
        details: { received_length: catatan.length },
      },
    });
  }

  // Penolakan tanpa alasan tidak bisa dipelajari reviewer — keputusan produk
  // PR-04, dicatat di laporan: catatan WAJIB saat reject, opsional saat approve.
  if (decision === 'reject' && catatan === '') {
    throw new BadRequestException({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Menolak review wajib menyertakan catatan (note)',
        details: {},
      },
    });
  }

  return catatan === '' ? { decision } : { decision, note: catatan };
}

/** Satu item `GET /mentor/queue` — TANPA identitas penulis (semangat PR-2). */
export interface AntreanMentorItem {
  id: string;
  reviewer_id: string;
  /** Anggota binaan mentor pemanggil — mentor MEMANG melihat ini. */
  reviewer_name: string;
  lesson_id: string;
  lesson_title: string;
  rubric_scores: Record<string, number>;
  comment: string | null;
  weighted_points: number;
  created_at: string;
}

export interface HasilValidasi {
  review_id: string;
  decision: 'approve' | 'reject';
  awarded: boolean;
  coins: number;
  already_validated: boolean;
}

@Injectable()
export class MentorService {
  constructor(
    @Inject(DATABASE) private readonly db: Kysely<DB>,
    private readonly coins: CoinLedgerService,
  ) {}

  /**
   * Antrean validasi milik pemanggil: review yang BELUM dicek mentor dari
   * anggota squad binaannya. Reviewer adalah anggota yang dilatih mentor ini
   * (PR-9: mentor yang menyetel bobot anggotanya) — bukan penulis attempt,
   * yang menurut PR-1 selalu dari squad lain.
   *
   * Superadmin lolos guard `GET /mentor/queue` (ACCESS_MATRIX KONSOL) tetapi
   * bukan `squads.mentor_id` siapa pun → antrean kosong. Itu perilaku yang
   * benar: konsol ini adalah alat kerja mentor, bukan jendela inspeksi admin.
   */
  async queueFor(mentorId: string): Promise<AntreanMentorItem[]> {
    const baris = await this.db
      .selectFrom('peer_reviews as pr')
      .innerJoin('squad_members as sm', (join) =>
        join.onRef('sm.user_id', '=', 'pr.reviewer_id').on('sm.left_at', 'is', null),
      )
      .innerJoin('squads as s', (join) =>
        join.onRef('s.id', '=', 'sm.squad_id').on('s.mentor_id', '=', mentorId),
      )
      // FK peer_reviews→lesson_attempts butuh pasangan (id, attempt_date)
      // yang sama — migrasi 003.
      .innerJoin('lesson_attempts as la', (join) =>
        join.onRef('la.id', '=', 'pr.attempt_id').onRef('la.attempt_date', '=', 'pr.attempt_date'),
      )
      .innerJoin('lessons as l', (join) => join.onRef('l.id', '=', 'la.lesson_id'))
      .innerJoin('users as u', (join) => join.onRef('u.id', '=', 'pr.reviewer_id'))
      .where('pr.mentor_checked', '=', false)
      .orderBy('pr.created_at', 'asc')
      .select([
        'pr.id as id',
        'pr.reviewer_id as reviewer_id',
        'u.display_name as reviewer_name',
        'la.lesson_id as lesson_id',
        'l.title as lesson_title',
        'pr.rubric_scores as rubric_scores',
        'pr.comment as comment',
        'pr.weighted_points as weighted_points',
        'pr.created_at as created_at',
      ])
      .execute();

    return baris.map((b) => ({
      id: b.id,
      reviewer_id: b.reviewer_id,
      reviewer_name: b.reviewer_name,
      lesson_id: b.lesson_id,
      lesson_title: b.lesson_title,
      rubric_scores: (b.rubric_scores ?? {}) as Record<string, number>,
      comment: b.comment,
      weighted_points: b.weighted_points,
      created_at: b.created_at.toISOString(),
    }));
  }

  /**
   * Menyetujui atau menolak satu review. Satu transaksi menulis TIGA hal:
   * ledger koin (hanya approve berpoin), `mentor_checked`, dan `audit_log`.
   */
  async validate(input: {
    mentorId: string;
    reviewId: string;
    decision: unknown;
    note?: unknown;
  }): Promise<HasilValidasi> {
    const keputusan = validasiKeputusan(input.decision, input.note);

    return this.db.transaction().execute(async (trx) => {
      const pr = await trx
        .selectFrom('peer_reviews')
        .selectAll()
        .where('id', '=', input.reviewId)
        .forUpdate()
        .executeTakeFirst();

      if (!pr) {
        throw new NotFoundException({
          error: { code: 'NOT_FOUND', message: 'Review tidak ditemukan', details: {} },
        });
      }

      // Kepemilikan PR-7 di SERVICE (PRD §2.5): guard hanya tahu peran, tidak
      // tahu squad. Reviewer harus anggota AKTIF squad binaan mentor ini.
      const binaan = await trx
        .selectFrom('squad_members as sm')
        .innerJoin('squads as s', 's.id', 'sm.squad_id')
        .where('sm.user_id', '=', pr.reviewer_id)
        .where('sm.left_at', 'is', null)
        .where('s.mentor_id', '=', input.mentorId)
        .select('s.id')
        .executeTakeFirst();

      if (!binaan) {
        throw new ForbiddenException({
          error: {
            code: 'FORBIDDEN_ROLE',
            message: 'Review ini bukan milik anggota squad binaan Anda',
            details: { review_id: pr.id },
          },
        });
      }

      // Mentor tidak boleh memvalidasi review yang DIA TULIS SENDIRI sebagai
      // reviewer (temuan audit PR-04): mentor sah saja menjadi anggota squad
      // (eligibleUsers tidak memfilter peran), jadi tanpa cabang ini dia bisa
      // menyetujui reviewnya sendiri dan mencetak koin ke sakunya — self-award
      // apa pun bentuk datanya ditutup di sini, bukan di penunjukan admin.
      if (pr.reviewer_id === input.mentorId) {
        throw new ForbiddenException({
          error: {
            code: 'FORBIDDEN_ROLE',
            message: 'Review ini Anda tulis sendiri sebagai reviewer',
            details: { review_id: pr.id },
          },
        });
      }

      let awarded = false;
      let coins = 0;

      if (!pr.mentor_checked) {
        // §6: "Maks 5 review BERPOIN/hari" — cap dijalankan reviewer saat
        // submit (weighted_points = 0), jadi validasi review capped menutup
        // tanpa mencetak koin ke-6. Dua mata uang, satu definisi "berpoin".
        if (keputusan.decision === 'approve' && pr.weighted_points > 0) {
          await this.coins.write(trx, {
            userId: pr.reviewer_id,
            entryType: 'earn_review',
            amount: KOIN_VALIDASI_REVIEW,
            refType: 'review',
            refId: pr.id,
            note: keputusan.note,
          });
          awarded = true;
          coins = KOIN_VALIDASI_REVIEW;
        }

        await trx
          .updateTable('peer_reviews')
          .set({ mentor_checked: true })
          .where('id', '=', pr.id)
          .execute();

        await trx
          .insertInto('audit_log')
          .values({
            actor_id: input.mentorId,
            action: 'mentor.review.validate',
            subject_type: 'review',
            subject_id: pr.id,
            before: JSON.stringify({ mentor_checked: false }),
            after: JSON.stringify({
              decision: keputusan.decision,
              note: keputusan.note ?? null,
              coins,
            }),
          })
          .execute();
      }

      // Sudah pernah divalidasi → idempoten: kembalikan keadaan tanpa menulis
      // apa pun. Keputusan pertama FINAL — approve lalu reject tidak mencabut
      // koin (pencabutan, kalau suatu hari diminta, adalah entri `adjust`
      // lewat CoinLedgerService, bukan flag yang di-toggle).
      return {
        review_id: pr.id,
        decision: keputusan.decision,
        awarded,
        coins,
        already_validated: pr.mentor_checked,
      };
    });
  }
}
