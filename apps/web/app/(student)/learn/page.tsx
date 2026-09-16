import { LessonCard } from '@strive/ui';
import { PageStub } from '@/components/page-stub';

export default function Page() {
  return (
    <PageStub title="Belajar" item="L-05" dev="B" prd="PRD §7 E2">
      {/*
        Pratinjau komponen F-07 — BUKAN implementasi L-05. Kartu di bawah
        contoh statis untuk membuktikan acceptance criteria F-07, bukan
        lesson_cards sungguhan dari database (itu tugas L-05).
      */}
      <div className="rounded-card border border-dashed border-line p-4">
        <p className="mb-3 font-mono text-label uppercase text-ink-500">
          Pratinjau komponen F-07 — bukan data sungguhan
        </p>
        <LessonCard
          variant="swipe_binary"
          title="Konsep OOP"
          prompt="Pewarisan (inheritance) selalu lebih baik daripada komposisi."
        />
      </div>
    </PageStub>
  );
}
