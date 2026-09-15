'use client';

import { useEffect, useRef, useState } from 'react';
import { colorTokens, type ColorTokenName } from '@strive/ui';
import { cn } from '@/lib/utils';

/**
 * Bagian interaktif /_specimen: tombol pindah mode + rendering token yang
 * SUNGGUHAN dipakai (bukan cuma teks angka) supaya bisa diperiksa visual
 * tanpa mengubah setelan OS (acceptance criteria F-06).
 *
 * `.dark` dipasang pada wrapper LOKAL di komponen ini, bukan `document
 * .documentElement`, supaya toggle di halaman debug ini tidak diam-diam
 * mengubah mode gelap seluruh aplikasi kalau pengguna berpindah halaman
 * tanpa mematikannya dulu — efek sampingnya sengaja dibatasi ke halaman ini.
 *
 * Kelas Tailwind di bawah (bg-indigo-600, text-ink-900, dst) SENGAJA ditulis
 * literal per token, bukan digabung dari string (`bg-${nama}`) — Tailwind
 * memindai teks sumber untuk nama kelas lengkap; nama yang dirakit saat
 * runtime tidak akan terdeteksi dan classnya tidak akan pernah dihasilkan.
 */

const SWATCH_BG_CLASS: Record<ColorTokenName, string> = {
  'indigo-600': 'bg-indigo-600',
  'flame-500': 'bg-flame-500',
  'coin-500': 'bg-coin-500',
  'mint-500': 'bg-mint-500',
  'rose-500': 'bg-rose-500',
  'ink-900': 'bg-ink-900',
  'ink-500': 'bg-ink-500',
  paper: 'bg-paper',
  surface: 'bg-surface',
  line: 'bg-line',
};

const COLOR_TOKEN_NAMES = Object.keys(colorTokens) as ColorTokenName[];

interface SyncResult {
  name: ColorTokenName;
  expectedHex: string;
  actualValue: string;
  ok: boolean;
}

export interface ContrastRow {
  label: string;
  foregroundHex: string;
  backgroundHex: string;
  ratio: number;
  threshold: number;
  passes: boolean;
}

function ContrastTable({ rows, caption }: { rows: ContrastRow[]; caption: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] border-collapse text-left text-sm">
        <caption className="mb-2 text-left font-mono text-label uppercase text-ink-500">
          {caption}
        </caption>
        <thead>
          <tr className="border-b border-line">
            <th className="py-2 pr-4 font-medium text-ink-500">Pasangan</th>
            <th className="py-2 pr-4 font-medium text-ink-500">Rasio</th>
            <th className="py-2 pr-4 font-medium text-ink-500">Ambang</th>
            <th className="py-2 font-medium text-ink-500">Hasil</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-b border-line/60">
              <td className="py-2 pr-4">{row.label}</td>
              <td className="py-2 pr-4 font-mono text-data tabular-nums">
                {row.ratio.toFixed(2)}:1
              </td>
              <td className="py-2 pr-4 font-mono text-data tabular-nums">&ge;{row.threshold}:1</td>
              <td className="py-2">
                {row.passes ? (
                  <span className="inline-flex items-center gap-1.5 rounded-ctl bg-mint-500/15 px-2 py-0.5 font-mono text-label uppercase text-mint-500">
                    Lolos
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-ctl bg-rose-500/15 px-2 py-0.5 font-mono text-label uppercase text-rose-500">
                    Gagal
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ModePreview({
  primaryContrastRows,
  secondaryContrastRows,
  accentContrastRows,
}: {
  primaryContrastRows: ContrastRow[];
  secondaryContrastRows: ContrastRow[];
  accentContrastRows: ContrastRow[];
}) {
  const [isDark, setIsDark] = useState(false);
  const [syncResults, setSyncResults] = useState<SyncResult[]>([]);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Baca CSS custom property yang BENAR-BENAR ter-render (bukan diasumsikan
  // sama dengan packages/ui/src/tokens/index.ts) lalu bandingkan. Efek —
  // bukan turunan saat render — karena getComputedStyle butuh DOM yang
  // sudah dicat, tidak tersedia saat render pertama di server.
  useEffect(() => {
    const node = wrapperRef.current;
    if (!node) return;
    const computed = getComputedStyle(node);
    const results = COLOR_TOKEN_NAMES.map((name) => {
      const expectedHex = isDark ? colorTokens[name].dark : colorTokens[name].light;
      const actualValue = computed.getPropertyValue(`--color-${name}`).trim();
      return {
        name,
        expectedHex,
        actualValue,
        ok: actualValue.toLowerCase() === expectedHex.toLowerCase(),
      };
    });
    setSyncResults(results);
  }, [isDark]);

  const mismatchCount = syncResults.filter((r) => !r.ok).length;

  return (
    <section aria-labelledby="preview-heading" className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 id="preview-heading" className="font-display text-title text-ink-900">
          Pratinjau langsung
        </h2>
        <button
          type="button"
          aria-pressed={isDark}
          onClick={() => setIsDark((prev) => !prev)}
          className="rounded-ctl border border-line bg-surface px-4 py-2 font-mono text-label uppercase text-ink-900 transition-colors duration-base ease-base hover:border-indigo-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
        >
          {isDark ? 'Mode gelap aktif — beralih ke terang' : 'Mode terang aktif — beralih ke gelap'}
        </button>
      </div>

      {/* Wrapper `.dark` LOKAL — lihat komentar berkas di atas. */}
      <div
        ref={wrapperRef}
        className={cn(
          'space-y-8 rounded-card border border-line bg-paper p-6',
          isDark ? 'dark' : '',
        )}
      >
        <div>
          <h3 className="font-mono text-label uppercase text-ink-500">Kesepuluh token warna</h3>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
            {COLOR_TOKEN_NAMES.map((name) => (
              <div key={name} className="rounded-ctl border border-line bg-surface p-2 text-center">
                <div
                  className={cn(
                    'h-12 w-full rounded-ctl border border-line',
                    SWATCH_BG_CLASS[name],
                  )}
                />
                <p className="mt-2 font-mono text-label uppercase text-ink-900">{name}</p>
                <p className="font-mono text-data tabular-nums text-ink-500">
                  {isDark ? colorTokens[name].dark : colorTokens[name].light}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h3 className="font-mono text-label uppercase text-ink-500">Enam peran tipografi</h3>
          <div className="mt-3 space-y-3 rounded-ctl border border-line bg-surface p-4">
            <p className="font-display text-display text-ink-900">Belajar tiap hari</p>
            <p className="font-display text-title text-ink-900">Streak kamu 12 hari</p>
            <p className="font-body text-body text-ink-900">
              Kartu bite-sized dirancang supaya bisa diselesaikan dalam satu jeda kuliah.
            </p>
            <p className="font-body text-caption text-ink-500">Diperbarui 2 menit lalu</p>
            <p className="font-mono text-label uppercase text-ink-500">Skor kuis</p>
            <p className="font-mono text-data tabular-nums text-ink-900">1.284 Strive Coins</p>
          </div>
        </div>

        <div>
          <h3 className="font-mono text-label uppercase text-ink-500">
            Dua profil kepadatan (tidak terpengaruh mode terang/gelap)
          </h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div data-density="student" className="rounded-ctl border border-line bg-surface p-4">
              <p className="font-mono text-label uppercase text-ink-500">Student</p>
              <div
                aria-hidden="true"
                className="mt-3 h-10 w-10 rounded-card bg-indigo-600/20 transition-transform duration-base ease-base hover:scale-125"
              />
              <p className="mt-2 font-mono text-data tabular-nums text-ink-900">
                r-card 18px · r-ctl 999px · 320ms spring
              </p>
            </div>
            <div data-density="console" className="rounded-ctl border border-line bg-surface p-4">
              <p className="font-mono text-label uppercase text-ink-500">Console</p>
              <div
                aria-hidden="true"
                className="mt-3 h-10 w-10 rounded-card bg-indigo-600/20 transition-transform duration-base ease-base hover:scale-125"
              />
              <p className="mt-2 font-mono text-data tabular-nums text-ink-900">
                r-card 8px · r-ctl 6px · 160ms ease-out · tanpa animasi perayaan
              </p>
            </div>
          </div>
          <p className="mt-2 text-caption text-ink-500">
            Arahkan kursor ke kotak kecil untuk merasakan beda gerak: Student memantul (spring),
            Console langsung berhenti (ease-out). Nonaktifkan lewat setelan aksesibilitas OS
            (kurangi gerak) untuk memeriksa keduanya jadi diam.
          </p>
        </div>

        <div className="space-y-6">
          <ContrastTable
            rows={primaryContrastRows}
            caption="Teks utama (ink-900) — wajib >= 4,5:1 di kedua mode"
          />
          <ContrastTable
            rows={secondaryContrastRows}
            caption="Teks sekunder (ink-500) — transparansi, lihat catatan di bawah"
          />
          <ContrastTable
            rows={accentContrastRows}
            caption="Aksen vs paper — ambang UI non-teks (>= 3:1), bukan ambang teks"
          />
        </div>

        <div className="rounded-ctl border border-line bg-surface p-4">
          <h3 className="font-mono text-label uppercase text-ink-500">
            Kecocokan CSS × packages/ui/src/tokens
          </h3>
          {syncResults.length > 0 ? (
            <p
              className={cn(
                'mt-2 font-mono text-data tabular-nums',
                mismatchCount === 0 ? 'text-mint-500' : 'text-rose-500',
              )}
            >
              {mismatchCount === 0
                ? `${syncResults.length}/${syncResults.length} token cocok`
                : `${mismatchCount} dari ${syncResults.length} token TIDAK cocok — lihat rincian di bawah`}
            </p>
          ) : (
            <p className="mt-2 text-caption text-ink-500">Memeriksa…</p>
          )}
          {mismatchCount > 0 ? (
            <ul className="mt-2 space-y-1 text-caption text-rose-500">
              {syncResults
                .filter((r) => !r.ok)
                .map((r) => (
                  <li key={r.name}>
                    {r.name}: globals.css = &quot;{r.actualValue}&quot;, tokens/index.ts = &quot;
                    {r.expectedHex}&quot;
                  </li>
                ))}
            </ul>
          ) : null}
        </div>
      </div>
    </section>
  );
}
