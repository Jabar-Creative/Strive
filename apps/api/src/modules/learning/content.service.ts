import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import { DATABASE, type Database } from '../../infra/kysely';
import { stripAnswerKeys } from './content.serializer';
import type { LessonCards, ModuleDetail, TrackDetail, TrackSummary } from './content.types';

/**
 * Kode error untuk sumber daya yang tidak ada.
 *
 * TIDAK ADA di daftar 16 kode standar `docs/PRD.md` §10.2, dan itu celah di
 * PRD — tiga rute di §10.3 (`GET /tracks/:id`, `GET /lessons/:id/cards`,
 * `GET /scans/:id`) jelas membutuhkannya. Dipakai di sini karena tidak ada
 * kode lain yang muat, dan dicatat terang-terangan alih-alih diam-diam
 * menciptakan kontrak baru. Lihat isu yang menyertai PR ini.
 *
 * Begitu §10.2 diperbarui, `API_ERROR_CODES` di packages/contracts (milik
 * Dev B, item F-08) ikut ditambah dan konstanta ini diganti dengan yang
 * di sana.
 */
const NOT_FOUND = 'NOT_FOUND';

/** Progres = lesson yang PERNAH diselesaikan / total lesson (LE-9). */
function progress(completedLessons: number, totalLessons: number) {
  return {
    completedLessons,
    totalLessons,
    percent: totalLessons === 0 ? 0 : Math.round((completedLessons / totalLessons) * 100),
  };
}

@Injectable()
export class ContentService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Daftar track yang diterbitkan, dengan progres pengguna.
   *
   * Progres dihitung dari lesson DISTINCT yang pernah muncul di
   * `lesson_attempts` — bukan jumlah attempt (LE-9). Mengulang lesson yang
   * sama sepuluh kali tidak menaikkan progres, dan itu memang yang diinginkan:
   * pengulangan diizinkan untuk latihan (LE-4).
   */
  async listTracks(userId: string): Promise<TrackSummary[]> {
    const tracks = await this.db
      .selectFrom('tracks')
      .selectAll()
      .where('is_published', '=', true)
      .orderBy('sort_order')
      .orderBy('title')
      .execute();

    if (tracks.length === 0) return [];

    const trackIds = tracks.map((t) => t.id);
    const [totals, completed] = await Promise.all([
      this.lessonTotalsByTrack(trackIds),
      this.completedLessonsByTrack(userId, trackIds),
    ]);

    return tracks.map((t) => ({
      id: t.id,
      slug: t.slug,
      title: t.title,
      description: t.description,
      category: t.category,
      sortOrder: t.sort_order,
      progress: progress(completed.get(t.id) ?? 0, totals.get(t.id) ?? 0),
    }));
  }

  /** Satu track dengan modul, lesson, dan progres per modul. */
  async getTrack(userId: string, trackId: string): Promise<TrackDetail> {
    const track = await this.db
      .selectFrom('tracks')
      .selectAll()
      .where('id', '=', trackId)
      .where('is_published', '=', true)
      .executeTakeFirst();

    // Track yang belum diterbitkan diperlakukan sama dengan yang tidak ada:
    // membedakan keduanya memberi tahu penebak bahwa id-nya benar.
    if (!track) {
      throw new NotFoundException({
        error: { code: NOT_FOUND, message: 'Track tidak ditemukan' },
      });
    }

    const modules = await this.db
      .selectFrom('modules')
      .selectAll()
      .where('track_id', '=', trackId)
      .orderBy('sort_order')
      .execute();

    const lessons = modules.length
      ? await this.db
          .selectFrom('lessons')
          .leftJoin('lesson_cards', 'lesson_cards.lesson_id', 'lessons.id')
          .select((eb) => [
            'lessons.id',
            'lessons.module_id',
            'lessons.title',
            'lessons.est_seconds',
            'lessons.base_points',
            'lessons.base_coins',
            'lessons.sort_order',
            eb.fn.count<string>('lesson_cards.id').as('card_count'),
          ])
          .where(
            'lessons.module_id',
            'in',
            modules.map((m) => m.id),
          )
          .groupBy('lessons.id')
          .orderBy('lessons.sort_order')
          .execute()
      : [];

    const completedIds = await this.completedLessonIds(
      userId,
      lessons.map((l) => l.id),
    );

    const detail: ModuleDetail[] = modules.map((m) => {
      const own = lessons.filter((l) => l.module_id === m.id);
      const done = own.filter((l) => completedIds.has(l.id)).length;
      return {
        id: m.id,
        title: m.title,
        sortOrder: m.sort_order,
        lessons: own.map((l) => ({
          id: l.id,
          title: l.title,
          estSeconds: l.est_seconds,
          basePoints: l.base_points,
          baseCoins: l.base_coins,
          sortOrder: l.sort_order,
          cardCount: Number(l.card_count),
          completed: completedIds.has(l.id),
        })),
        progress: progress(done, own.length),
      };
    });

    return {
      id: track.id,
      slug: track.slug,
      title: track.title,
      description: track.description,
      category: track.category,
      sortOrder: track.sort_order,
      modules: detail,
      progress: progress(completedIds.size, lessons.length),
    };
  }

  /**
   * Kartu sebuah lesson, KUNCI JAWABAN SUDAH DIBUANG (LE-3).
   *
   * `stripAnswerKeys` dipanggil di sini — satu tempat, bukan di controller —
   * supaya tidak ada jalur lain yang bisa mengembalikan baris mentah. Kalau
   * suatu saat ada pemanggil kedua, ia mendapat data yang sudah bersih tanpa
   * harus ingat memanggilnya.
   */
  async getLessonCards(lessonId: string): Promise<LessonCards> {
    const lesson = await this.db
      .selectFrom('lessons')
      .select(['id', 'title', 'est_seconds'])
      .where('id', '=', lessonId)
      .executeTakeFirst();

    if (!lesson) {
      throw new NotFoundException({
        error: { code: NOT_FOUND, message: 'Lesson tidak ditemukan' },
      });
    }

    const cards = await this.db
      .selectFrom('lesson_cards')
      .select(['id', 'kind', 'prompt', 'content', 'sort_order'])
      .where('lesson_id', '=', lessonId)
      .orderBy('sort_order')
      .execute();

    return {
      lessonId: lesson.id,
      title: lesson.title,
      estSeconds: lesson.est_seconds,
      cards: cards.map((c) => ({
        id: c.id,
        kind: c.kind,
        prompt: c.prompt,
        content: stripAnswerKeys(c.content),
        sortOrder: c.sort_order,
      })),
    };
  }

  // ── internal ────────────────────────────────────────────────────────────

  private async lessonTotalsByTrack(trackIds: string[]): Promise<Map<string, number>> {
    const rows = await this.db
      .selectFrom('lessons')
      .innerJoin('modules', 'modules.id', 'lessons.module_id')
      .select((eb) => ['modules.track_id', eb.fn.count<string>('lessons.id').as('total')])
      .where('modules.track_id', 'in', trackIds)
      .groupBy('modules.track_id')
      .execute();
    return new Map(rows.map((r) => [r.track_id, Number(r.total)]));
  }

  private async completedLessonsByTrack(
    userId: string,
    trackIds: string[],
  ): Promise<Map<string, number>> {
    const rows = await this.db
      .selectFrom('lesson_attempts')
      .innerJoin('lessons', 'lessons.id', 'lesson_attempts.lesson_id')
      .innerJoin('modules', 'modules.id', 'lessons.module_id')
      .select((eb) => [
        'modules.track_id',
        eb.fn.count<string>('lesson_attempts.lesson_id').distinct().as('done'),
      ])
      .where('lesson_attempts.user_id', '=', userId)
      .where('modules.track_id', 'in', trackIds)
      .groupBy('modules.track_id')
      .execute();
    return new Map(rows.map((r) => [r.track_id, Number(r.done)]));
  }

  private async completedLessonIds(userId: string, lessonIds: string[]): Promise<Set<string>> {
    if (lessonIds.length === 0) return new Set();
    const rows = await this.db
      .selectFrom('lesson_attempts')
      .select('lesson_id')
      .distinct()
      .where('user_id', '=', userId)
      .where('lesson_id', 'in', lessonIds)
      .execute();
    return new Set(rows.map((r) => r.lesson_id));
  }
}
