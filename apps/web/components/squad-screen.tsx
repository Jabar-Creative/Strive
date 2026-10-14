'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ApiError, createApiClient } from '@/lib/api-client';
import {
  buatPapanLive,
  buatSoketSquad,
  type ModePapan,
} from '@/lib/leaderboard-live';
import type { SquadInfo, SquadMember } from '@/lib/api-client';

/**
 * Layar squad & papan mingguan — Q-05 (Dev B), PRD §7 E5 + RT-5.
 *
 * Pembagian tugas:
 * - Data squad (nama, tier, musim) dari GET /squads/me SEKALI — itu fakta
 *   yang lambat berubah.
 * - Papan mingguan dari GET /squads/:id/leaderboard, disegarkan mesin
 *   leaderboard-live: WS `score.updated` bila bisa, polling 30 dtk bila
 *   tidak. `score.updated` hanya PEMBERITAHU refetch — tidak membawa angka.
 * - Indikator mode ditampilkan jujur ke pengguna ("Langsung" / "per 30
 *   dtk"): transport yang diam-diam berubah jenis tanpa tanda itu pernah
 *   membuat orang menunggu papan yang tak pernah bergerak.
 */

type Fase = 'memuat' | 'gagal' | 'siap' | 'kosong';

export function SquadScreen() {
  const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
  const api = useMemo(() => createApiClient({ baseUrl: apiBase }), [apiBase]);

  const [fase, setFase] = useState<Fase>('memuat');
  const [galat, setGalat] = useState<ApiError | null>(null);
  const [squad, setSquad] = useState<SquadInfo | null>(null);
  const [papan, setPapan] = useState<SquadMember[]>([]);
  const [mode, setMode] = useState<ModePapan>('polling');
  const sedangMuatRef = useRef(false);

  const muat = useCallback(
    (sinyal?: AbortSignal) => {
      if (sedangMuatRef.current) return;
      sedangMuatRef.current = true;
      api
        .getSquadMe({ signal: sinyal })
        .then(({ squad: s }) => {
          if (s) {
            setSquad(s);
            setPapan(s.members);
            setFase('siap');
          } else {
            setFase('kosong');
          }
        })
        .catch((e: unknown) => {
          if (e instanceof DOMException && e.name === 'AbortError') return;
          setGalat(e instanceof ApiError ? e : galatJaringan());
          setFase('gagal');
        })
        .finally(() => {
          sedangMuatRef.current = false;
        });
    },
    [api],
  );

  useEffect(() => {
    const batal = new AbortController();
    muat(batal.signal);
    return () => batal.abort();
  }, [muat]);

  // Mesin papan: terpasang hanya kalau squad sudah diketahui, dilepas saat
  // squad berganti atau layar ditutup. `ambil` menembak leaderboard saja —
  // identitas squad (nama/tier) tidak ikut di-refresh tiap 30 detik.
  const squadId = squad?.squad_id;
  useEffect(() => {
    if (!squadId) return;
    // Penjaga in-flight + satu trailing refetch (temuan audit Q-05): burst
    // `score.updated` memancar ke seluruh anggota squad, dan tanpa penjaga
    // tiap event menembak satu GET — ikut memakai jatah rate limit per
    // pengguna lintas rute, dan respons paralel bisa selesai tak berurutan
    // (papan mundur sesaat). Event yang datang saat fetch berjalan cukup
    // dicatat; satu pengambilan ulang setelah selesai.
    let sedangAmbil = false;
    let muncrat = false;
    const ambil = async () => {
      if (sedangAmbil) {
        muncrat = true;
        return;
      }
      sedangAmbil = true;
      try {
        setPapan(await api.getSquadLeaderboard(squadId));
      } catch {
        // Papan yang sudah tampil tetap tampil; polling/WS berikutnya
        // mencoba lagi. Kegagalan sesaat bukan layar galat.
      } finally {
        sedangAmbil = false;
        if (muncrat) {
          muncrat = false;
          void ambil();
        }
      }
    };
    const papanLive = buatPapanLive({
      squadId,
      ambil,
      buatSoket: () => buatSoketSquad(apiBase),
      saatModeBerubah: setMode,
    });
    return () => papanLive.lepas();
  }, [api, apiBase, squadId]);

  if (fase === 'memuat')
    return <Pesan judul="Memuat squad…" teks="Sebentar, squad-mu sedang dicari." />;

  if (fase === 'gagal' && galat) {
    return (
      <Pesan
        judul="Squad gagal dimuat"
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

  if (fase === 'kosong' || !squad)
    return (
      <Pesan
        judul="Belum punya squad"
        teks="Squad dibentuk otomatis setiap minggu dari pengguna aktif — selesaikan micro-task hari ini supaya kamu masuk gelombang berikutnya."
      />
    );

  const akhirMusim = new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium' }).format(
    new Date(squad.season.ends_at),
  );

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-3 px-4 pb-8 pt-2" data-testid="kartu-squad">
      <section className="rounded-card border border-line bg-background p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-medium">{squad.name}</p>
            <p className="mt-1 text-sm text-ink-500">
              {squad.tier.toUpperCase()} · musim {squad.season.code} · berakhir {akhirMusim}
            </p>
          </div>
          <span
            className="flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs text-ink-500"
            data-testid="indikator-mode"
            aria-label={mode === 'langsung' ? 'Papan diperbarui langsung' : 'Papan diperbarui setiap 30 detik'}
          >
            <span
              className={
                mode === 'langsung'
                  ? 'h-2 w-2 rounded-full bg-emerald-500'
                  : 'h-2 w-2 rounded-full bg-ink-500'
              }
              aria-hidden
            />
            {mode === 'langsung' ? 'Langsung' : 'per 30 dtk'}
          </span>
        </div>
        <p className="mt-3 text-sm">
          Peringkatmu <span className="font-medium">#{squad.me.rank}</span> ·{' '}
          <span className="font-medium tabular-nums">{squad.me.weekly_points}</span> poin
          minggu ini
        </p>
      </section>

      <section className="rounded-card border border-line bg-background p-4" data-testid="papan">
        <p className="font-medium">Papan mingguan</p>
        <ol className="mt-3 flex flex-col gap-1">
          {papan.map((anggota) => (
            <li
              key={anggota.user_id}
              className="flex min-h-12 items-center gap-3 rounded-ctl px-3"
              data-testid="baris-papan"
            >
              <span className="w-6 text-center font-mono text-label tabular-nums text-ink-500">
                {anggota.rank}
              </span>
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface text-sm font-medium">
                {anggota.display_name.slice(0, 1).toUpperCase()}
              </span>
              <span className="flex-1 truncate text-sm">{anggota.display_name}</span>
              <span className="font-mono text-label tabular-nums text-ink-500">
                {anggota.weekly_points}
              </span>
            </li>
          ))}
        </ol>
      </section>
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
