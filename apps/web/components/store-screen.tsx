'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ApiError, createApiClient } from '@/lib/api-client';
import {
  beliGagal,
  beliTiba,
  itemsGagal,
  itemsTiba,
  labelJenisStore,
  mulaiBeli,
  mulaiStore,
  unduhGagal,
  type StoreState,
} from '@/lib/store-screen';

/**
 * Etalase Strive Store — ST-02 (PRD §7 E14). Komponen hanya fetch + buka URL;
 * seluruh keputusan tampilan ada di mesin `lib/store-screen` (teruji unit).
 * Unduhan membuka signed URL 15 menit dari server (SR-5) — `asset_key`
 * tidak pernah sampai ke klien.
 */

export function StoreScreen() {
  const api = useMemo(
    () => createApiClient({ baseUrl: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001' }),
    [],
  );

  const [state, setState] = useState<StoreState>(mulaiStore);
  const kunciRef = useRef<string | null>(null);

  useEffect(() => {
    const batal = new AbortController();
    api
      .listStoreItems({ signal: batal.signal })
      .then((items) => setState(itemsTiba(items)))
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        setState(itemsGagal(e instanceof ApiError ? e.code : 'NETWORK'));
      });
    return () => batal.abort();
  }, [api]);

  const beli = useCallback(
    (itemId: string) => {
      if (!kunciRef.current) kunciRef.current = crypto.randomUUID();
      setState((s) => mulaiBeli(s, itemId));
      api
        .purchaseStoreItem(itemId, kunciRef.current)
        .then((res) => setState((s) => beliTiba(s, itemId, res)))
        .catch((e: unknown) => {
          const kode = e instanceof ApiError ? e.code : 'NETWORK';
          setState((s) => beliGagal(s, itemId, kode, kode === 'ALREADY_PURCHASED'));
        });
    },
    [api],
  );

  const unduh = useCallback(
    (purchaseId: string) => {
      // Buka jendela SEBELUM fetch (aktifasi pengguna): popup blocker memakai
      // klik sebagai izin, dan fetch yang menunggu signed URL bisa lebih lama
      // dari usia izin itu. Jendela diarahkan belakangan.
      const jendela = window.open('', '_blank');
      api
        .storeDownload(purchaseId)
        .then((res) => {
          if (jendela) jendela.location.href = res.url;
          else window.open(res.url, '_blank', 'noopener'); // pemblokir popup: cadangan
        })
        .catch((e: unknown) => {
          jendela?.close();
          setState((s) => unduhGagal(s, e instanceof ApiError ? e.code : 'NETWORK'));
        });
    },
    [api],
  );

  if (state.fase === 'memuat') return <Pesan teks="Memuat etalase…" />;
  if (state.fase === 'gagal')
    return (
      <Pesan
        teks={
          state.galat?.code === 'UNAUTHENTICATED'
            ? 'Masuk dulu untuk melihat etalase.'
            : 'Etalase gagal dimuat. Muat ulang halaman untuk mencoba lagi.'
        }
      />
    );

  return (
    <div
      className="mx-auto flex w-full max-w-sm flex-col gap-3 px-4 pb-8 pt-2"
      data-testid="etalase"
    >
      <header>
        <p className="font-mono text-label uppercase text-ink-500">Store</p>
        {state.saldo !== null ? (
          <p className="mt-1 text-sm text-ink-500" data-testid="store-saldo">
            Saldo kamu {state.saldo.toLocaleString('id-ID')} koin
          </p>
        ) : null}
      </header>

      {state.galat ? (
        <p
          className="rounded-card border border-line bg-background p-3 text-sm"
          role="alert"
          data-testid="store-galat"
        >
          {state.galat.code === 'INSUFFICIENT_COINS'
            ? 'Koin belum cukup — isi lewat menu Dompet, atau selesaikan lesson untuk mengumpulkan.'
            : `Pembelian belum bisa diproses (${state.galat.code}). Coba lagi sebentar.`}
        </p>
      ) : null}
      {state.unduhGagal ? (
        <p className="rounded-card border border-line bg-background p-3 text-sm" role="alert">
          Unduhan belum bisa dibuka ({state.unduhGagal}). Coba lagi — tautan berumur 15 menit.
        </p>
      ) : null}

      <ul className="flex flex-col gap-2">
        {state.items.map((i) => (
          <li
            key={i.id}
            className="rounded-card border border-line bg-background p-4"
            data-testid={`item-${i.slug}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-label text-ink-500">{labelJenisStore[i.kind]}</p>
                <p className="mt-0.5 font-medium">{i.title}</p>
              </div>
              <p className="font-mono text-sm tabular-nums" data-testid={`harga-${i.slug}`}>
                {i.price_coins.toLocaleString('id-ID')} koin
              </p>
            </div>
            <div className="mt-3">
              {i.owned ? (
                <button
                  type="button"
                  className="rounded-ctl border border-line px-3 py-1.5 text-sm hover:bg-line"
                  onClick={() => i.purchase_id && unduh(i.purchase_id)}
                  data-testid={`unduh-${i.slug}`}
                >
                  Unduh
                </button>
              ) : (
                <button
                  type="button"
                  className="rounded-ctl bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
                  disabled={state.sedangBeli !== null}
                  onClick={() => {
                    kunciRef.current = null; // percobaan baru
                    beli(i.id);
                  }}
                  data-testid={`beli-${i.slug}`}
                >
                  {state.sedangBeli === i.id ? 'Membeli…' : 'Beli'}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Pesan({ teks }: { teks: string }) {
  return (
    <div className="mx-auto w-full max-w-sm px-4 py-10 text-center text-sm text-ink-500">
      {teks}
    </div>
  );
}
