/**
 * Bentuk respons tiga rute baca konten.
 *
 * Ditulis di sini, BUKAN di `packages/contracts` — folder itu milik Dev B
 * (`F-08`, skema zod seluruh endpoint MVP), dan menulisnya sendiri akan
 * menabrak tabel kepemilikan di CLAUDE.md. Begitu `F-08` mendarat, tipe di
 * bawah diganti dengan yang diturunkan dari skema zod-nya.
 */

export interface TrackSummary {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  category: string | null;
  sortOrder: number;
  /** LE-9: lesson yang PERNAH diselesaikan, bukan jumlah attempt. */
  progress: { completedLessons: number; totalLessons: number; percent: number };
}

export interface LessonSummary {
  id: string;
  title: string;
  estSeconds: number;
  basePoints: number;
  baseCoins: number;
  sortOrder: number;
  cardCount: number;
  /** Pernah diselesaikan pengguna ini, kapan pun. */
  completed: boolean;
}

export interface ModuleDetail {
  id: string;
  title: string;
  sortOrder: number;
  lessons: LessonSummary[];
  progress: { completedLessons: number; totalLessons: number; percent: number };
}

export interface TrackDetail extends Omit<TrackSummary, 'progress'> {
  modules: ModuleDetail[];
  progress: { completedLessons: number; totalLessons: number; percent: number };
}

/**
 * Kartu SETELAH serializer. `content` sengaja `unknown`: bentuknya berbeda per
 * `kind`, dan tipe yang menebak bentuk akan membuat orang percaya ia tahu
 * isinya. Yang dijamin tipe ini cuma satu hal — kunci jawaban sudah dibuang.
 */
export interface PublicCard {
  id: string;
  kind: string;
  prompt: string;
  content: unknown;
  sortOrder: number;
}

export interface LessonCards {
  lessonId: string;
  title: string;
  estSeconds: number;
  cards: PublicCard[];
}
