import { Flame, Frown, Snowflake, TriangleAlert } from 'lucide-react';
import { cn } from '../lib/utils';
import { Pill } from '../primitives/pill';

/** docs/PRD.md §14.4 — empat status streak. */
export type StreakStatus = 'active' | 'at_risk' | 'frozen' | 'broken';

interface StreakStatusSpec {
  label: string;
  Icon: typeof Flame;
  /** Border + wash latar di atas shell `Pill` (lihat komentar pill.tsx). */
  containerClassName: string;
  /**
   * Warna IKON saja — bukan teks. Dihitung ulang (rumus WCAG sama seperti
   * /_specimen): flame-500 sebagai teks di atas latar terang cuma ~2,8:1,
   * jauh di bawah AA 4,5:1. Label teks selalu `ink-900` (default `Pill`,
   * lihat komentar di sana) supaya tetap terbaca; ikon boleh tetap ditintai
   * karena statusnya SUDAH disebut lewat teks, ikon di sini dekoratif/
   * penguat, bukan satu-satunya penanda.
   *
   * `active` adalah SATU-SATUNYA status yang memakai flame-500 — docs/PRD.md
   * §14.1 mengunci token itu khusus untuk streak, dan status lain (at_risk,
   * frozen, broken) sengaja netral (ink-900/ink-500) supaya flame-500 tetap
   * berarti satu hal: "streak sedang menyala hari ini".
   */
  iconClassName: string;
}

// `broken` TIDAK PERNAH memakai rose/merah (PRD eksplisit): "streak putus itu
// kekecewaan, bukan kesalahan" — makanya ikonnya Frown (kecewa), bukan X/error,
// dan warnanya netral, sama seperti frozen.
const STATUS: Record<StreakStatus, StreakStatusSpec> = {
  active: {
    label: 'Streak aktif',
    Icon: Flame,
    containerClassName: 'border-flame-500/30 bg-flame-500/15',
    iconClassName: 'text-flame-500',
  },
  at_risk: {
    label: 'Streak berisiko',
    Icon: TriangleAlert,
    containerClassName: 'border-ink-500/40 bg-ink-500/10',
    iconClassName: 'text-ink-900',
  },
  frozen: {
    label: 'Streak dibekukan',
    Icon: Snowflake,
    containerClassName: 'border-line bg-surface',
    iconClassName: 'text-ink-500',
  },
  broken: {
    label: 'Streak terhenti',
    Icon: Frown,
    containerClassName: 'border-line bg-surface',
    iconClassName: 'text-ink-500',
  },
};

export interface StreakChipProps {
  status: StreakStatus;
  /** Jumlah hari streak berjalan (opsional — mis. tidak relevan untuk `broken`). */
  days?: number;
  className?: string;
}

/**
 * StreakChip — docs/PRD.md §14.4. Status disampaikan lewat ikon + label teks
 * SEKALIGUS warna (bukan warna saja) supaya tetap jelas bagi pengguna
 * buta warna — konsisten dengan PRD §14.5 dan heuristik "jangan andalkan
 * warna sebagai satu-satunya penanda".
 */
export function StreakChip({ status, days, className }: StreakChipProps) {
  const spec = STATUS[status];
  const { Icon } = spec;
  const daysLabel = typeof days === 'number' ? ` — ${days} hari` : '';

  return (
    <Pill
      tone="neutral"
      role="status"
      aria-label={`Status streak: ${spec.label}${daysLabel}`}
      className={cn(spec.containerClassName, className)}
    >
      <Icon aria-hidden="true" className={cn('size-4', spec.iconClassName)} />
      <span>
        {spec.label}
        {typeof days === 'number' ? (
          <span className="ml-1 font-mono tabular-nums">{days} hari</span>
        ) : null}
      </span>
    </Pill>
  );
}
