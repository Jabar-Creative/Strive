'use client';

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

import type { CoinLedgerEntry } from '@strive/contracts';
import { CoinPill } from '@strive/ui';

import { ApiError, createApiClient } from '@/lib/api-client';
import {
  arahTampil,
  deskripsiBaris,
  formatAngka,
  formatWaktu,
  ledgerTiba,
  metaEntri,
  mulaiMuatLagi,
  mulaiWallet,
  muatLagiGagal,
  tampilTombolLagi,
  tampilTombolLengkap,
  walletGagal,
  walletTiba,
  type WalletState,
} from '@/lib/wallet-screen';

// Zona waktu PENGGUNA untuk jam riwayat koin (isu #182): dari perambannya
// sendiri — sumber yang benar untuk transaksi milik pengguna, tanpa request
// tambahan. Tak dikenal/kosong → `formatWaktu` jatuh ke default mesin
// (Asia/Jakarta).
const zonaPeramban = (() => {
  const z = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return typeof z === 'string' && z.length > 0 ? z : undefined;
})();

/**
 * Layar dompet — C-03 (Dev B), PRD §7 E4 + §10.3.
 *
 * Batas paling penting file ini (pola L-04): komponen TIDAK PERNAH
 * menghitung uang. Saldo, jumlah per entri, dan saldo-setelahnya hanya
 * dirender dari respons server (`balance`, `amount`, `balance_after`) —
 * kebenaran saldo ada di SUM(coin_ledger.amount) di server (CLAUDE.md
 * aturan 2). Seluruh aturan tampilan (fase, dedupe, tombol, kamus jenis
 * entri) hidup di mesin murni lib/wallet-screen.ts supaya teruji tanpa DOM.
 *
 * Gerak: Framer Motion lewat helper `gerak()` yang menjawab durasi 0 saat
 * prefers-reduced-motion (PRD §14.3 — animasi hanya dekoratif, data tetap).
 */
const T_BASE = 0.32; // cermin --t-base 320ms (§14.3)

/**
 * Kegagalan yang bukan ApiError (koneksi putus, DNS) tetap harus membawa
 * pengguna ke layar gagal — kode TAMPILAN sisi client, bukan kontrak §10.2
 * (pola galatJaringan L-04).
 */
function kodeGalat(e: unknown): string {
  return e instanceof ApiError ? e.code : 'NETWORK_ERROR';
}

/** Pesan galat dicabangkan pada `code` (kontrak), bukan message server. */
const PESAN_GALAT: Record<string, string> = {
  NETWORK_ERROR: 'Koneksi ke server terputus. Coba lagi.',
  UNAUTHENTICATED: 'Sesi kamu sudah berakhir. Silakan masuk lagi.',
  INVALID_CURSOR: 'Tautan riwayat kedaluwarsa. Muat ulang dari awal untuk melanjutkan.',
};

function pesanGalat(code: string): string {
  return PESAN_GALAT[code] ?? 'Terjadi kendala saat menghubungi server. Coba lagi.';
}

/** Tampilan chip arah: dekoratif (aria-hidden) karena label baris sudah menyebut maknanya. */
const CHIP_ARAH = {
  masuk: { simbol: '＋', kelas: 'bg-mint-500/15 text-mint-500' },
  keluar: { simbol: '−', kelas: 'bg-rose-500/15 text-rose-500' },
  tahan: { simbol: '◌', kelas: 'bg-coin-500/20 text-coin-500' },
} as const;

export function WalletScreen() {
  const reduksi = useReducedMotion();
  const api = useMemo(
    () => createApiClient({ baseUrl: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001' }),
    [],
  );

  const [state, setState] = useState<WalletState>(mulaiWallet);
  /** id entri yang sedang diperluas penjelasannya; null = semua tertutup. */
  const [terbuka, setTerbuka] = useState<string | null>(null);

  const gerak = useCallback((durasi: number) => ({ duration: reduksi ? 0 : durasi }), [reduksi]);

  const muat = useCallback(() => {
    setTerbuka(null);
    setState(mulaiWallet());
    api
      .getWallet()
      .then((data) => setState(walletTiba(data)))
      .catch((e: unknown) => setState(walletGagal(kodeGalat(e))));
  }, [api]);

  useEffect(muat, [muat]);

  const muatLedger = useCallback(() => {
    // Tombol disabled adalah lapis pertama; cek ini lapis kedua, dan mesin
    // (mulaiMuatLagi) lapis ketiga — klik ganda tidak boleh menembak dua
    // request ke /wallet/ledger.
    if (state.memuatLagi) return;
    setState((prev) => mulaiMuatLagi(prev));
    const params =
      state.sudahMuatLedger && state.cursorBerikutnya !== null
        ? { cursor: state.cursorBerikutnya }
        : {};
    api
      .getWalletLedger(params)
      .then((data) => setState((prev) => ledgerTiba(prev, data)))
      .catch((e: unknown) => setState((prev) => muatLagiGagal(prev, kodeGalat(e))));
  }, [api, state.memuatLagi, state.sudahMuatLedger, state.cursorBerikutnya]);

  if (state.fase === 'memuat') {
    return (
      <PesanKosong judul="Memuat dompet…" teks="Sebentar, saldo dan riwayat sedang disiapkan." />
    );
  }

  if (state.fase === 'gagal' && state.galat) {
    const sesiHabis = state.galat.code === 'UNAUTHENTICATED';
    return (
      <PesanKosong
        judul={sesiHabis ? 'Sesi berakhir' : 'Dompet gagal dimuat'}
        teks={pesanGalat(state.galat.code)}
        kode={state.galat.code}
        aksi={
          sesiHabis ? (
            <Link
              className="min-h-12 rounded-ctl border border-line px-4 py-3 text-center text-body hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              href="/login"
            >
              Masuk lagi
            </Link>
          ) : (
            <TombolUtama onClick={muat}>Coba lagi</TombolUtama>
          )
        }
      />
    );
  }

  if (state.fase === 'kosong') {
    return (
      <div className="mx-auto flex w-full max-w-sm flex-col gap-4 px-4 pb-8 pt-4">
        <SaldoKartu saldo={state.saldo} />
        <PesanKosong
          judul="Dompet kamu masih kosong"
          teks="Selesaikan kartu lesson dan jaga streak harian untuk mengumpulkan Strive Coins."
          aksi={
            <Link className="text-primary underline-offset-4 hover:underline" href="/learn">
              Mulai belajar
            </Link>
          }
        />
      </div>
    );
  }

  const lagi = state.memuatLagi;

  return (
    <div
      className="mx-auto flex w-full max-w-sm flex-col gap-4 px-4 pb-8 pt-4"
      data-reduced-motion={reduksi ? 'ya' : 'tidak'}
    >
      <header>
        <p className="font-mono text-label uppercase text-ink-500">Dompet</p>
      </header>

      <SaldoKartu saldo={state.saldo} />

      <ul className="overflow-hidden rounded-card border border-line bg-background">
        {state.entri.map((e) => (
          <BarisEntri
            entri={e}
            key={e.id}
            gerak={gerak}
            onToggle={() => setTerbuka((prev) => (prev === e.id ? null : e.id))}
            reduksi={reduksi}
            terbuka={terbuka === e.id}
          />
        ))}
      </ul>

      {state.galat ? (
        <div className="rounded-card border border-rose-500/30 bg-rose-500/10 p-3" role="alert">
          <p className="text-sm">Riwayat berikutnya gagal dimuat. {pesanGalat(state.galat.code)}</p>
          <p className="mt-1 font-mono text-xs text-ink-500">code: {state.galat.code}</p>
          <button
            className="mt-2 text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            onClick={muat}
            type="button"
          >
            Muat ulang dari awal
          </button>
        </div>
      ) : null}

      {tampilTombolLengkap(state) ? (
        <button
          className="min-h-12 w-full rounded-ctl border border-line bg-background px-4 text-body transition-colors hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-60"
          data-testid="dompet-muat-lengkap"
          disabled={lagi}
          onClick={muatLedger}
          type="button"
        >
          {lagi ? 'Memuat…' : 'Muat riwayat lengkap'}
        </button>
      ) : null}

      {tampilTombolLagi(state) ? (
        <button
          className="min-h-12 w-full rounded-ctl border border-line bg-background px-4 text-body transition-colors hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-60"
          data-testid="dompet-muat-lagi"
          disabled={lagi}
          onClick={muatLedger}
          type="button"
        >
          {lagi ? 'Memuat…' : 'Muat lagi'}
        </button>
      ) : null}

      <p className="text-center text-xs text-ink-500">
        Setiap baris bisa diketuk untuk penjelasan jenis entrinya. Lambang tahan berarti koin
        dikunci sementara, bukan hilang.
      </p>
    </div>
  );
}

/** Kartu saldo: komposisi token sendiri yang menaungi CoinPill (variant balance). */
function SaldoKartu({ saldo }: { saldo: number }) {
  return (
    <section className="rounded-card border border-line bg-background p-4">
      <p className="font-mono text-label uppercase text-ink-500">Saldo kamu</p>
      <div className="mt-2" data-testid="dompet-saldo">
        <CoinPill amount={saldo} className="px-4 py-1.5" />
      </div>
      <p className="mt-2 text-xs text-ink-500">Terpakai untuk scan, store, dan fitur AI.</p>
    </section>
  );
}

/**
 * Satu baris riwayat: tombol asli (bisa diketuk keyboard + screen reader)
 * yang memperluas penjelasan jenis entri. Angka kanan semuanya dari server.
 */
function BarisEntri({
  entri,
  terbuka,
  onToggle,
  reduksi,
  gerak,
}: {
  entri: CoinLedgerEntry;
  terbuka: boolean;
  onToggle: () => void;
  reduksi: boolean | null;
  gerak: (durasi: number) => { duration: number };
}) {
  const meta = metaEntri(entri.entry_type);
  const chip = CHIP_ARAH[arahTampil(entri)];

  return (
    <motion.li
      animate={{ opacity: 1, y: 0 }}
      className="border-t border-line first:border-t-0"
      data-testid="dompet-entri"
      initial={reduksi ? false : { opacity: 0, y: 4 }}
      transition={gerak(T_BASE)}
    >
      <button
        aria-expanded={terbuka}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        onClick={onToggle}
        type="button"
      >
        <span
          aria-hidden="true"
          className={`flex size-9 shrink-0 items-center justify-center rounded-full text-data font-semibold ${chip.kelas}`}
        >
          {chip.simbol}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body font-medium">{meta.label}</span>
          <span className="block truncate text-xs text-ink-500">
            {deskripsiBaris(entri)} · {formatWaktu(entri.created_at, zonaPeramban)}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-0.5">
          <CoinPill amount={entri.amount} variant="delta" />
          <span className="text-xs text-ink-500 tabular-nums">
            saldo {formatAngka(entri.balance_after)}
          </span>
        </span>
      </button>
      <AnimatePresence initial={false}>
        {terbuka ? (
          <motion.div
            animate={{ height: 'auto', opacity: 1 }}
            className="overflow-hidden"
            exit={{ height: 0, opacity: 0 }}
            initial={{ height: 0, opacity: 0 }}
            transition={gerak(T_BASE)}
          >
            <p className="px-4 pb-3 text-sm text-ink-500">
              <span className="font-medium text-ink-900">{meta.label}:</span> {meta.alasan}
            </p>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.li>
  );
}

/** EmptyState/ErrorState inline untuk layar ini (PRD §14.4: tak ada layar kosong tanpa cerita). */
function PesanKosong({
  judul,
  teks,
  kode,
  aksi,
}: {
  judul: string;
  teks: string;
  kode?: string;
  aksi?: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-sm flex-col items-center gap-2 px-4 py-16 text-center">
      <p className="font-medium">{judul}</p>
      <p className="text-sm text-ink-500">{teks}</p>
      {kode ? <p className="font-mono text-xs text-ink-500">code: {kode}</p> : null}
      {aksi ? <div className="mt-2">{aksi}</div> : null}
    </div>
  );
}

function TombolUtama({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      className="min-h-12 rounded-ctl bg-primary px-6 font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}
