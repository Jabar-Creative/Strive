'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ApiError, createApiClient } from '@/lib/api-client';
import {
  KUNCI_RUBRIK,
  RUBRIC_KRITERIA,
  RUBRIC_MAKS,
  type AntreanItem,
  type DrafReview,
  type HasilSubmit,
  type RubricKriteria,
  hapusDraf,
  mulaiDraf,
  muatDraf,
  pesanGalatReview,
  pesanHasil,
  penyimpananBawaan,
  rubrikLengkap,
  simpanDraf,
  totalRubrik,
} from '@/lib/review-queue';

/**
 * Antrean review + form rubrik — PR-03 (Dev B), PRD §7 E11. Bagian dari
 * halaman /squad ("anggota, leaderboard, antrean review" — CLAUDE.md).
 *
 * - Rubrik TETAP 4 kriteria (PR-10): kejelasan, ketepatan, kelengkapan,
 *   sitasi — 0..5 per kriteria. Daftarnya satu sumber dengan PR-04 nanti
 *   (konsol mentor memakai kriteria yang sama).
 * - Identitas penulis TIDAK ada di sini — bukan disembunyikan UI, memang
 *   tidak dikirim server (PR-2). Layar ini tidak punya nama untuk ditampilkan.
 * - Draf tersimpan lokal per attempt: tutup halaman kapan pun, nilainya
 *   kembali saat attempt yang sama dibuka lagi (AC PR-03). Kunci idempoten
 *   ikut di draf sehingga retry tetap satu review.
 * - Penilaian dihitung server (aturan keras 9): `rubrikLengkap` hanya
 *   men-disable tombol, tidak pernah memutuskan poin.
 */
export function ReviewQueueScreen() {
  const api = useMemo(
    () => createApiClient({ baseUrl: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001' }),
    [],
  );

  const [fase, setFase] = useState<'memuat' | 'gagal' | 'siap'>('memuat');
  const [antrean, setAntrean] = useState<AntreanItem[]>([]);
  const [idUser, setIdUser] = useState<string | null>(null);
  const [terbuka, setTerbuka] = useState<string | null>(null);
  const [draf, setDraf] = useState<DrafReview | null>(null);
  const [mengirim, setMengirim] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);
  const [hasil, setHasil] = useState<HasilSubmit | null>(null);
  const simpanRef = useRef(false); // jangan simpan draf hasil-sukses yang sudah dibuang

  const muat = useCallback(
    (sinyal?: AbortSignal) => {
      api
        .getReviewQueue({ signal: sinyal })
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

  // Identitas pemanggil untuk kunci draf per pengguna (temuan audit PR-03:
  // dua akun di satu profil browser tidak boleh saling mewarisi draf).
  // Gagal-tertutup: tanpa id, draf TIDAK dimuat dan TIDAK disimpan — lebih
  // baik kehilangan kenyamanan draf satu sesi daripada membuka draf orang
  // lain. Pengiriman penilaian tetap jalan; itu tidak bergantung draf.
  useEffect(() => {
    const batal = new AbortController();
    api
      .getMe({ signal: batal.signal })
      .then((me) => setIdUser(me.id))
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        setIdUser(null);
      });
    return () => batal.abort();
  }, [api]);

  // Autosave: tiap perubahan draf langsung ke localStorage — "tersimpan
  // kalau halaman tertutup" berarti tersimpan SEBELUM ditutup, bukan saat.
  // idUser ikot jadi dep: draf yang terisi sebelum /me menjawab tersimpan
  // begitu identitas tiba, bukan menunggu sentuhan berikutnya.
  useEffect(() => {
    const p = penyimpananBawaan();
    if (!p || !idUser || !terbuka || !draf || simpanRef.current) return;
    simpanDraf(p, idUser, terbuka, draf);
  }, [draf, idUser, terbuka]);

  const buka = useCallback(
    (item: AntreanItem) => {
      if (terbuka === item.attempt_id) {
        setTerbuka(null); // toggle tutup, draf tetap tersimpan
        return;
      }
      const p = penyimpananBawaan();
      const lama = p && idUser ? muatDraf(p, idUser, item.attempt_id) : null;
      simpanRef.current = false; // draf baru hidup lagi — autosave kembali aktif
      setDraf(lama ?? mulaiDraf());
      setTerbuka(item.attempt_id);
      setGalat(null);
      setHasil(null);
    },
    [idUser, terbuka],
  );

  const ubahSkor = (k: RubricKriteria, v: string) => {
    setDraf((d) => {
      if (!d) return d;
      const skor = { ...d.skor };
      if (v === '') delete skor[k];
      else skor[k] = Number(v);
      return { ...d, skor };
    });
  };

  const ubahKomentar = (v: string) => {
    setDraf((d) => (d ? { ...d, komentar: v } : d));
  };

  const kirim = (item: AntreanItem) => {
    if (!draf || !rubrikLengkap(draf.skor) || mengirim) return;
    setMengirim(true);
    setGalat(null);
    api
      .submitReview(
        item.attempt_id,
        draf.skor as Record<string, number>,
        draf.komentar.trim() === '' ? undefined : draf.komentar.trim(),
        draf.kunci,
      )
      .then((res) => {
        const p = penyimpananBawaan();
        if (p && idUser) hapusDraf(p, idUser, item.attempt_id); // sukses = draf selesai hidupnya
        simpanRef.current = true; // cegah autosave menulis ulang draf mati
        setDraf(null);
        setHasil(res);
        muat(); // attempt ini meninggalkan antrean; badge 0/1→1/2 yang lain bergerak
      })
      .catch((e: unknown) => {
        setGalat(e instanceof ApiError ? pesanGalatReview(e.code) : pesanGalatReview('NETWORK'));
        // draf TETAP — gagal kirim bukan alasan membuang penilaian orang
      })
      .finally(() => setMengirim(false));
  };

  if (fase === 'memuat')
    return (
      <div className="mx-auto w-full max-w-sm px-4 pb-8 pt-2 text-sm text-ink-500">
        Memuat antrean review…
      </div>
    );

  return (
    <section
      className="mx-auto flex w-full max-w-sm flex-col gap-3 px-4 pb-8 pt-2"
      data-testid="antrean-review"
    >
      <header>
        <p className="font-mono text-label uppercase text-ink-500">Squad · Antrean review</p>
        <p className="mt-1 text-sm text-ink-500">
          Nilai micro-task sesama pengguna — identitas penulis disembunyikan.
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
          Antrean kosong — tidak ada micro-task yang menunggu penilaianmu.
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {antrean.map((item) => {
            const id8 = item.attempt_id.slice(0, 8);
            const terbukaItem = terbuka === item.attempt_id;
            return (
              <li key={item.attempt_id} className="rounded-card border border-line bg-background">
                <button
                  type="button"
                  aria-expanded={terbukaItem}
                  className="w-full rounded-card px-4 py-3 text-left hover:bg-line"
                  onClick={() => buka(item)}
                  data-testid={`antrean-${id8}`}
                >
                  <span className="block font-medium">{item.lesson_title}</span>
                  <span className="mt-0.5 block text-label text-ink-500">
                    dikerjakan {item.attempt_date} · sudah dinilai {item.reviews_so_far}/2 ·{' '}
                    {terbukaItem ? 'tutup' : 'nilai sekarang'}
                  </span>
                </button>

                {terbukaItem && draf ? (
                  <div
                    className="border-t border-line px-4 py-3"
                    data-testid={`form-review-${id8}`}
                  >
                    <p className="text-label font-medium uppercase text-ink-500">
                      Jawaban penulis (anonim)
                    </p>
                    <ul className="mt-1.5 flex flex-col gap-1.5">
                      {bacaKartu(item.card_results).map((k, i) => (
                        <li key={i} className="text-sm">
                          <span className="mr-1.5 font-mono text-label text-ink-500">#{i + 1}</span>
                          <span className={k.correct ? '' : 'text-flame-600'}>
                            {/* true/false jawaban PENULIS, bukan correctness —
                                dipakaikan label Ya/Tidak supaya tidak kembar
                                dengan penilaian benar/salah di sebelahnya. */}
                            {typeof k.answer === 'boolean'
                              ? k.answer
                                ? 'Ya'
                                : 'Tidak'
                              : (k.answer ?? '(tidak dijawab)')}
                          </span>
                          <span className="ml-1.5 text-label text-ink-500">
                            {k.correct ? 'benar' : 'salah'}
                          </span>
                        </li>
                      ))}
                    </ul>

                    <p className="mt-4 text-label font-medium uppercase text-ink-500">
                      Rubrik · 0–{RUBRIC_MAKS} per kriteria
                    </p>
                    <div className="mt-1.5 flex flex-col gap-2">
                      {RUBRIC_KRITERIA.map((k) => (
                        <div key={k} className="flex items-center justify-between gap-3">
                          <label className="text-sm" htmlFor={`skor-${k}-${id8}`}>
                            {KUNCI_RUBRIK[k].label}
                            <span className="ml-1 text-ink-500">· {KUNCI_RUBRIK[k].bantu}</span>
                          </label>
                          <select
                            id={`skor-${k}-${id8}`}
                            className="rounded-ctl border border-line bg-background px-2 py-1.5 text-sm"
                            value={draf.skor[k] ?? ''}
                            onChange={(e) => ubahSkor(k, e.target.value)}
                            data-testid={`skor-${k}`}
                          >
                            <option value="" disabled>
                              —
                            </option>
                            {Array.from({ length: RUBRIC_MAKS + 1 }, (_, n) => n).map((n) => (
                              <option key={n} value={n}>
                                {n}
                              </option>
                            ))}
                          </select>
                        </div>
                      ))}
                    </div>

                    <label className="mt-3 block text-sm font-medium" htmlFor={`komentar-${id8}`}>
                      Catatan untuk penulis{' '}
                      <span className="font-normal text-ink-500">(opsional)</span>
                    </label>
                    <textarea
                      id={`komentar-${id8}`}
                      className="mt-1 w-full rounded-ctl border border-line bg-background px-3 py-2 text-sm"
                      rows={2}
                      maxLength={500}
                      value={draf.komentar}
                      onChange={(e) => ubahKomentar(e.target.value)}
                      data-testid="komentar-review"
                    />

                    <p className="mt-2 text-sm text-ink-500" data-testid="total-rubrik">
                      Total rubrik: {totalRubrik(draf.skor)} / 20
                    </p>

                    {galat ? (
                      <p
                        className="mt-2 text-sm text-flame-600"
                        role="alert"
                        data-testid="review-galat"
                      >
                        {galat}
                      </p>
                    ) : null}

                    <button
                      type="button"
                      className="mt-3 rounded-ctl bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
                      disabled={!rubrikLengkap(draf.skor) || mengirim}
                      onClick={() => kirim(item)}
                      data-testid={`tombol-kirim-${id8}`}
                    >
                      {mengirim ? 'Mengirim…' : 'Kirim penilaian'}
                    </button>
                    <p className="mt-1.5 text-label text-ink-500">
                      Draf tersimpan otomatis di perangkat ini.
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
          data-testid="hasil-review"
        >
          <p className="font-medium">Penilaian terkirim</p>
          <p className="mt-1 text-ink-500" data-testid="pesan-hasil">
            {pesanHasil(hasil)}
          </p>
        </div>
      ) : null}
    </section>
  );
}

/**
 * `card_results` datang sebagai `unknown` (jsonb lewat klien terketik).
 * Bentuknya array `{card_id, answer, correct}` dari attempts.service; yang
 * tidak berbentuk itu dilewati diam-diam — layar tidak boleh crash karena
 * satu baris data tua. `answer` kartu true/false adalah BOOLEAN (klien
 * mengirim swipe kiri/kanan, lesson-player.tsx) — bukan string.
 */
function bacaKartu(
  cardResults: unknown,
): Array<{ answer: string | boolean | null; correct: boolean }> {
  if (!Array.isArray(cardResults)) return [];
  return cardResults.flatMap((c) => {
    if (typeof c !== 'object' || c === null) return [];
    const { answer, correct } = c as { answer?: unknown; correct?: unknown };
    if (typeof correct !== 'boolean') return [];
    return [
      {
        answer: typeof answer === 'string' || typeof answer === 'boolean' ? answer : null,
        correct,
      },
    ];
  });
}
