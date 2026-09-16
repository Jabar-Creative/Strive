import type { Metadata } from 'next';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  CoinPill,
  LeagueBadge,
  LessonCard,
  Pill,
  StreakChip,
  type StreakStatus,
} from '@strive/ui';
import { ModeToggle } from './mode-toggle';

// PENTING soal nama folder induk berkas ini: `%5Fkit`, BUKAN `_kit` — alasan
// PERSIS sama seperti `apps/web/app/%5Fspecimen/page.tsx` (F-06): Next.js App
// Router memperlakukan folder berawalan underscore sebagai "private folder"
// dan mengecualikannya dari routing. `%5F` adalah escape resmi Next.js untuk
// underscore literal di nama folder route — hasilnya route BENAR-BENAR
// `/_kit`. JANGAN direname balik ke `_kit`.
export const metadata: Metadata = {
  title: 'UI kit — /_kit',
  robots: { index: false, follow: false },
};

function SectionHeading({ id, title, note }: { id: string; title: string; note: string }) {
  return (
    <div>
      <h2 id={id} className="font-display text-title text-ink-900">
        {title}
      </h2>
      <p className="mt-1 text-caption text-ink-500">{note}</p>
    </div>
  );
}

function VariantLabel({ children }: { children: React.ReactNode }) {
  return <p className="mb-2 font-mono text-label uppercase text-ink-500">{children}</p>;
}

const STREAK_STATUSES: readonly StreakStatus[] = ['active', 'at_risk', 'frozen', 'broken'];
const LEAGUE_TIERS = ['bronze', 'silver', 'gold'] as const;

export default function KitPage() {
  return (
    <main className="mx-auto max-w-4xl space-y-14 px-6 py-12">
      <header>
        <p className="font-mono text-label uppercase text-ink-500">/_kit · item F-07</p>
        <h1 className="mt-2 font-display text-display text-ink-900">UI kit</h1>
        <p className="mt-4 text-body text-ink-900">
          Halaman internal untuk membuktikan tujuh komponen UI kit dari <code>docs/PRD.md</code>{' '}
          §14.4 — bukan cuma daftar spesifikasi, tapi rendering nyata di kedua mode warna. Untuk
          bukti pemakaian di layar sungguhan (acceptance criteria F-07), lihat <code>/hub</code> dan{' '}
          <code>/learn</code>.
        </p>
      </header>

      <ModeToggle>
        <section aria-labelledby="button-heading" className="space-y-4">
          <SectionHeading
            id="button-heading"
            title="1 · Button"
            note="Enam varian shadcn standar × empat ukuran. Fokus lewat Tab untuk memeriksa :focus-visible."
          />
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <VariantLabel>default</VariantLabel>
              <Button>Simpan</Button>
            </div>
            <div>
              <VariantLabel>secondary</VariantLabel>
              <Button variant="secondary">Batal</Button>
            </div>
            <div>
              <VariantLabel>destructive</VariantLabel>
              <Button variant="destructive">Hapus</Button>
            </div>
            <div>
              <VariantLabel>outline</VariantLabel>
              <Button variant="outline">Lihat detail</Button>
            </div>
            <div>
              <VariantLabel>ghost</VariantLabel>
              <Button variant="ghost">Lewati</Button>
            </div>
            <div>
              <VariantLabel>link</VariantLabel>
              <Button variant="link">Pelajari lebih lanjut</Button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <VariantLabel>size sm</VariantLabel>
              <Button size="sm">Kecil</Button>
            </div>
            <div>
              <VariantLabel>size default</VariantLabel>
              <Button size="default">Sedang</Button>
            </div>
            <div>
              <VariantLabel>size lg</VariantLabel>
              <Button size="lg">Besar</Button>
            </div>
            <div>
              <VariantLabel>size icon</VariantLabel>
              <Button size="icon" aria-label="Tambah">
                +
              </Button>
            </div>
          </div>
        </section>

        <section aria-labelledby="card-heading" className="space-y-4">
          <SectionHeading
            id="card-heading"
            title="2 · Card"
            note="Struktur 6-bagian shadcn standar. Tanpa bayangan bawaan — lihat komentar packages/ui/src/primitives/card.tsx."
          />
          <Card className="max-w-sm">
            <CardHeader>
              <CardTitle>Ringkasan squad</CardTitle>
              <CardDescription>Diperbarui 2 menit lalu</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-body text-ink-900">6 anggota aktif, 2 review menunggu.</p>
            </CardContent>
            <CardFooter>
              <Button size="sm">Buka squad</Button>
            </CardFooter>
          </Card>
        </section>

        <section aria-labelledby="pill-heading" className="space-y-4">
          <SectionHeading
            id="pill-heading"
            title="3 · Pill"
            note="Dasar visual Badge/status. Empat tone berdasarkan MAKSUD, bukan nama warna — lihat komentar pill.tsx."
          />
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <VariantLabel>neutral</VariantLabel>
              <Pill tone="neutral">Menunggu</Pill>
            </div>
            <div>
              <VariantLabel>brand</VariantLabel>
              <Pill tone="brand">Baru</Pill>
            </div>
            <div>
              <VariantLabel>success</VariantLabel>
              <Pill tone="success">Selesai</Pill>
            </div>
            <div>
              <VariantLabel>danger</VariantLabel>
              <Pill tone="danger">Gagal</Pill>
            </div>
          </div>
        </section>

        <section aria-labelledby="streak-heading" className="space-y-4">
          <SectionHeading
            id="streak-heading"
            title="4 · StreakChip"
            note="Empat status. `broken` tidak pernah merah — streak putus itu kekecewaan, bukan kesalahan."
          />
          <div className="flex flex-wrap items-center gap-3">
            {STREAK_STATUSES.map((status) => (
              <div key={status}>
                <VariantLabel>{status}</VariantLabel>
                <StreakChip status={status} days={status === 'broken' ? undefined : 12} />
              </div>
            ))}
          </div>
        </section>

        <section aria-labelledby="coin-heading" className="space-y-4">
          <SectionHeading
            id="coin-heading"
            title="5 · CoinPill"
            note="font-mono tabular-nums, format ribuan Indonesia. Tanda +/- tidak bergantung warna saja."
          />
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <VariantLabel>saldo</VariantLabel>
              <CoinPill amount={1250} />
            </div>
            <div>
              <VariantLabel>delta positif</VariantLabel>
              <CoinPill amount={2400} variant="delta" />
            </div>
            <div>
              <VariantLabel>delta negatif</VariantLabel>
              <CoinPill amount={-2400} variant="delta" />
            </div>
          </div>
        </section>

        <section aria-labelledby="league-heading" className="space-y-4">
          <SectionHeading
            id="league-heading"
            title="6 · LeagueBadge"
            note="Tiga tier. Gradien metalik hanya di dalam badge ini (satu-satunya pengecualian hex di luar token)."
          />
          <div className="flex flex-wrap items-center gap-6">
            {LEAGUE_TIERS.map((tier) => (
              <div key={tier}>
                <VariantLabel>{tier}</VariantLabel>
                <LeagueBadge tier={tier} />
              </div>
            ))}
          </div>
        </section>

        <section aria-labelledby="lesson-heading" className="space-y-4">
          <SectionHeading
            id="lesson-heading"
            title="7 · LessonCard"
            note="Dua varian. swipe_binary punya alternatif tombol (PRD §14.5) — bukan implementasi gestur swipe penuh (scope L-04)."
          />
          <div className="grid gap-6 sm:grid-cols-2">
            <div>
              <VariantLabel>multiple_choice</VariantLabel>
              <LessonCard
                variant="multiple_choice"
                title="Struktur data"
                prompt="Struktur data mana yang cocok untuk antrean FIFO?"
              >
                <ul className="space-y-2 text-body text-ink-900">
                  <li className="rounded-ctl border border-line px-3 py-2">Stack</li>
                  <li className="rounded-ctl border border-line px-3 py-2">Queue</li>
                  <li className="rounded-ctl border border-line px-3 py-2">Hash map</li>
                </ul>
              </LessonCard>
            </div>
            <div>
              <VariantLabel>swipe_binary</VariantLabel>
              <LessonCard
                variant="swipe_binary"
                title="Konsep OOP"
                prompt="Pewarisan (inheritance) selalu lebih baik daripada komposisi."
              />
            </div>
          </div>
        </section>
      </ModeToggle>
    </main>
  );
}
