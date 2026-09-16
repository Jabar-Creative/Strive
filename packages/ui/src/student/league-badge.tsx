import { Medal } from 'lucide-react';
import { cn } from '../lib/utils';

export type LeagueTier = 'bronze' | 'silver' | 'gold';

const TIER_LABEL: Record<LeagueTier, string> = {
  bronze: 'Liga Perunggu',
  silver: 'Liga Perak',
  gold: 'Liga Emas',
};

// Gradien metalik — SATU-SATUNYA tempat di seluruh UI kit yang memakai hex
// literal di luar token Strive, dan itu disengaja (instruksi F-07): gradien
// metalik adalah efek visual komposit, bukan "warna" bermakna tunggal seperti
// entri di docs/PRD.md §14.1, jadi tidak masuk sistem token. Stop warna
// klasik perunggu/perak/emas, TIDAK memakai coin-500 (itu terkunci khusus
// untuk "Strive Coins, hadiah" secara umum, bukan gradien tier liga secara
// spesifik) supaya kedua makna tidak tertukar secara visual.
const TIER_GRADIENT: Record<LeagueTier, string> = {
  bronze: 'linear-gradient(135deg, #CD7F32 0%, #8C5A2B 100%)',
  silver: 'linear-gradient(135deg, #E8E8E8 0%, #A8A8A8 100%)',
  gold: 'linear-gradient(135deg, #FFD700 0%, #B8860B 100%)',
};

export interface LeagueBadgeProps {
  tier: LeagueTier;
  className?: string;
}

/**
 * LeagueBadge — docs/PRD.md §14.4. Ikon medali dirender DI DALAM gradien
 * (dekoratif, `text-white` bawaan Tailwind — bukan token, tapi juga bukan
 * hex/arbitrary value — supaya glyph-nya kelihatan di ketiga gradien tanpa
 * menambah token warna baru); nama tier tetap ditulis sebagai teks biasa di
 * luar area gradien memakai `ink-900` supaya identitas tier terbaca AA di
 * kedua mode tanpa bergantung pada kontras di atas gradien yang variatif.
 */
export function LeagueBadge({ tier, className }: LeagueBadgeProps) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <span
        aria-hidden="true"
        className="flex size-9 shrink-0 items-center justify-center rounded-ctl shadow-sm"
        style={{ backgroundImage: TIER_GRADIENT[tier] }}
      >
        <Medal className="size-5 text-white drop-shadow-sm" />
      </span>
      <span className="font-display text-body font-semibold text-ink-900">{TIER_LABEL[tier]}</span>
    </span>
  );
}
