import { LessonPlayer } from '@/components/lesson-player';

/**
 * Layar pemain lesson — L-04. URL /learn/lesson/:id tidak dipatok PRD
 * (PRD hanya menetapkan rute API); pola ini mengikuti konvensi App Router
 * dan F-09 yang sudah menempatkan seluruh alur belajar di bawah /learn.
 */
export default async function LessonPage({ params }: { params: Promise<{ lessonId: string }> }) {
  const { lessonId } = await params;
  return <LessonPlayer lessonId={lessonId} />;
}
