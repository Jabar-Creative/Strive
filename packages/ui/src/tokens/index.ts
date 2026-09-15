// Token design system Strive — item F-06 (Dev B).
//
// Aturan yang paling sering dilanggar di produk gamified, dari docs/PRD.md §14.1:
// setiap warna aksen dipatok ke SATU makna dan tidak boleh dipinjam.
//   flame-500  streak DAN HANYA STREAK — tidak untuk CTA
//   coin-500   koin, hadiah, liga Gold
//   indigo-600 aksi utama, tautan, fokus
// Mode gelap BUKAN inversi: setiap token punya nilai gelap yang ditulis terpisah.
//
// Sumber kebenaran non-visual (dipakai lintas paket, mis. perhitungan kontras
// di rute /_specimen — foldernya apps/web/app/%5Fspecimen, lihat komentar
// penamaan folder di page.tsx-nya). Nilai HEX yang sama JUGA ditulis sebagai
// custom property CSS di apps/web/app/globals.css supaya Tailwind bisa
// memakainya lewat `bg-indigo-600`, `text-ink-900`, dst — lihat komentar di
// globals.css.
//
// Duplikasi ini disengaja (tidak ada pipeline Style Dictionary di repo ini),
// bukan kelalaian. Kalau salah satu nilai di bawah diubah, ubah juga
// pasangannya di globals.css pada baris yang sama urutannya — keduanya
// SELALU harus identik. /_specimen memeriksa kecocokan ini secara runtime
// (baca `getComputedStyle` lalu bandingkan ke objek ini) supaya penyimpangan
// ketahuan di halaman itu sendiri, bukan lewat review manual.

/** Satu token warna: nilai terang dan gelap ditulis TERPISAH — bukan hasil hitung. */
export interface ColorToken {
  /** Nilai hex mode terang. */
  light: string;
  /** Nilai hex mode gelap. Ditulis manual, BUKAN inversi/filter/color-mix. */
  dark: string;
  /** Makna token menurut docs/PRD.md §14.1 — jangan dipakai untuk makna lain. */
  meaning: string;
}

export const colorTokens = {
  'indigo-600': {
    light: '#4F3DE8',
    dark: '#8477FF',
    meaning: 'Aksi utama, tautan, fokus. Warna merek.',
  },
  'flame-500': {
    light: '#FF6B35',
    dark: '#FF7A45',
    meaning: 'Streak dan HANYA streak. Tidak untuk CTA.',
  },
  'coin-500': { light: '#FFC24B', dark: '#FFC94F', meaning: 'Strive Coins, hadiah, liga Gold.' },
  'mint-500': { light: '#14B88A', dark: '#2FCB9C', meaning: 'Benar, selesai, tervalidasi.' },
  'rose-500': { light: '#E5484D', dark: '#F26B70', meaning: 'Salah, gagal, destruktif.' },
  'ink-900': { light: '#14122B', dark: '#F0EDFF', meaning: 'Teks utama (netral berbias indigo).' },
  'ink-500': { light: '#7C74A3', dark: '#8A82B4', meaning: 'Teks sekunder, label.' },
  paper: { light: '#FBFAFE', dark: '#0D0B1A', meaning: 'Latar aplikasi.' },
  surface: { light: '#FFFFFF', dark: '#161231', meaning: 'Latar kartu.' },
  line: { light: '#E4E0F3', dark: '#2A2452', meaning: 'Garis pemisah.' },
} as const satisfies Record<string, ColorToken>;

export type ColorTokenName = keyof typeof colorTokens;

/** Satu peran tipografi — docs/PRD.md §14.2. */
export interface TypographyRole {
  /** Kunci keluarga font di theme.extend.fontFamily (tailwind.config.ts). */
  fontFamily: 'display' | 'body' | 'mono';
  sizePx: number;
  weight: number;
  letterSpacingEm?: number;
  uppercase?: boolean;
  /** Angka/data pakai tabular-nums supaya kolom angka rata (mis. saldo koin). */
  tabularNums?: boolean;
}

export const typographyTokens = {
  display: { fontFamily: 'display', sizePx: 40, weight: 800 },
  title: { fontFamily: 'display', sizePx: 24, weight: 700 },
  body: { fontFamily: 'body', sizePx: 15, weight: 400 },
  caption: { fontFamily: 'body', sizePx: 13, weight: 500 },
  label: { fontFamily: 'mono', sizePx: 11, weight: 500, letterSpacingEm: 0.1, uppercase: true },
  data: { fontFamily: 'mono', sizePx: 14, weight: 400, tabularNums: true },
} as const satisfies Record<string, TypographyRole>;

export type TypographyRoleName = keyof typeof typographyTokens;

/** Basis spacing 4px — skala tetap, sama untuk kedua profil (docs/PRD.md §14.3). */
export const spacingScale = [4, 8, 12, 16, 24, 32, 48] as const;

/**
 * Satu profil kepadatan. `tCelMs: null` untuk Console berarti "tidak ada
 * animasi perayaan" (PRD §14.3) — dibedakan dari `0` yang berarti "durasi nol
 * karena prefers-reduced-motion". Konsumen yang mengecek `=== null` tahu ini
 * memang tidak pernah dipakai, bukan sekadar dipercepat.
 */
export interface DensityProfile {
  radiusCardPx: number;
  radiusCtlPx: number;
  tBaseMs: number;
  tBaseEasing: string;
  tCelMs: number | null;
}

export const densityProfiles = {
  student: {
    radiusCardPx: 18,
    radiusCtlPx: 999,
    tBaseMs: 320,
    tBaseEasing: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
    tCelMs: 640,
  },
  console: {
    radiusCardPx: 8,
    radiusCtlPx: 6,
    tBaseMs: 160,
    tBaseEasing: 'ease-out',
    tCelMs: null,
  },
} as const satisfies Record<string, DensityProfile>;

export type DensityProfileName = keyof typeof densityProfiles;
