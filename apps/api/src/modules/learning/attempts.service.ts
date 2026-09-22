import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { type Kysely, sql } from 'kysely';

import { DATABASE, type DB } from '../../infra/kysely';
import { StreakService } from '../streak';
import { CoinLedgerService, type Trx } from '../wallet';
import { GradingService, type FeedbackItem, type JawabanClient } from './grading.service';

/** PRD §6.1: `coins = max(5, round(base × (0,4 + (score/100) × 0,6)))`. */
export function hitungKoin(baseCoins: number, score: number): number {
  return Math.max(5, Math.round(baseCoins * (0.4 + (score / 100) * 0.6)));
}

/** PRD §6.1: `points = max(1, round(base × (0,5 + score/200)))`. */
export function hitungPoin(basePoints: number, score: number): number {
  return Math.max(1, Math.round(basePoints * (0.5 + score / 200)));
}

/** `kind` streak di kontrak F-08 — berbeda nama dari `StreakResult.kind`. */
export type StreakKindApi = 'extended' | 'reset' | 'unchanged';

export interface AttemptResult {
  attempt_id: string;
  /** `false` = pengulangan latihan hari yang sama. LE-4. */
  rewarded: boolean;
  score: number;
  points: number;
  coins: number;
  balance: number;
  streak: { kind: StreakKindApi; current: number; longest: number; is_new_record: boolean };
  quest: { done_tasks: number; target_tasks: number; completed: boolean };
  feedback: FeedbackItem[];
}

export interface SubmitAttemptInput {
  userId: string;
  lessonId: string;
  answers: JawabanClient[];
  durationMs: number;
  /** LE-8: WAJIB. Dipaksa controller, bukan opsional di sini. */
  idempotencyKey: string;
}

/**
 * `POST /attempts` — `L-03`. Jantung sistem, dan **satu pemilik** (CLAUDE.md
 * §Kepemilikan file).
 *
 * ── Satu transaksi, enam tulisan (LE-6) ──
 *
 * `lesson_attempts` · `streaks` · `coin_ledger` + `users.coin_balance` ·
 * `daily_quests` · `squad_members.weekly_points` · `outbox_events`.
 *
 * Memecahnya adalah cara tercepat menciptakan bug konsistensi yang tidak
 * pernah bisa direproduksi: koin bertambah tanpa poin liga, atau streak maju
 * tanpa attempt yang menyebabkannya.
 *
 * ── TIGA jalan masuk yang berbeda, dan membedakannya yang paling penting ──
 *
 * | Yang datang | Jawaban | Sumber |
 * |---|---|---|
 * | Baru | Enam tulisan, `rewarded: true` | LE-6 |
 * | **Kunci idempotensi SAMA** | Nol tulisan, angka dari attempt yang tersimpan, `rewarded: true` | LE-8 |
 * | Kunci BEDA, lesson & hari sama | Nol tulisan, dinilai ulang, `rewarded: false` | LE-4 / AC-LE-2 |
 *
 * Dua yang terakhir sama-sama "sudah pernah", dan menyamakannya melanggar
 * salah satu aturan. Request yang diulang jaringan (kunci sama) bukan latihan
 * — menjawabnya `rewarded: false` membuat klien mengira hadiahnya hilang.
 * Sebaliknya, latihan sore hari (kunci baru) yang dijawab `rewarded: true`
 * membuat pengguna menunggu koin yang tidak akan datang.
 *
 * ── Yang TIDAK ada di sini, dan itu disengaja ──
 *
 * **Bonus milestone streak** (§6.1: hari ke-3 → 30 koin, dst). Enum
 * `coin_entry` punya `earn_streak` dan tidak ada satu pun kode yang
 * menulisnya — tapi LE-6 menyebut tepat enam tulisan, tidak satu pun aturan
 * `SK-*` menyebut bonus, dan **tidak ada item papan yang memilikinya**.
 * Menambahkannya di sini berarti mengarang jalur uang. Isu #115.
 *
 * **`queue.add()`**. Aturan 10 melarangnya di dalam transaksi, dan di luar
 * transaksi pun belum ada yang bisa dipanggil: worker outbox itu `Q-03`.
 * Barisnya sudah ditulis ke `outbox_events`, dan itu memang perjanjiannya —
 * outbox yang menahan event sampai konsumennya ada, bukan sebaliknya.
 */
@Injectable()
export class AttemptsService {
  constructor(
    @Inject(DATABASE) private readonly db: Kysely<DB>,
    private readonly grading: GradingService,
    private readonly streaks: StreakService,
    private readonly coins: CoinLedgerService,
  ) {}

  async submit(input: SubmitAttemptInput): Promise<AttemptResult> {
    const { userId, lessonId, answers, durationMs, idempotencyKey } = input;

    if (answers.length === 0) {
      throw new BadRequestException({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'answers tidak boleh kosong',
          details: { field: 'answers' },
        },
      });
    }

    return this.db.transaction().execute(async (trx) => {
      const lesson = await trx
        .selectFrom('lessons')
        .select(['id', 'base_points', 'base_coins'])
        .where('id', '=', lessonId)
        .executeTakeFirst();

      if (!lesson) {
        throw new BadRequestException({
          error: {
            code: 'NOT_FOUND',
            message: 'Lesson tidak ditemukan',
            details: { lesson_id: lessonId },
          },
        });
      }

      // Tanggal LOKAL, dihitung Postgres dari `streaks.timezone` — sumber yang
      // SAMA dengan `StreakService`. Memakai `users.timezone` di sini akan
      // benar hari ini (A-05 menjaga keduanya sinkron) dan salah pada hari
      // keduanya sempat berbeda: `attempt_date` dan hari streak akan menunjuk
      // tanggal yang berbeda, dan LE-4 bocor tepat di situ.
      const tgl = await sql<{ today: string }>`
        SELECT to_char((now() AT TIME ZONE s.timezone)::date, 'YYYY-MM-DD') AS today
        FROM streaks s WHERE s.user_id = ${userId}
      `.execute(trx);
      const hariIni = tgl.rows[0]?.today;
      if (!hariIni) {
        // Baris `streaks` dibuat trigger saat registrasi (AU-6, migrasi 005).
        throw new BadRequestException({
          error: {
            code: 'NOT_FOUND',
            message: 'Baris streak tidak ditemukan',
            details: { user_id: userId },
          },
        });
      }

      // Penilaian SELALU dijalankan, di ketiga jalan masuk: ia juga yang
      // memvalidasi `card_id` (422 CARD_NOT_IN_LESSON), dan validasi yang
      // dilewati pada request ulang membuat request rusak terlihat berhasil.
      const nilai = await this.grading.grade(trx, lessonId, answers, durationMs);
      const points = hitungPoin(lesson.base_points, nilai.score);
      const coins = hitungKoin(lesson.base_coins, nilai.score);

      // ── Jalan 2: kunci idempotensi yang sama (LE-8) ────────────────────
      const ulangan = await trx
        .selectFrom('coin_ledger')
        .select(['id', 'balance_after', 'amount'])
        .where('idempotency_key', '=', idempotencyKey)
        .executeTakeFirst();

      if (ulangan) {
        const tersimpan = await trx
          .selectFrom('lesson_attempts')
          .select(['id', 'score', 'points', 'coins'])
          .where('user_id', '=', userId)
          .where('lesson_id', '=', lessonId)
          .where('attempt_date', '=', hariIni)
          .executeTakeFirst();

        return {
          // Angka dari attempt yang TERSIMPAN, bukan dari penilaian barusan:
          // request yang sama harus menjawab hal yang sama.
          attempt_id: tersimpan?.id ?? '',
          rewarded: true,
          score: tersimpan?.score ?? nilai.score,
          points: tersimpan?.points ?? points,
          coins: tersimpan?.coins ?? coins,
          balance: ulangan.balance_after,
          streak: await this.bacaStreak(trx, userId),
          quest: await this.bacaQuest(trx, userId, hariIni),
          feedback: nilai.feedback,
        };
      }

      // ── Jalan 3: sudah pernah hari ini, kunci berbeda (LE-4) ───────────
      const hariIniSudah = await trx
        .selectFrom('lesson_attempts')
        .select('id')
        .where('user_id', '=', userId)
        .where('lesson_id', '=', lessonId)
        .where('attempt_date', '=', hariIni)
        .executeTakeFirst();

      if (hariIniSudah) {
        // "Pengulangan tetap diizinkan untuk latihan, tapi rewarded=false".
        // Nol tulisan: `lesson_attempts_daily_uniq` memang melarang baris
        // kedua, dan AC-LE-2 melarang entri koin maupun kenaikan streak.
        //
        // `score` dan `feedback` dari penilaian BARUSAN — yang ingin dilihat
        // orang yang baru saja berlatih adalah hasil latihannya, bukan
        // hasil paginya. `attempt_id` menunjuk attempt berhadiah hari itu,
        // karena hanya itu baris yang ada.
        return {
          attempt_id: hariIniSudah.id,
          rewarded: false,
          score: nilai.score,
          points: 0,
          coins: 0,
          balance: await this.bacaSaldo(trx, userId),
          streak: await this.bacaStreak(trx, userId),
          quest: await this.bacaQuest(trx, userId, hariIni),
          feedback: nilai.feedback,
        };
      }

      // ── Jalan 1: attempt baru. Enam tulisan, satu transaksi (LE-6) ─────

      // 1 · lesson_attempts
      const attempt = await trx
        .insertInto('lesson_attempts')
        .values({
          user_id: userId,
          lesson_id: lessonId,
          attempt_date: hariIni,
          card_results: JSON.stringify(
            nilai.feedback.map((f) => {
              const j = answers.find((a) => a.card_id === f.card_id);
              return {
                card_id: f.card_id,
                answer: j?.answer ?? null,
                correct: f.correct,
                ms: j?.ms ?? 0,
                ...(nilai.suspiciousDuration ? { fast: true } : {}),
              };
            }),
          ),
          score: nilai.score,
          points,
          coins,
          duration_ms: durationMs,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      // 2 · streaks
      const streak = await this.streaks.recordActivity(trx, userId);

      // 3 · coin_ledger + users.coin_balance (satu panggilan, satu aturan)
      const entry = await this.coins.write(trx, {
        userId,
        entryType: 'earn_lesson',
        amount: coins,
        refType: 'attempt',
        refId: attempt.id,
        idempotencyKey,
      });

      // 4 · daily_quests
      const quest = await this.bumpQuest(trx, userId, hariIni);

      // 5 · squad_members.weekly_points
      await trx
        .updateTable('squad_members')
        .set({ weekly_points: sql`weekly_points + ${points}` })
        .where('user_id', '=', userId)
        .where('left_at', 'is', null)
        .execute();

      // 6 · outbox_events — BUKAN ZINCRBY langsung (aturan 6 & LE-7).
      //     Cache yang berisi poin dari transaksi yang di-rollback lebih
      //     berbahaya daripada cache kosong.
      await trx
        .insertInto('outbox_events')
        .values({
          topic: 'points.awarded',
          payload: JSON.stringify({
            user_id: userId,
            attempt_id: attempt.id,
            lesson_id: lessonId,
            points,
            coins,
            attempt_date: hariIni,
          }),
        })
        .execute();

      return {
        attempt_id: attempt.id,
        rewarded: true,
        score: nilai.score,
        points,
        coins,
        balance: entry.balanceAfter,
        streak: {
          kind: petaKind(streak.kind),
          current: streak.current,
          longest: streak.longest,
          is_new_record: streak.isNewRecord,
        },
        quest,
        feedback: nilai.feedback,
      };
    });
  }

  // ── pembacaan untuk jalur yang TIDAK menulis ─────────────────────────────

  private async bacaSaldo(trx: Trx, userId: string): Promise<number> {
    const r = await trx
      .selectFrom('users')
      .select('coin_balance')
      .where('id', '=', userId)
      .executeTakeFirst();
    return r?.coin_balance ?? 0;
  }

  private async bacaStreak(trx: Trx, userId: string): Promise<AttemptResult['streak']> {
    const r = await trx
      .selectFrom('streaks')
      .select(['current_streak', 'longest_streak'])
      .where('user_id', '=', userId)
      .executeTakeFirst();
    return {
      // `unchanged` karena request ini memang tidak mengubahnya — bukan
      // tebakan soal apa yang terjadi di request pertama.
      kind: 'unchanged',
      current: r?.current_streak ?? 0,
      longest: r?.longest_streak ?? 0,
      is_new_record: false,
    };
  }

  private async bacaQuest(
    trx: Trx,
    userId: string,
    tanggal: string,
  ): Promise<AttemptResult['quest']> {
    const r = await trx
      .selectFrom('daily_quests')
      .select(['target_tasks', 'done_tasks', 'completed_at'])
      .where('user_id', '=', userId)
      .where('quest_date', '=', tanggal)
      .executeTakeFirst();

    return {
      done_tasks: r?.done_tasks ?? 0,
      target_tasks: r?.target_tasks ?? DEFAULT_TARGET_TASKS,
      completed: r?.completed_at != null,
    };
  }

  /**
   * Menaikkan progres quest hari ini, membuat barisnya kalau belum ada.
   *
   * `completed_at` diset di query yang SAMA, dari nilai `done_tasks` yang baru
   * — bukan dibaca ulang lalu ditulis. Baca-lalu-tulis di sini membuka jendela
   * di mana dua attempt bersamaan sama-sama melihat "belum selesai".
   */
  private async bumpQuest(
    trx: Trx,
    userId: string,
    tanggal: string,
  ): Promise<AttemptResult['quest']> {
    const r = await trx
      .insertInto('daily_quests')
      .values({ user_id: userId, quest_date: tanggal, done_tasks: 1 })
      .onConflict((oc) =>
        oc.columns(['user_id', 'quest_date']).doUpdateSet({
          done_tasks: sql`daily_quests.done_tasks + 1`,
          completed_at: sql`CASE
            WHEN daily_quests.completed_at IS NOT NULL THEN daily_quests.completed_at
            WHEN daily_quests.done_tasks + 1 >= daily_quests.target_tasks THEN now()
            ELSE NULL END`,
        }),
      )
      .returning(['target_tasks', 'done_tasks', 'completed_at'])
      .executeTakeFirstOrThrow();

    return {
      done_tasks: r.done_tasks,
      target_tasks: r.target_tasks,
      completed: r.completed_at != null,
    };
  }
}

/** Target bawaan kolom `daily_quests.target_tasks` — PRD §3: 3 micro-task. */
const DEFAULT_TARGET_TASKS = 3;

/**
 * `StreakResult.kind` (internal) → `kind` di kontrak F-08.
 *
 * Dua kosakata untuk satu hal, dan itu bukan kelalaian: `restarted` menjelaskan
 * apa yang terjadi pada streak-nya, `reset` menjelaskan apa yang dilihat
 * pengguna. Pemetaannya ditulis sekali di sini supaya tidak ada yang menebak
 * di tempat kedua.
 */
function petaKind(kind: 'already_active' | 'extended' | 'restarted'): StreakKindApi {
  if (kind === 'extended') return 'extended';
  if (kind === 'restarted') return 'reset';
  return 'unchanged';
}
