/**
 * Kontras warna WCAG 2.x — dipakai /_specimen untuk MEMBUKTIKAN klaim
 * "kontras teks utama >= 4,5:1" di docs/PRD.md §14.1 dan §14.5 dengan angka
 * yang benar-benar dihitung, bukan cuma dituliskan sebagai teks statis.
 *
 * Implementasi manual (bukan library eksternal) karena rumusnya pendek dan
 * fungsinya cuma dipakai satu halaman internal — menambah dependency untuk
 * ini tidak sepadan.
 *
 * Rumus: https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
 * dan https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio
 */

type Rgb8 = readonly [number, number, number];

/** Parse "#RRGGBB" jadi komponen 0-255. Tidak menerima notasi 3 digit. */
function hexToRgb(hex: string): Rgb8 {
  const clean = hex.replace('#', '');
  const value = Number.parseInt(clean, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function srgbChannelToLinear(channel8bit: number): number {
  const channel = channel8bit / 255;
  return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance([r, g, b]: Rgb8): number {
  const rLin = srgbChannelToLinear(r);
  const gLin = srgbChannelToLinear(g);
  const bLin = srgbChannelToLinear(b);
  return 0.2126 * rLin + 0.7152 * gLin + 0.0722 * bLin;
}

/** Rasio kontras WCAG antara dua warna hex, dibulatkan ke 2 desimal. */
export function contrastRatio(hexA: string, hexB: string): number {
  const luminanceA = relativeLuminance(hexToRgb(hexA));
  const luminanceB = relativeLuminance(hexToRgb(hexB));
  const lighter = Math.max(luminanceA, luminanceB);
  const darker = Math.min(luminanceA, luminanceB);
  const ratio = (lighter + 0.05) / (darker + 0.05);
  return Math.round(ratio * 100) / 100;
}

/** Ambang WCAG AA untuk teks berukuran normal — docs/PRD.md §14.5. */
export const AA_NORMAL_TEXT_THRESHOLD = 4.5;

/** Ambang WCAG AA untuk teks besar / komponen UI non-teks — docs/PRD.md §14.5. */
export const AA_LARGE_TEXT_THRESHOLD = 3;
