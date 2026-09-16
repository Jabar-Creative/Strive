import { Coins } from 'lucide-react';
import { cn } from '../lib/utils';
import { Pill } from '../primitives/pill';

export type CoinPillVariant = 'balance' | 'delta';

export interface CoinPillProps {
  /**
   * Nilai koin. Untuk `variant="delta"`, tanda (+/-) MENENTUKAN warna dan
   * prefiks tampilan — cocok langsung dengan `coin_ledger.amount` (positif =
   * earn, negatif = spend), jadi pemanggil tidak perlu konversi tanda
   * sendiri. Untuk `variant="balance"` (default), nilai negatif tetap
   * ditampilkan apa adanya (edge case saldo negatif seharusnya tidak pernah
   * terjadi kalau CoinLedgerService benar, tapi komponen ini tidak
   * menyembunyikannya).
   */
  amount: number;
  variant?: CoinPillVariant;
  className?: string;
}

/** Format ribuan gaya Indonesia — "1.250", bukan "1,250". */
const THOUSANDS_FORMATTER = new Intl.NumberFormat('id-ID');

/**
 * CoinPill — docs/PRD.md §14.4. `font-mono tabular-nums` WAJIB (PRD §14.2:
 * "Data/angka: JetBrains Mono, tabular-nums") supaya kolom angka di daftar
 * (mis. riwayat ledger) rata secara visual.
 *
 * `coin-500` dipakai HANYA untuk varian `balance` (saldo) — sesuai makna
 * tunggalnya di docs/PRD.md §14.1 ("Strive Coins, hadiah, liga Gold"). Delta
 * positif/negatif memakai `success`/`danger` dari `Pill` (mint-500/rose-500),
 * bukan coin-500, karena maknanya di situ adalah "bertambah/berkurang", bukan
 * "ini koin" — dan mint-500/rose-500 memang sudah dikunci untuk makna itu.
 */
export function CoinPill({ amount, variant = 'balance', className }: CoinPillProps) {
  const isDelta = variant === 'delta';
  const sign = isDelta ? (amount > 0 ? '+' : amount < 0 ? '-' : '') : amount < 0 ? '-' : '';
  const formatted = THOUSANDS_FORMATTER.format(Math.abs(amount));

  const tone = isDelta ? (amount < 0 ? 'danger' : 'success') : 'neutral';
  const iconClassName = isDelta
    ? amount < 0
      ? 'text-rose-500'
      : 'text-mint-500'
    : 'text-coin-500';

  const label = isDelta
    ? `${amount >= 0 ? 'Tambahan' : 'Pengurangan'} ${formatted} Strive Coins`
    : `Saldo ${formatted} Strive Coins`;

  return (
    <Pill
      tone={tone}
      className={cn(!isDelta && 'border-coin-500/30 bg-coin-500/15 text-ink-900', className)}
      aria-label={label}
    >
      <Coins aria-hidden="true" className={cn('size-4', iconClassName)} />
      <span className="font-mono text-data tabular-nums">
        {sign}
        {formatted}
      </span>
    </Pill>
  );
}
