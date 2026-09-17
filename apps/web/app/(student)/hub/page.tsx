'use client';

import { useRouter } from 'next/navigation';

import { Button, CoinPill, StreakChip } from '@strive/ui';

import { PageStub } from '@/components/page-stub';
import { authClient } from '@/lib/auth-client';

/**
 * Strip sesi (A-03) di atas stub Hub — BUKAN implementasi S-03.
 *
 * Tujuannya pembuktian acceptance criteria A-03 di layar sungguhan: nama dan
 * email pengguna aktif terender dari cookie sesi, dan TETAP terender setelah
 * reload (AC-1) tanpa pernah dilempar ke /login (AC-2). Begitu S-03
 * dikerjakan, strip ini digantikan shell Hub yang sesungguhnya.
 */
function StripSesi() {
  const router = useRouter();
  const { data: sesi, isPending } = authClient.useSession();

  if (isPending) {
    return <p className="text-sm text-muted-foreground">Memuat sesi…</p>;
  }
  if (!sesi) {
    return (
      <p className="text-sm text-muted-foreground">
        Belum masuk.{' '}
        <a className="text-primary underline-offset-4 hover:underline" href="/login">
          Masuk
        </a>
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-sm">
        <span className="font-medium">{sesi.user.name}</span>
        <span className="text-muted-foreground"> · {sesi.user.email}</span>
      </p>
      <Button
        onClick={async () => {
          await authClient.signOut();
          router.replace('/login');
        }}
        size="sm"
        variant="secondary"
      >
        Keluar
      </Button>
    </div>
  );
}

export default function Page() {
  return (
    <PageStub title="Hub" item="S-03" dev="B" prd="PRD §7 E3 · §10.3 GET /hub">
      {/*
        Pratinjau komponen F-07 — BUKAN implementasi S-03. Nilai di bawah
        contoh statis untuk membuktikan acceptance criteria F-07 ("tujuh
        komponen terpakai di minimal dua layar"), bukan data streak/saldo
        sungguhan (itu tugas S-03, belum dikerjakan).
      */}
      <div className="mb-6 rounded-card border border-dashed border-line p-4">
        <p className="mb-3 font-mono text-label uppercase text-ink-500">
          Sesi aktif (A-03) — bertahan reload
        </p>
        <StripSesi />
      </div>
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
