'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { CoinPill, StreakChip } from '@strive/ui';
import type { HubResponse } from '@strive/contracts';

import { ApiError, createApiClient } from '@/lib/api-client';
import { jamSisaHariLokal, statusStreak } from '@/lib/streak-status';

/**
 * Layar Hub — S-03 (Dev B), PRD §7 E3 SK-9/SK-10 + §14.4.
 *
 * Pembagian tugas dengan server sama tegasnya dengan L-05:
 * - STATUS streak (at_risk_today) dan seluruh angka datang dari GET /hub
 *   yang menghitung tanggalnya di Postgres, di zona waktu PENGGUNA.
 * - Client hanya MENAMPILKAN sisa jam: jamSisaHariLokal membaca zona waktu
 *   dari Intl dengan zona waktu pengguna — bukan Date proses — sehingga
 *   AC "sisa N jam benar di zona waktu pengguna, bukan UTC" terpenuhi
 *   secara konstruksi, bukan kebetulan TZ mesin uji.
 * - SK-10: status broken ("mulai lagi") TIDAK pernah merah — itu dijaga
 *   StreakChip (packages/ui) dan copy-nya memilih kata yang tak menyalahkan.
 */

type Fase = 'memuat' | 'gagal' | 'siap';

export function HubScreen() {
  const api = useMemo(
    () => createApiClient({ baseUrl: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001' }),
    [],
  );

  const [fase, setFase] = useState<Fase>('memuat');
  const [galat, setGalat] = useState<ApiError | null>(null);
  const [hub, setHub] = useState<HubResponse | null>(null);
  const [zonaWaktu, setZonaWaktu] = useState<string | null>(null);
  const sedangMuatRef = useRef(false);

  const muat = useCallback(
    (sinyal?: AbortSignal) => {
      if (sedangMuatRef.current) return;
      sedangMuatRef.current = true;
      api
        .getHub({ signal: sinyal })
        .then((data) => {
          setHub(data);
          setFase('siap');
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

  // Sisa jam berubah tiap menit; layar bergerak sendiri tanpa reload.
  // (Bukan "penilaian" — hanya tampilan hitungan mundur.)
  const [kini, setKini] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setKini(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  // Refetch saat tab kembali terlihat — pola L-05: menyelesaikan lesson
  // di tab lain harus langsung menyalakan chip streak di tab ini.
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

  // Zona waktu pengguna untuk hitungan sisa jam: dari /me (A-05), bukan
  // ditebak dari Intl lokasi mesin (pengguna berjalan-jalan; data loginnya
  // yang menjadi acuan tanggal lokal di server).
  useEffect(() => {
    api
      .getMe()
      .then((me) => setZonaWaktu(me.timezone))
      .catch(() => setZonaWaktu(null));
  }, [api]);

  if (fase === 'memuat')
    return <Pesan judul="Memuat Hub…" teks="Sebentar, ringkasanmu sedang disiapkan." />;

  if (fase === 'gagal' && galat) {
    return (
      <Pesan
        judul="Hub gagal dimuat"
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

  if (!hub) return null;

  const st = statusStreak({
    currentStreak: hub.streak.current_streak,
    atRiskToday: hub.streak.at_risk_today,
  });
  const sisaJam = zonaWaktu === null ? null : jamSisaHariLokal(kini, zonaWaktu);
  const menit = Math.floor((sisaJam ?? 0) * 60);

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-3 px-4 pb-8 pt-2" data-testid="hub">
      <section
        className="rounded-card border border-line bg-background p-4"
        data-testid="kartu-streak"
      >
        <div className="flex items-center justify-between gap-2">
          <StreakChip status={st.status} />
          <CoinPill amount={hub.balance} />
        </div>
        <p className="mt-3 font-medium">
          {st.kop}
          {hub.streak.freeze_credits > 0 ? (
            <span className="text-ink-500">{` · ${hub.streak.freeze_credits} kredit beku`}</span>
          ) : null}
        </p>
        {st.status === 'broken' ? (
          <p className="mt-1 text-sm text-ink-500">
            Satu micro-task hari ini menyalakannya kembali — rekor terpanjangmu{' '}
            {hub.streak.longest_streak} hari tetap tersimpan.
          </p>
        ) : hub.streak.at_risk_today && sisaJam !== null ? (
          <p className="mt-1 text-sm text-ink-500" data-testid="sisa-jam">
            Sisa {Math.floor(sisaJam)} jam {menit % 60 > 0 ? `${menit % 60} menit ` : ''}hari ini
            untuk menjaga streak-mu.
          </p>
        ) : null}
      </section>

      <section
        className="rounded-card border border-line bg-background p-4"
        data-testid="kartu-quest"
      >
        <p className="font-medium">Quest hari ini</p>
        <div className="mt-3 flex items-center gap-2">
          <div
            className="h-1.5 flex-1 overflow-hidden rounded-full bg-line"
            role="progressbar"
            aria-valuenow={
              hub.quest.target_tasks === 0
                ? 0
                : Math.round((hub.quest.done_tasks / hub.quest.target_tasks) * 100)
            }
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${hub.quest.done_tasks} dari ${hub.quest.target_tasks} quest selesai`}
          >
            <div
              className="h-full bg-primary"
              style={{
                width: `${hub.quest.target_tasks === 0 ? 0 : Math.round((hub.quest.done_tasks / hub.quest.target_tasks) * 100)}%`,
              }}
            />
          </div>
          <span className="font-mono text-label text-ink-500 tabular-nums">
            {hub.quest.done_tasks}/{hub.quest.target_tasks}
          </span>
        </div>
        <p className="mt-2 text-sm text-ink-500">
          {hub.quest.completed
            ? 'Quest selesai — kembali besok.'
            : 'Selesaikan micro-task untuk maju.'}
        </p>
      </section>

      {hub.squad ? (
        <section
          className="rounded-card border border-line bg-background p-4"
          data-testid="kartu-squad"
        >
          <p className="font-medium">{hub.squad.name}</p>
          <p className="mt-1 text-sm text-ink-500">
            Peringkat {hub.squad.rank} dari {hub.squad.members} · {hub.squad.weekly_points} poin
            minggu ini
          </p>
        </section>
      ) : null}

      {hub.next_cards.length > 0 ? (
        <section
          className="rounded-card border border-line bg-background p-4"
          data-testid="kartu-lanjut"
        >
          <p className="font-medium">Lanjutkan belajar</p>
          <ul className="mt-2 flex flex-col gap-1">
            {hub.next_cards.map(
              (c: { lesson_id: string; lesson_title: string; track_title: string }) => (
                <li key={c.lesson_id}>
                  <Link
                    href={`/learn/lesson/${c.lesson_id}`}
                    className="flex min-h-12 items-center justify-between gap-2 rounded-ctl px-3 py-2 text-sm transition-colors hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  >
                    <span>{c.lesson_title}</span>
                    <span className="font-mono text-label uppercase text-ink-500">
                      {c.track_title}
                    </span>
                  </Link>
                </li>
              ),
            )}
          </ul>
        </section>
      ) : null}
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
