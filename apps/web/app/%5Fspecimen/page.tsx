import type { Metadata } from 'next';
import {
  colorTokens,
  densityProfiles,
  typographyTokens,
  type ColorTokenName,
  type TypographyRole,
} from '@strive/ui';
import { AA_LARGE_TEXT_THRESHOLD, AA_NORMAL_TEXT_THRESHOLD, contrastRatio } from './contrast';
import { ModePreview, type ContrastRow } from './mode-preview';

// PENTING soal nama folder induk berkas ini: `%5Fspecimen`, BUKAN `_specimen`.
// Next.js App Router memperlakukan folder berawalan underscore sebagai
// "private folder" dan MENGECUALIKANNYA dari routing sama sekali (dibuktikan
// lewat build: dengan nama `_specimen`, route-nya tidak pernah muncul di
// `.next/server/app`). `%5F` adalah escape resmi Next.js untuk underscore
// literal di nama folder route — hasilnya route BENAR-BENAR `/_specimen`
// seperti diminta acceptance criteria F-06, hanya nama foldernya yang
// terlihat tidak biasa. JANGAN direname balik ke `_specimen` — itu akan
// membuat halaman ini 404 lagi secara diam-diam.
//
// Halaman internal (item F-06) — dibiarkan di luar dua belas rute inti F-09
// dan TIDAK ditambahkan ke components/nav.tsx atau peta rute app/page.tsx,
// sesuai instruksi sesi ini. `noindex` sekadar jaga-jaga; halaman ini juga
// tidak ditautkan dari mana pun.
export const metadata: Metadata = {
  title: 'Design tokens — /_specimen',
  robots: { index: false, follow: false },
};

const COLOR_TOKEN_NAMES = Object.keys(colorTokens) as ColorTokenName[];
const TYPOGRAPHY_ROLE_NAMES = Object.keys(typographyTokens) as Array<keyof typeof typographyTokens>;
const ACCENT_TOKEN_NAMES: ColorTokenName[] = [
  'indigo-600',
  'flame-500',
  'coin-500',
  'mint-500',
  'rose-500',
];

const MODE_LABEL: Record<'light' | 'dark', string> = { light: 'terang', dark: 'gelap' };

/**
 * Baris kontras untuk satu token teks (ink-900 atau ink-500) melawan kedua
 * latar (paper, surface), di kedua mode. Dihitung sekali di server — nilai
 * hex-nya statis (dari packages/ui/src/tokens), jadi tidak perlu dihitung
 * ulang di client saat mode di-toggle.
 */
function buildTextContrastRows(textToken: 'ink-900' | 'ink-500', label: string): ContrastRow[] {
  return (['light', 'dark'] as const).flatMap((mode) =>
    (['paper', 'surface'] as const).map((bgToken): ContrastRow => {
      const foregroundHex = colorTokens[textToken][mode];
      const backgroundHex = colorTokens[bgToken][mode];
      const ratio = contrastRatio(foregroundHex, backgroundHex);
      return {
        label: `${label} atas ${bgToken} — mode ${MODE_LABEL[mode]}`,
        foregroundHex,
        backgroundHex,
        ratio,
        threshold: AA_NORMAL_TEXT_THRESHOLD,
        passes: ratio >= AA_NORMAL_TEXT_THRESHOLD,
      };
    }),
  );
}

function buildAccentContrastRows(): ContrastRow[] {
  return (['light', 'dark'] as const).flatMap((mode) =>
    ACCENT_TOKEN_NAMES.map((token): ContrastRow => {
      const foregroundHex = colorTokens[token][mode];
      const backgroundHex = colorTokens.paper[mode];
      const ratio = contrastRatio(foregroundHex, backgroundHex);
      return {
        label: `${token} atas paper — mode ${MODE_LABEL[mode]}`,
        foregroundHex,
        backgroundHex,
        ratio,
        threshold: AA_LARGE_TEXT_THRESHOLD,
        passes: ratio >= AA_LARGE_TEXT_THRESHOLD,
      };
    }),
  );
}

export default function SpecimenPage() {
  const primaryContrastRows = buildTextContrastRows('ink-900', 'Teks utama (ink-900)');
  const secondaryContrastRows = buildTextContrastRows('ink-500', 'Teks sekunder (ink-500)');
  const accentContrastRows = buildAccentContrastRows();

  const secondaryFailures = secondaryContrastRows.filter((row) => !row.passes);

  return (
    <main className="mx-auto max-w-4xl space-y-12 px-6 py-12">
      <header>
        <p className="font-mono text-label uppercase text-ink-500">/_specimen · item F-06</p>
        <h1 className="mt-2 font-display text-display text-ink-900">Design tokens</h1>
        <p className="mt-4 text-body text-ink-500">
          Halaman internal untuk membuktikan token warna, tipografi, radius, dan durasi dari{' '}
          <code>docs/PRD.md</code> §14 — bukan cuma daftar spesifikasi, tapi rendering nyata yang
          bisa diperiksa di kedua mode dan angka kontras yang benar-benar dihitung.
        </p>
      </header>

      <section aria-labelledby="colors-heading" className="space-y-4">
        <h2 id="colors-heading" className="font-display text-title text-ink-900">
          14.1 · Palet ({COLOR_TOKEN_NAMES.length} token)
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-line">
                <th className="py-2 pr-4 font-medium text-ink-500">Token</th>
                <th className="py-2 pr-4 font-medium text-ink-500">Makna</th>
                <th className="py-2 pr-4 font-medium text-ink-500">Terang</th>
                <th className="py-2 font-medium text-ink-500">Gelap</th>
              </tr>
            </thead>
            <tbody>
              {COLOR_TOKEN_NAMES.map((name) => (
                <tr key={name} className="border-b border-line/60">
                  <td className="py-2 pr-4 font-mono text-data">{name}</td>
                  <td className="py-2 pr-4 text-ink-500">{colorTokens[name].meaning}</td>
                  <td className="py-2 pr-4 font-mono text-data tabular-nums">
                    {colorTokens[name].light}
                  </td>
                  <td className="py-2 font-mono text-data tabular-nums">
                    {colorTokens[name].dark}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="typography-heading" className="space-y-4">
        <h2 id="typography-heading" className="font-display text-title text-ink-900">
          14.2 · Tipografi ({TYPOGRAPHY_ROLE_NAMES.length} peran)
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-line">
                <th className="py-2 pr-4 font-medium text-ink-500">Peran</th>
                <th className="py-2 pr-4 font-medium text-ink-500">Font</th>
                <th className="py-2 pr-4 font-medium text-ink-500">Ukuran</th>
                <th className="py-2 pr-4 font-medium text-ink-500">Bobot</th>
                <th className="py-2 font-medium text-ink-500">Catatan</th>
              </tr>
            </thead>
            <tbody>
              {TYPOGRAPHY_ROLE_NAMES.map((role) => {
                // Anotasi eksplisit: `as const satisfies Record<...>` di
                // packages/ui/src/tokens/index.ts membuat tiap entri
                // bertipe literal PERSIS miliknya sendiri (union), bukan
                // `TypographyRole` yang lebih umum — properti opsional yang
                // tidak dipakai entri tertentu (mis. `uppercase` di
                // `display`) jadi tidak "terlihat" tanpa anotasi ini.
                const spec: TypographyRole = typographyTokens[role];
                const notes = [
                  spec.letterSpacingEm ? `letter-spacing ${spec.letterSpacingEm}em` : null,
                  spec.uppercase ? 'uppercase' : null,
                  spec.tabularNums ? 'tabular-nums' : null,
                ].filter(Boolean);
                return (
                  <tr key={role} className="border-b border-line/60">
                    <td className="py-2 pr-4 font-mono text-data">{role}</td>
                    <td className="py-2 pr-4 text-ink-500">{spec.fontFamily}</td>
                    <td className="py-2 pr-4 font-mono text-data tabular-nums">{spec.sizePx}px</td>
                    <td className="py-2 pr-4 font-mono text-data tabular-nums">{spec.weight}</td>
                    <td className="py-2 text-ink-500">
                      {notes.length > 0 ? notes.join(', ') : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="density-heading" className="space-y-4">
        <h2 id="density-heading" className="font-display text-title text-ink-900">
          14.3 · Spacing, radius, gerak
        </h2>
        <p className="text-body text-ink-500">
          Basis spacing 4px, skala {[4, 8, 12, 16, 24, 32, 48].join(' · ')}. Radius dan durasi
          berbeda per profil kepadatan:
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-line">
                <th className="py-2 pr-4 font-medium text-ink-500">Token</th>
                <th className="py-2 pr-4 font-medium text-ink-500">Student</th>
                <th className="py-2 font-medium text-ink-500">Console</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-line/60">
                <td className="py-2 pr-4 font-mono text-data">--r-card</td>
                <td className="py-2 pr-4 font-mono text-data tabular-nums">
                  {densityProfiles.student.radiusCardPx}px
                </td>
                <td className="py-2 font-mono text-data tabular-nums">
                  {densityProfiles.console.radiusCardPx}px
                </td>
              </tr>
              <tr className="border-b border-line/60">
                <td className="py-2 pr-4 font-mono text-data">--r-ctl</td>
                <td className="py-2 pr-4 font-mono text-data tabular-nums">
                  {densityProfiles.student.radiusCtlPx}px
                </td>
                <td className="py-2 font-mono text-data tabular-nums">
                  {densityProfiles.console.radiusCtlPx}px
                </td>
              </tr>
              <tr className="border-b border-line/60">
                <td className="py-2 pr-4 font-mono text-data">--t-base</td>
                <td className="py-2 pr-4 font-mono text-data tabular-nums">
                  {densityProfiles.student.tBaseMs}ms {densityProfiles.student.tBaseEasing}
                </td>
                <td className="py-2 font-mono text-data tabular-nums">
                  {densityProfiles.console.tBaseMs}ms {densityProfiles.console.tBaseEasing}
                </td>
              </tr>
              <tr className="border-b border-line/60">
                <td className="py-2 pr-4 font-mono text-data">--t-cel</td>
                <td className="py-2 pr-4 font-mono text-data tabular-nums">
                  {densityProfiles.student.tCelMs}ms
                </td>
                <td className="py-2 font-mono text-data tabular-nums">tidak ada</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-caption text-ink-500">
          Seluruh durasi di atas otomatis jadi 0 saat OS diset{' '}
          <code>prefers-reduced-motion: reduce</code> — lihat <code>apps/web/app/globals.css</code>.
        </p>
      </section>

      <ModePreview
        primaryContrastRows={primaryContrastRows}
        secondaryContrastRows={secondaryContrastRows}
        accentContrastRows={accentContrastRows}
      />

      {secondaryFailures.length > 0 ? (
        <section
          aria-labelledby="finding-heading"
          className="rounded-card border border-rose-500/40 bg-rose-500/5 p-4"
        >
          <h2 id="finding-heading" className="font-mono text-label uppercase text-rose-500">
            Temuan — bukan bug implementasi
          </h2>
          <p className="mt-2 text-body text-ink-900">
            <code>ink-500</code> (teks sekunder) di mode terang berada di bawah ambang AA 4,5:1
            untuk teks normal saat dipasang di atas <code>paper</code> maupun <code>surface</code> (
            {secondaryFailures.map((r) => `${r.ratio.toFixed(2)}:1`).join(', ')}). Nilai hex ini
            disalin persis dari docs/PRD.md §14.1 — tidak diubah di sesi ini. Perlu ditinjau tim
            desain sebelum <code>ink-500</code> dipakai sebagai teks berukuran biasa (13–15px) di
            mode terang; aman dipakai untuk teks besar (≥ 18px) atau elemen non-teks.
          </p>
        </section>
      ) : null}
    </main>
  );
}
