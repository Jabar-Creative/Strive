import { z } from 'zod';
import { uuidSchema } from '../common';

/** Progres ringkas — LE-9: dihitung dari jumlah lesson yang PERNAH selesai, bukan attempt. */
export const trackProgressSchema = z.object({
  completed_lessons: z.number().int(),
  total_lessons: z.number().int(),
});
export type TrackProgress = z.infer<typeof trackProgressSchema>;

/** GET /tracks — satu item daftar track + progres. docs/PRD.md §9.3 tabel `tracks`. */
export const trackSummarySchema = z.object({
  id: uuidSchema,
  slug: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  category: z.string(),
  sort_order: z.number().int(),
  progress: trackProgressSchema,
});
export type TrackSummary = z.infer<typeof trackSummarySchema>;

export const tracksResponseSchema = z.array(trackSummarySchema);
export type TracksResponse = z.infer<typeof tracksResponseSchema>;

/** Satu lesson di dalam modul — bagian dari GET /tracks/:id. */
export const lessonSummarySchema = z.object({
  id: uuidSchema,
  title: z.string(),
  est_seconds: z.number().int(),
  base_points: z.number().int(),
  base_coins: z.number().int(),
  sort_order: z.number().int(),
  /** Sudah pernah diselesaikan (rewarded) oleh pengguna ini — bukan sekadar dicoba. */
  completed: z.boolean(),
});
export type LessonSummary = z.infer<typeof lessonSummarySchema>;

export const moduleWithLessonsSchema = z.object({
  id: uuidSchema,
  title: z.string(),
  sort_order: z.number().int(),
  progress: trackProgressSchema,
  lessons: z.array(lessonSummarySchema),
});
export type ModuleWithLessons = z.infer<typeof moduleWithLessonsSchema>;

/** GET /tracks/:id — "Modul + lesson + progres per modul", docs/PRD.md §10.3. */
export const trackDetailResponseSchema = trackSummarySchema.extend({
  modules: z.array(moduleWithLessonsSchema),
});
export type TrackDetailResponse = z.infer<typeof trackDetailResponseSchema>;
