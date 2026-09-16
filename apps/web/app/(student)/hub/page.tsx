import { CoinPill, StreakChip } from '@strive/ui';
import { PageStub } from '@/components/page-stub';

export default function Page() {
  return (
    <PageStub title="Hub" item="S-03" dev="B" prd="PRD §7 E3 · §10.3 GET /hub">
      {/*
        Pratinjau komponen F-07 — BUKAN implementasi S-03. Nilai di bawah
        contoh statis untuk membuktikan acceptance criteria F-07 ("tujuh
        komponen terpakai di minimal dua layar"), bukan data streak/saldo
        sungguhan (itu tugas S-03, belum dikerjakan).
      */}
      <div className="rounded-card border border-dashed border-line p-4">
        <p className="mb-3 font-mono text-label uppercase text-ink-500">
          Pratinjau komponen F-07 — bukan data sungguhan
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <StreakChip status="active" days={12} />
          <CoinPill amount={1250} />
        </div>
      </div>
    </PageStub>
  );
}
