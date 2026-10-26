'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ApiError, createApiClient } from '@/lib/api-client';
import {
  KUNCI_BAGIAN,
  LABEL_BAGIAN,
  isiBagian,
  jalanGagal,
  jalanTiba,
  labGagal,
  labSiap,
  mulaiJalan,
  mulaiLab,
  muatDariRiwayat,
  pesanGalat,
  type LabState,
} from '@/lib/prompt-lab';

/**
 * Layar Prompt Lab — PL-01 (Dev B), PRD §7 E13. Formulir 5 bagian, jalankan
 * sinkron (⚡ kunci idempoten milik percobaan), riwayat berpasangan PL-6,
 * jalankan-ulang dari riwayat. Output dirender TEKS POLOS (interpolasi JSX —
 * tanpa dangerouslySetInnerHTML; isi keluaran LLM sepenuhnya dipengaruhi
 * input pengguna; catatan audit #239).
 */
export function PromptLabScreen() {
  const api = useMemo(
    () => createApiClient({ baseUrl: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001' }),
    [],
  );

  const [state, setState] = useState<LabState>(mulaiLab);
  const kunciRef = useRef<string | null>(null);

  useEffect(() => {
    const batal = new AbortController();
    Promise.all([
      api.getActivePricing({ signal: batal.signal }),
      api.promptLabHistory({ signal: batal.signal }),
    ])
      .then(([harga, riwayat]) =>
        setState((s) => labSiap(s, harga.prompt_run_cost_coins, riwayat.data)),
      )
      .catch(() => setState(labGagal('NETWORK')));
    return () => batal.abort();
  }, [api]);

  const jalankan = useCallback(() => {
    if (!kunciRef.current) kunciRef.current = crypto.randomUUID();
    setState((s) => mulaiJalan(s));
    api
      .runPromptLab(state.form, kunciRef.current)
      .then((res) => setState((s) => jalanTiba(s, res)))
      .catch((e: unknown) =>
        setState((s) => jalanGagal(s, e instanceof ApiError ? e.code : 'NETWORK')),
      )
      .finally(() => {
        kunciRef.current = null; // run berikut = percobaan baru
      });
  }, [api, state.form]);

  if (state.fase === 'memuat') return <Pesan teks="Memuat Prompt Lab…" />;
  if (state.fase === 'gagal')
    return <Pesan teks="Prompt Lab gagal dimuat. Muat ulang halaman untuk mencoba lagi." />;

  return (
    <div
      className="mx-auto flex w-full max-w-sm flex-col gap-3 px-4 pb-8 pt-2"
      data-testid="prompt-lab"
    >
      <header>
        <p className="font-mono text-label uppercase text-ink-500">Karir · Prompt Lab</p>
        <p className="mt-1 text-sm text-ink-500">
          Latih menyusun prompt terstruktur — {state.biaya ?? 20} koin per run.
          {state.saldo !== null ? ` Saldo kamu ${state.saldo.toLocaleString('id-ID')} koin.` : ''}
        </p>
      </header>

      <section className="rounded-card border border-line bg-background p-4">
        {KUNCI_BAGIAN.map((k) => (
          <div key={k} className="mb-3 last:mb-0">
            <label className="text-sm font-medium" htmlFor={`bagian-${k}`}>
              {LABEL_BAGIAN[k].label}
              <span className="ml-1 font-normal text-ink-500">· {LABEL_BAGIAN[k].bantu}</span>
            </label>
            <textarea
              id={`bagian-${k}`}
              className="mt-1 w-full rounded-ctl border border-line bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              rows={k === 'context' || k === 'constraints' ? 3 : 2}
              maxLength={2000}
              value={state.form[k]}
              onChange={(e) => setState((s) => isiBagian(s, k, e.target.value))}
              data-testid={`bagian-${k}`}
            />
          </div>
        ))}

        {state.galat ? (
          <p className="mt-2 text-sm text-flame-600" role="alert" data-testid="lab-galat">
            {pesanGalat(state.galat.code, state.biaya)}
          </p>
        ) : null}

        <button
          type="button"
          className="mt-3 rounded-ctl bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
          disabled={state.sedangJalan || KUNCI_BAGIAN.some((k) => state.form[k].trim() === '')}
          onClick={jalankan}
          data-testid="tombol-jalankan"
        >
          {state.sedangJalan ? 'Menjalankan…' : `Jalankan (${state.biaya ?? 20} koin)`}
        </button>
      </section>

      {state.hasil ? (
        <section
          className="rounded-card border border-line bg-background p-4"
          data-testid="hasil-run"
        >
          <p className="font-medium">Hasil</p>
          <p className="mt-2 whitespace-pre-wrap text-sm">{state.hasil.output}</p>
        </section>
      ) : null}

      <section
        className="rounded-card border border-line bg-background p-4"
        data-testid="riwayat-lab"
      >
        <p className="font-medium">Riwayat</p>
        {state.riwayat.length === 0 ? (
          <p className="mt-2 text-sm text-ink-500">
            Belum ada run. Susun prompt pertamamu di atas.
          </p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {state.riwayat.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  className="w-full rounded-ctl border border-line px-3 py-2 text-left text-sm hover:bg-line"
                  onClick={() => setState((s) => muatDariRiwayat(s, r))}
                  data-testid={`riwayat-${r.id.slice(0, 8)}`}
                >
                  <span className="block font-medium">{(r.structure.task ?? '').slice(0, 60)}</span>
                  <span className="mt-0.5 block text-ink-500">
                    {(r.output ?? '').slice(0, 80)}…
                  </span>
                  <span className="mt-0.5 block text-label text-ink-500">
                    {new Intl.DateTimeFormat('id-ID', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    }).format(new Date(r.created_at))}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
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
