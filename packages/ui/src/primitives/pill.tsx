import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../lib/utils';

/**
 * Pill — dibangun di atas bentuk visual `Badge` (item F-07), dasar untuk
 * badge/status generik: kontainer `rounded-ctl` (999px Student / 6px
 * Console — PRD §14.3) dengan tint lembut (bg warna/10-15%, bukan warna
 * solid) supaya teks di dalamnya tetap terbaca di kedua mode.
 *
 * Varian sengaja diberi nama BERDASARKAN MAKSUD (`neutral`/`brand`/
 * `success`/`danger`), bukan nama warna. docs/PRD.md §14.1: "setiap warna
 * aksen dipatok ke satu makna dan tidak boleh dipinjam" — `flame-500`
 * (streak) dan `coin-500` (Strive Coins) SENGAJA TIDAK diekspos sebagai
 * varian Pill generik ini, karena Pill dipakai bebas di seluruh app dan
 * memberi nama warna di API publik mengundang pemakaian di luar makna aslinya
 * (mis. `<Pill tone="flame">` dipakai untuk badge "trending" yang tidak ada
 * hubungannya dengan streak). `StreakChip` dan `CoinPill`
 * (packages/ui/src/student) menimpa warna lewat `className` di atas varian
 * `neutral` untuk mengakses flame-500/coin-500 di tempat yang memang berhak.
 *
 * Teks SELALU `ink-900`, bukan warna tone-nya — dihitung ulang manual pakai
 * rumus WCAG (sama seperti /_specimen): `mint-500` sebagai teks di atas latar
 * nyaris putih cuma ~2,5:1, `rose-500` ~3,9:1, `flame-500` ~2,8:1. Ketiganya
 * di bawah ambang AA 4,5:1 untuk teks normal — token-token ini "500" cukup
 * terang untuk background tint, tapi terlalu terang untuk jadi warna teks di
 * atas latar terang. Warna tone hanya dipakai untuk wash latar + border;
 * ikon (elemen dekoratif, bukan satu-satunya penanda karena teksnya sendiri
 * sudah menyebut maknanya) boleh tetap ditintai warna tone.
 */
const pillVariants = cva(
  'inline-flex items-center gap-1.5 rounded-ctl px-3 py-1 text-caption font-semibold text-ink-900',
  {
    variants: {
      tone: {
        neutral: 'border border-line bg-surface',
        brand: 'border border-transparent bg-indigo-600/10',
        success: 'border border-mint-500/30 bg-mint-500/15',
        danger: 'border border-rose-500/30 bg-rose-500/15',
      },
    },
    defaultVariants: {
      tone: 'neutral',
    },
  },
);

export interface PillProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof pillVariants> {}

const Pill = React.forwardRef<HTMLSpanElement, PillProps>(({ className, tone, ...props }, ref) => (
  <span ref={ref} className={cn(pillVariants({ tone }), className)} {...props} />
));
Pill.displayName = 'Pill';

export { Pill, pillVariants };
