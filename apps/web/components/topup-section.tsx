'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ApiError, createApiClient } from '@/lib/api-client';
import {
  checkoutGagal,
  checkoutTiba,
  detikBerlalu,
  mulaiTopup,
  orderTiba,
  paketGagal,
  paketTiba,
  pilihPaket,
  type TopupState,
  urlSnapAman,
} from '@/lib/topup';

/**
 * Seksi top-up di layar dompet — P-04 (PRD §7 E6 + §6.3).
 *
 * Komponen hanya: fetch, tick, dan memanggil transisi mesin `lib/topup`
 * (teruji unit, jam tidak pernah hidup di mesin). Checkout membuka Snap
 * HOSTED di tab baru (redirect_url) — tidak ada halaman pembayaran sendiri
 * (keputusan "beli, jangan bangun"). Setelah kembali, polling status order
 * berjalan dengan BATAS WAKTU: habis → pesan tenggang yang jelas, bukan
 * layar yang menggantung selamanya.
 */

const DETIK_POLL_ORDER = 5;

const rupiah = (idr: number) =>
  new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(idr);

export function TopupSection({ onKoinMasuk }: { onKoinMasuk?: () => void }) {
  const api = useMemo(
    () => createApiClient({ baseUrl: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001' }),
    [],
  );

  const [state, setState] = useState<TopupState>(mulaiTopup);
  // Kunci idempoten MILIK PERCOBAAN (PA-3): retry percobaan yang sama kunci
  // sama; memilih paket lagi/percobaan baru → kunci baru.
  const kunciRef = useRef<string | null>(null);

  useEffect(() => {
    const batal = new AbortController();
    api
      .getActivePricing({ signal: batal.signal })
      .then((res) => setState((s) => paketTiba(s, res)))
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        setState((s) => paketGagal(s, e instanceof ApiError ? e.code : 'NETWORK'));
      });
    return () => batal.abort();
  }, [api]);

  // Tick 1 detik hanya saat menunggu — memajukan hitungan batas waktu.
  useEffect(() => {
    if (state.fase !== 'menunggu') return;
    const t = setInterval(() => setState((s) => detikBerlalu(s)), 1_000);
    return () => clearInterval(t);
  }, [state.fase]);

  // Polling status order tiap 5 detik hanya saat menunggu.
  useEffect(() => {
    if (state.fase !== 'menunggu' || !state.order) return;
    const orderId = state.order.id;
    const t = setInterval(() => {
      void api
        .getOrder(orderId)
        .then((res) => setState((s) => orderTiba(s, res)))
        .catch(() => undefined); // gagal poll sesaat ≠ layar galat; tick berikut mencoba lagi
    }, DETIK_POLL_ORDER * 1_000);
    return () => clearInterval(t);
  }, [api, state.fase, state.order]);

  // Efek samping "order lunas" hidup di EFFECT, bukan di updater state:
  // memanggil setState komponen lain dari dalam updater adalah pembaruan
  // saat render — React menolaknya dan di dev menimpa pembaruan order
  // (ketemu via console error saat verifikasi browser, bukan tebakan).
  // Snap hosted dibuka SEKALI saat redirectUrl pertama tiba — efek samping
  // di effect, bukan di updater state (StrictMode menjalankan updater dua
  // kali; window.open di sana membuka dua tab — temuan audit P-04). Pengguna
  // kembali ke tab ini setelah bayar; polling yang menentukan nasib order
  // (PA-5: koin hanya dari webhook).
  const snapSudahDibukaRef = useRef(false);
  useEffect(() => {
    if (
      state.fase === 'menunggu' &&
      !snapSudahDibukaRef.current &&
      urlSnapAman(state.redirectUrl)
    ) {
      snapSudahDibukaRef.current = true;
      window.open(state.redirectUrl, '_blank', 'noopener');
    }
  }, [state.fase, state.redirectUrl]);

  const koinMasukRef = useRef(onKoinMasuk);
  koinMasukRef.current = onKoinMasuk;
  useEffect(() => {
    if (state.fase === 'berhasil') koinMasukRef.current?.();
  }, [state.fase]);

  const bayar = useCallback(() => {
    if (!state.terpilih) return;
    if (!kunciRef.current) kunciRef.current = crypto.randomUUID();
    setState((s) => ({ ...s, galat: null }));
    api
      .checkoutTopup(state.terpilih, kunciRef.current)
      .then((res) => setState((s) => checkoutTiba(s, res)))
      .catch((e: unknown) => {
        setState((s) => checkoutGagal(s, e instanceof ApiError ? e.code : 'NETWORK'));
      });
  }, [api, state.terpilih]);

  const pilih = useCallback((code: string) => {
    kunciRef.current = null; // percobaan baru
    setState((s) => pilihPaket(s, code));
  }, []);

  if (state.fase === 'memuat') {
    return (
      <section
        className="rounded-card border border-line bg-background p-4"
        data-testid="topup-memuat"
      >
        <p className="text-sm text-ink-500">Memuat paket top-up…</p>
      </section>
    );
  }

  if (state.fase === 'gagal') {
    return (
      <section
        className="rounded-card border border-line bg-background p-4"
        data-testid="topup-gagal"
      >
        <p className="font-medium">Paket top-up belum bisa dimuat</p>
        <p className="mt-1 text-sm text-ink-500" data-testid="topup-galat">
          {state.galat?.code === 'PRICING_NOT_CONFIGURED'
            ? 'Harga paket belum diterbitkan — coba lagi nanti.'
            : 'Jaringan bermasalah. Muat ulang halaman untuk mencoba lagi.'}
        </p>
      </section>
    );
  }

  if (state.fase === 'menunggu' && state.order) {
    const mnt = Math.floor(state.sisaDetik / 60);
    const dtk = state.sisaDetik % 60;
    return (
      <section
        className="rounded-card border border-line bg-background p-4"
        data-testid="topup-menunggu"
      >
        <p className="font-medium">Menunggu pembayaran</p>
        <p className="mt-1 text-sm text-ink-500">
          {state.order.coins.toLocaleString('id-ID')} koin · {rupiah(state.order.amountIdr)} —
          selesaikan QRIS di tab Midtrans yang terbuka.
        </p>
        <p className="mt-2 font-mono text-sm tabular-nums" data-testid="topup-hitungan">
          Batas waktu {mnt}:{String(dtk).padStart(2, '0')}
        </p>
        {urlSnapAman(state.redirectUrl) ? (
          <button
            type="button"
            className="mt-2 rounded-ctl border border-line px-3 py-1.5 text-sm hover:bg-line"
            onClick={() => {
              if (urlSnapAman(state.redirectUrl))
                window.open(state.redirectUrl, '_blank', 'noopener');
            }}
          >
            Buka halaman bayar lagi
          </button>
        ) : null}
      </section>
    );
  }

  if (state.fase === 'tenggang') {
    return (
      <section
        className="rounded-card border border-line bg-background p-4"
        data-testid="topup-tenggang"
      >
        <p className="font-medium">Waktu pembayaran habis</p>
        <p className="mt-1 text-sm text-ink-500">
          Order ini berhenti diiputi. Kalau kamu belum membayarnya, ia kedaluwarsa sendiri dalam 24
          jam — kalau sudah, koin masuk otomatis lewat notifikasi pembayaran dan saldo dompet
          menyusul.
        </p>
      </section>
    );
  }

  if (state.fase === 'selesai-gagal') {
    return (
      <section
        className="rounded-card border border-line bg-background p-4"
        data-testid="topup-gagal-order"
      >
        <p className="font-medium">Pembayaran tidak selesai</p>
        <p className="mt-1 text-sm text-ink-500">
          Status order: {state.statusAkhir}. Tidak ada koin yang terpotong — kamu bisa mencoba lagi.
        </p>
      </section>
    );
  }

  if (state.fase === 'berhasil') {
    return (
      <section
        className="rounded-card border border-line bg-background p-4"
        data-testid="topup-berhasil"
      >
        <p className="font-medium">Top-up berhasil 🎉</p>
        <p className="mt-1 text-sm text-ink-500">
          {(state.koinMasuk ?? 0).toLocaleString('id-ID')} koin masuk ke dompetmu.
        </p>
      </section>
    );
  }

  // fase 'siap' — pilih paket
  return (
    <section className="rounded-card border border-line bg-background p-4" data-testid="topup-siap">
      <p className="font-medium">Isi koin</p>
      <div className="mt-3 grid gap-2">
        {state.paket.map((p) => (
          <label
            key={p.id}
            className="flex cursor-pointer items-center justify-between gap-3 rounded-ctl border border-line px-3 py-2 text-sm has-[:checked]:bg-line"
          >
            <span className="flex items-center gap-2">
              <input
                type="radio"
                name="paket-topup"
                value={p.id}
                checked={state.terpilih === p.id}
                onChange={() => pilih(p.id)}
              />
              <span>
                <span className="font-medium">{p.name}</span> · {p.coins.toLocaleString('id-ID')}{' '}
                koin
              </span>
            </span>
            <span className="tabular-nums">{rupiah(p.price_idr)}</span>
          </label>
        ))}
      </div>
      {state.galat ? (
        <p className="mt-2 text-sm text-flame-600" role="alert" data-testid="topup-galat-checkout">
          Pembayaran belum bisa dimulai ({state.galat.code}) — coba lagi nanti.
        </p>
      ) : null}
      <button
        type="button"
        className="mt-3 rounded-ctl bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
        disabled={!state.terpilih}
        onClick={bayar}
        data-testid="tombol-bayar"
      >
        Lanjut bayar
      </button>
      <p className="mt-2 text-xs text-ink-500">
        Pembayaran QRIS lewat Midtrans — halaman bayar terbuka di tab baru.
      </p>
    </section>
  );
}
