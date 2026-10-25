'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { ApiError, createApiClient } from '@/lib/api-client';
import {
  CATATAN_MAKS_MENTOR,
  LABEL_APPROVE,
  LABEL_REJECT,
  TOTAL_MAKS_MENTOR,
  type AntreanMentorItem,
  type HasilValidasi,
  pesanGalatMentor,
  pesanHasilValidasi,
  totalRubrikMentor,
} from '@/lib/mentor-console';
import { KUNCI_RUBRIK, RUBRIC_KRITERIA } from '@/lib/review-queue';

/**
 * Konsol mentor: antrean validasi review — PR-04 (Dev B), PRD §7 E11.
 *
 * - Kartu menampilkan SKOR yang dikirim reviewer (rubrik yang sama dengan
 *   form PR-03 — satu sumber `review-queue.ts`), bukan form isian: mentor
 *   MEMVALIDASI, tidak menilai ulang.
 * - Identitas PENULIS attempt tidak ada di sini — server memang tidak
 *   mengirimnya (PR-2). Yang tampil adalah anggota binaan sendiri si
 *   reviewer (PR-9: mentor yang melatih mutu anggotanya).
 * - Menolak WAJIB catatan, menyetujui opsional — gerbang server
 *   `validasiKeputusan`; tombol tolak di-disable sampai catatan ada,
 *   itu gerbang tampilan (aturan keras 9: server tetap pemutus).
 * - Tanpa draf lokal: keputusan bersifat final di server (keputusan pertama
 *   tidak bisa dibatalkan), menyimpan draf "belum dikirim" hanya menggoda
 *   mentor menunda — antrean singkat, satu layar satu keputusan.
 */
export function MentorConsoleScreen() {
  const api = useMemo(
    () => createApiClient({ baseUrl: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001' }),
    [],
  );

  const [fase, setFase] = useState<'memuat' | 'gagal' | 'siap'>('memuat');
  const [antrean, setAntrean] = useState<AntreanMentorItem[]>([]);
  const [terbuka, setTerbuka] = useState<string | null>(null);
  const [catatan, setCatatan] = useState('');
  const [mengirim, setMengirim] = useState<'approve' | 'reject' | null>(null);
  const [galat, setGalat] = useState<string | null>(null);
  const [hasil, setHasil] = useState<HasilValidasi | null>(null);

  const muat = useCallback(
    (sinyal?: AbortSignal) => {
      api
        .getMentorQueue({ signal: sinyal })
        .then((q) => {
          setAntrean(q);
          setFase('siap');
        })
        .catch((e: unknown) => {
          if (e instanceof DOMException && e.name === 'AbortError') return;
          setFase('gagal');
        });
    },
    [api],
  );

  useEffect(() => {
    const batal = new AbortController();
    muat(batal.signal);
    return () => batal.abort();
  }, [muat]);

  const buka = (item: AntreanMentorItem) => {
    if (terbuka === item.id) {
      setTerbuka(null); // toggle tutup
      return;
    }
    setTerbuka(item.id);
    setCatatan('');
    setGalat(null);
    setHasil(null);
  };

  const kirim = (item: AntreanMentorItem, decision: 'approve' | 'reject') => {
    if (mengirim) return;
    const note = catatan.trim();
    if (decision === 'reject' && note === '') return; // gerbang tampilan
    setMengirim(decision);
    setGalat(null);
    api
      .validateMentorReview(item.id, decision, note === '' ? undefined : note)
      .then((res) => {
        setHasil(res);
        setTerbuka(null);
        muat(); // review validated meninggalkan antrean
      })
      .catch((e: unknown) => {
        setGalat(e instanceof ApiError ? pesanGalatMentor(e.code) : pesanGalatMentor('NETWORK'));
      })
      .finally(() => setMengirim(null));
  };

  if (fase === 'memuat')
    return (
      <div className="mx-auto w-full max-w-sm px-4 pb-8 pt-2 text-sm text-ink-500">
        Memuat antrean validasi…
      </div>
    );

  return (
    <section
      className="mx-auto flex w-full max-w-sm flex-col gap-3 px-4 pb-8 pt-2"
      data-testid="antrean-mentor"
    >
      <header>
        <p className="font-mono text-label uppercase text-ink-500">Mentor · Antrean validasi</p>
        <p className="mt-1 text-sm text-ink-500">
          Penilaian anggota squad binaanmu yang menunggu keputusan. Disetujui = reviewer mendapat 15
          koin (maks 5 berpoin/hari).
        </p>
      </header>

      {fase === 'gagal' ? (
        <div className="rounded-card border border-line bg-background p-4 text-sm">
          <p>Antrean gagal dimuat.</p>
          <button
            type="button"
            className="mt-2 rounded-ctl bg-primary px-4 py-2 text-sm text-primary-foreground"
            onClick={() => muat()}
          >
            Coba lagi
          </button>
        </div>
      ) : antrean.length === 0 && !hasil ? (
        <div className="rounded-card border border-line bg-background p-4 text-sm text-ink-500">
          Antrean kosong — tidak ada penilaian anggota binaan yang menunggu.
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {antrean.map((item) => {
            const id8 = item.id.slice(0, 8);
            const terbukaItem = terbuka === item.id;
            const catatanSah = catatan.trim() !== '';
            return (
              <li key={item.id} className="rounded-card border border-line bg-background">
                <button
                  type="button"
                  aria-expanded={terbukaItem}
                  className="w-full rounded-card px-4 py-3 text-left hover:bg-line"
                  onClick={() => buka(item)}
                  data-testid={`mentor-antrean-${id8}`}
                >
                  <span className="block font-medium">{item.reviewer_name}</span>
                  <span className="mt-0.5 block text-label text-ink-500">
                    {item.lesson_title} · skor {totalRubrikMentor(item.rubric_scores)}/
                    {TOTAL_MAKS_MENTOR} ·{' '}
                    {item.weighted_points > 0
                      ? `berpoin +${item.weighted_points}`
                      : 'di luar jatah berpoin'}{' '}
                    · {terbukaItem ? 'tutup' : 'putuskan sekarang'}
                  </span>
                </button>

                {terbukaItem ? (
                  <div
                    className="border-t border-line px-4 py-3"
                    data-testid={`mentor-form-${id8}`}
                  >
                    <p className="text-label font-medium uppercase text-ink-500">
                      Rubrik yang dikirim reviewer
                    </p>
                    <ul className="mt-1.5 flex flex-col gap-1">
                      {RUBRIC_KRITERIA.map((k) => (
                        <li key={k} className="flex items-center justify-between gap-3 text-sm">
                          <span>{KUNCI_RUBRIK[k].label}</span>
                          <span className="font-mono text-label" data-testid={`rubrik-${k}`}>
                            {typeof item.rubric_scores[k] === 'number'
                              ? item.rubric_scores[k]
                              : '—'}
                            /5
                          </span>
                        </li>
                      ))}
                    </ul>

                    {item.comment ? (
                      <p className="mt-3 rounded-ctl bg-line px-3 py-2 text-sm">
                        <span className="text-label uppercase text-ink-500">
                          Komentar reviewer:{' '}
                        </span>
                        {item.comment}
                      </p>
                    ) : null}

                    <label className="mt-3 block text-sm font-medium" htmlFor={`catatan-${id8}`}>
                      Catatan untuk reviewer{' '}
                      <span className="font-normal text-ink-500">
                        (wajib saat {LABEL_REJECT.toLowerCase()})
                      </span>
                    </label>
                    <textarea
                      id={`catatan-${id8}`}
                      className="mt-1 w-full rounded-ctl border border-line bg-background px-3 py-2 text-sm"
                      rows={2}
                      maxLength={CATATAN_MAKS_MENTOR}
                      value={catatan}
                      onChange={(e) => setCatatan(e.target.value)}
                      data-testid="catatan-mentor"
                    />

                    {galat ? (
                      <p
                        className="mt-2 text-sm text-flame-600"
                        role="alert"
                        data-testid="mentor-galat"
                      >
                        {galat}
                      </p>
                    ) : null}

                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        className="rounded-ctl bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
                        disabled={mengirim !== null}
                        onClick={() => kirim(item, 'approve')}
                        data-testid={`tombol-approve-${id8}`}
                      >
                        {mengirim === 'approve' ? 'Memproses…' : LABEL_APPROVE}
                      </button>
                      <button
                        type="button"
                        className="rounded-ctl border border-line px-4 py-2 text-sm disabled:opacity-50"
                        disabled={mengirim !== null || !catatanSah}
                        onClick={() => kirim(item, 'reject')}
                        data-testid={`tombol-reject-${id8}`}
                      >
                        {mengirim === 'reject' ? 'Memproses…' : LABEL_REJECT}
                      </button>
                    </div>
                    <p className="mt-1.5 text-label text-ink-500">
                      Keputusan pertama final — tidak bisa diubah setelah dikirim.
                    </p>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {hasil ? (
        <div
          className="rounded-card border border-line bg-background p-4 text-sm"
          data-testid="hasil-validasi"
        >
          <p className="font-medium">Keputusan tercatat</p>
          <p className="mt-1 text-ink-500" data-testid="pesan-hasil-mentor">
            {pesanHasilValidasi(hasil)}
          </p>
        </div>
      ) : null}
    </section>
  );
}
