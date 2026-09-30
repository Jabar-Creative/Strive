'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  ApiError,
  createApiClient,
  type ModuleDetailResponse,
  type TrackDetailResponse,
  type TrackSummaryResponse,
} from '@/lib/api-client';

/**
 * Layar daftar track & progres — L-05 (Dev B), PRD §7 E2 LE-9.
 *
 * AC layar ini ada di KEDUA sisi "akurat": progres TIDAK PERNAH dihitung
 * atau disimpan di sini (server menghitung dari lesson DISTINCT), dan
 * pengambilannya TIDAK PERNAH menajwab dari cache:
 *
 * 1. "Setelah refresh" — fetch biasa saat mount, `cache: 'no-store'` di
 *    lapis request klien.
 * 2. "Setelah menyelesaikan lesson di tab lain" — pengambilan ULANG saat
 *    tab kembali terlihat (visibilitychange + focus). Mengerjakan lesson
 *    di tab kedua lalu kembali ke tab ini harus menaikkan progres TANPA
 *    refresh manual; kalau halaman diam, pengguna akan menyimpulkan
 *    progresnya hilang.
 */

type Fase = 'memuat' | 'gagal' | 'siap';

export function TrackList() {
  const api = useMemo(
    () => createApiClient({ baseUrl: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001' }),
    [],
  );

  const [fase, setFase] = useState<Fase>('memuat');
  const [galat, setGalat] = useState<ApiError | null>(null);
  const [tracks, setTracks] = useState<TrackSummaryResponse[]>([]);
  const [terpilih, setTerpilih] = useState<TrackDetailResponse | null>(null);
  const [memuatDetail, setMemuatDetail] = useState(false);

  const muat = useCallback(
    (sinyal?: AbortSignal) => {
      api
        .listTracks({ signal: sinyal })
        .then((data) => {
          setTracks(data);
          setFase('siap');
        })
        .catch((e: unknown) => {
          if (e instanceof DOMException && e.name === 'AbortError') return;
          setGalat(e instanceof ApiError ? e : galatJaringan());
          setFase('gagal');
        });
    },
    [api],
  );

  useEffect(() => {
    // Abort saat unmount menutup race "respons tiba setelah pindah layar".
    const batal = new AbortController();
    muat(batal.signal);
    return () => batal.abort();
  }, [muat]);

  // AC kedua: pengambilan ulang saat tab kembali terlihat. Dua event,
  // bukan satu: `visibilitychange` untuk pindah tab, `focus` untuk pindah
  // jendela — keduanya murah dan idempoten.
  useEffect(() => {
    const ulang = () => {
      if (document.visibilityState === 'visible') muat();
    };
    document.addEventListener('visibilitychange', ulang);
    window.addEventListener('focus', ulang);
    return () => {
      document.removeEventListener('visibilitychange', ulang);
      window.removeEventListener('focus', ulang);
    };
  }, [muat]);

  const bukaTrack = useCallback(
    (trackId: string) => {
      if (terpilih?.id === trackId) {
        setTerpilih(null); // ketuk ulang = tutup
        return;
      }
      setMemuatDetail(true);
      api
        .getTrack(trackId)
        .then((detail) => {
          setTerpilih(detail);
          setMemuatDetail(false);
        })
        .catch(() => setMemuatDetail(false));
    },
    [api, terpilih],
  );

  if (fase === 'memuat') {
    return <Pesan judul="Memuat track…" teks="Sebentar, daftar track sedang disiapkan." />;
  }

  if (fase === 'gagal' && galat) {
    return (
      <Pesan
        judul="Daftar track gagal dimuat"
        teks={galat.message}
        kode={galat.code}
        aksi={
          <button type="button" onClick={() => muat()} className={KELAS_TOMBOL}>
            Coba lagi
          </button>
        }
      />
    );
  }

  if (tracks.length === 0) {
    return (
      <Pesan judul="Belum ada track" teks="Konten belajar belum diterbitkan. Coba kembali nanti." />
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-3 px-4 pb-8 pt-2">
      <ul className="flex flex-col gap-3">
        {tracks.map((t) => (
          <li key={t.id}>
            <button
              type="button"
              onClick={() => bukaTrack(t.id)}
              aria-expanded={terpilih?.id === t.id}
              className="w-full rounded-card border border-line bg-background p-4 text-left transition-colors hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium">{t.title}</span>
                {t.category ? (
                  <span className="font-mono text-label uppercase text-ink-500">{t.category}</span>
                ) : null}
              </div>
              {t.description ? <p className="mt-1 text-sm text-ink-500">{t.description}</p> : null}
              <BarProgres
                selesai={t.progress.completedLessons}
                total={t.progress.totalLessons}
                persen={t.progress.percent}
              />
            </button>

            {terpilih?.id === t.id ? <DetailTrack detail={terpilih} /> : null}
            {memuatDetail ? <p className="px-1 pt-2 text-sm text-ink-500">Memuat modul…</p> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function DetailTrack({ detail }: { detail: TrackDetailResponse }) {
  return (
    <div
      className="mt-2 rounded-card border border-dashed border-line p-3"
      data-testid="detail-track"
    >
      <BarProgres
        selesai={detail.progress.completedLessons}
        total={detail.progress.totalLessons}
        persen={detail.progress.percent}
      />
      {detail.modules.map((m: ModuleDetailResponse) => (
        <section key={m.id} className="mt-3">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="text-sm font-medium">{m.title}</h3>
            <span className="font-mono text-label text-ink-500 tabular-nums">
              {m.progress.completedLessons}/{m.progress.totalLessons}
            </span>
          </div>
          <ul className="mt-1 flex flex-col gap-1">
            {m.lessons.map((l) => (
              <li key={l.id}>
                <Link
                  href={`/learn/lesson/${l.id}`}
                  className="flex min-h-12 items-center justify-between gap-2 rounded-ctl px-3 py-2 text-sm transition-colors hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  <span className={l.completed ? 'text-ink-500 line-through' : ''}>{l.title}</span>
                  <span className="font-mono text-label text-ink-500 tabular-nums">
                    {l.completed ? '✓' : `${Math.round(l.estSeconds / 60)} mnt`}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function BarProgres({
  selesai,
  total,
  persen,
}: {
  selesai: number;
  total: number;
  persen: number;
}) {
  return (
    <div className="mt-3 flex items-center gap-2">
      <div
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-line"
        role="progressbar"
        aria-valuenow={persen}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${selesai} dari ${total} lesson selesai`}
      >
        {/* width dari persen SERVER — bukan dihitung ulang di sini. */}
        <div className="h-full bg-primary" style={{ width: `${persen}%` }} />
      </div>
      <span className="font-mono text-label text-ink-500 tabular-nums" data-testid="progres">
        {selesai}/{total}
      </span>
    </div>
  );
}

function galatJaringan() {
  return new ApiError('NETWORK_ERROR', 0, 'Koneksi ke server terputus. Coba lagi.');
}

const KELAS_TOMBOL =
  'min-h-12 rounded-ctl bg-primary px-6 font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

function Pesan({
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
