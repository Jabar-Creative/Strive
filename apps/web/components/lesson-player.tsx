'use client';

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { LessonCard } from '@strive/ui';

import {
  ApiError,
  createApiClient,
  type AttemptResult,
  type LessonCardsResponse,
  type PublicCard,
} from '@/lib/api-client';
import { answerCard, attemptPayload, startPlayer, type PlayerState } from '@/lib/lesson-player';

/**
 * Pemain lesson bite-sized — L-04 (Dev B), PRD §7 E2 + §14.
 *
 * Batas paling penting file ini: komponen TIDAK PERNAH menilai. Ia mengumpulkan
 * jawaban (mesin murni di lib/lesson-player) lalu menyerahkannya ke
 * POST /attempts; skor, koin, dan feedback hanya dirender dari respons server
 * (CLAUDE.md aturan 9). Tidak ada satu cabang pun di sini yang tahu jawaban
 * mana yang benar — dan itu bisa dibuktikan: file ini tidak pernah membaca
 * field `correct` kecuali dari `AttemptResult.feedback`.
 *
 * Gerak: Framer Motion dengan durasi yang MENGEMBANGI token §14.3. PRD
 * menyebut useReducedMotion() "harus dipanggil, tidak otomatis" — jadi setiap
 * transisi di sini melalui fungsi `gerak()` yang menjawab 0 detik saat
 * prefers-reduced-motion.
 */
const T_BASE = 0.32; // cermin --t-base 320ms (§14.3)
const T_CEL = 0.64; // cermin --t-cel 640ms (§14.3)

/** Ambang geser (px) agar swipe dianggap jawaban — bukan usapan jempol. */
const AMBANG_SWIPE = 80;

type Fase = 'memuat' | 'gagal-muat' | 'gagal-kirim' | 'bermain' | 'mengirim' | 'hasil';

export function LessonPlayer({ lessonId }: { lessonId: string }) {
  const reduksi = useReducedMotion();
  const api = useMemo(
    () => createApiClient({ baseUrl: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001' }),
    [],
  );

  const [lesson, setLesson] = useState<LessonCardsResponse | null>(null);
  const [fase, setFase] = useState<Fase>('memuat');
  const [galat, setGalat] = useState<ApiError | null>(null);
  const [player, setPlayer] = useState<PlayerState>(() => startPlayer(0));
  const [hasil, setHasil] = useState<AttemptResult | null>(null);

  const mulaiRef = useRef(0); // performance.now() saat lesson dibuka
  const kartuMulaiRef = useRef(0); // saat kartu aktif mulai
  const terkirimRef = useRef(false); // satu lesson = satu submit

  const gerak = useCallback((durasi: number) => ({ duration: reduksi ? 0 : durasi }), [reduksi]);

  const muat = useCallback(() => {
    setFase('memuat');
    setGalat(null);
    api
      .getLessonCards(lessonId)
      .then((data) => {
        setLesson(data);
        setPlayer(startPlayer(data.cards.length));
        mulaiRef.current = performance.now();
        kartuMulaiRef.current = mulaiRef.current;
        terkirimRef.current = false;
        setFase('bermain');
      })
      .catch((e: unknown) => {
        setGalat(e instanceof ApiError ? e : null);
        setFase('gagal-muat');
      });
  }, [api, lessonId]);

  useEffect(muat, [muat]);

  const kirim = useCallback(() => {
    if (terkirimRef.current || !lesson) return;
    terkirimRef.current = true;
    setFase('mengirim');
    api
      .createAttempt(attemptPayload(lessonId, player, performance.now() - mulaiRef.current))
      .then((r) => {
        setHasil(r);
        setFase('hasil');
      })
      .catch((e: unknown) => {
        terkirimRef.current = false;
        setGalat(e instanceof ApiError ? e : null);
        setFase('gagal-kirim');
      });
  }, [api, lesson, lessonId, player]);

  useEffect(() => {
    if (fase === 'bermain' && player.done && lesson && lesson.cards.length > 0) kirim();
  }, [fase, player.done, lesson, kirim]);

  const jawab = useCallback(
    (answer: string | boolean) => {
      if (fase !== 'bermain' || player.done || !lesson) return;
      const kartu = lesson.cards[player.cardIndex];
      if (!kartu) return;
      const kini = performance.now();
      const ms = kini - kartuMulaiRef.current;
      kartuMulaiRef.current = kini;
      setPlayer((prev) => answerCard(prev, kartu.id, answer, ms));
    },
    [fase, lesson, player],
  );

  const ulang = useCallback(() => {
    if (!lesson) return;
    setHasil(null);
    setPlayer(startPlayer(lesson.cards.length));
    mulaiRef.current = performance.now();
    kartuMulaiRef.current = mulaiRef.current;
    terkirimRef.current = false;
    setFase('bermain');
  }, [lesson]);

  if (fase === 'memuat') {
    return <PesanKosong judul="Memuat kartu…" teks="Sebentar, kartu pelajaran sedang disiapkan." />;
  }

  if ((fase === 'gagal-muat' || fase === 'gagal-kirim') && galat) {
    return (
      <PesanKosong
        judul={fase === 'gagal-muat' ? 'Kartu gagal dimuat' : 'Jawaban gagal dikirim'}
        teks={galat.message}
        kode={galat.code}
        aksi={
          fase === 'gagal-muat' ? (
            <TombolSekunder onClick={muat}>Coba lagi</TombolSekunder>
          ) : (
            <TombolSekunder onClick={kirim}>Kirim ulang</TombolSekunder>
          )
        }
      />
    );
  }

  if (!lesson) return null;

  if (lesson.cards.length === 0) {
    return (
      <PesanKosong
        judul="Lesson ini belum punya kartu"
        teks="Belum ada konten yang bisa dikerjakan. Coba lesson lain."
        aksi={
          <Link className="text-primary underline-offset-4 hover:underline" href="/learn">
            Kembali ke daftar lesson
          </Link>
        }
      />
    );
  }

  if (fase === 'hasil' && hasil) {
    return <HasilAttempt hasil={hasil} lesson={lesson} reduksi={reduksi} onUlang={ulang} />;
  }

  const kartu = lesson.cards[Math.min(player.cardIndex, lesson.cards.length - 1)];
  if (!kartu) return null;
  const lagi = fase === 'mengirim';

  return (
    <div
      className="mx-auto flex w-full max-w-sm flex-col gap-4 px-4 pb-8 pt-4"
      data-reduced-motion={reduksi ? 'ya' : 'tidak'}
    >
      <header className="flex items-center justify-between">
        <p className="font-mono text-label uppercase text-ink-500">{lesson.title}</p>
        <p className="font-mono text-label text-ink-500 tabular-nums">
          {Math.min(player.cardIndex + 1, lesson.cards.length)}/{lesson.cards.length}
        </p>
      </header>

      <div aria-hidden="true" className="flex gap-1.5">
        {lesson.cards.map((c, i) => (
          <span
            key={c.id}
            className={
              'h-1.5 flex-1 rounded-full ' + (i < player.cardIndex ? 'bg-primary' : 'bg-line')
            }
          />
        ))}
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={kartu.id + ':' + player.cardIndex}
          initial={{ opacity: 0, x: reduksi ? 0 : 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: reduksi ? 0 : -24 }}
          transition={gerak(T_BASE)}
        >
          {kartu.kind === 'swipe_binary' ? (
            <KartuSwipe kartu={kartu} reduksi={reduksi} onJawab={jawab} kunci={player.cardIndex} />
          ) : (
            <KartuPilihan kartu={kartu} onJawab={jawab} />
          )}
        </motion.div>
      </AnimatePresence>

      {lagi ? <p className="text-center text-sm text-ink-500">Mengirim jawaban…</p> : null}
    </div>
  );
}

/** Kartu pilihan ganda: opsi dirender pemanggil, kunci tak pernah diketahui. */
function KartuPilihan({
  kartu,
  onJawab,
}: {
  kartu: PublicCard;
  onJawab: (answer: string) => void;
}) {
  return (
    <LessonCard variant="multiple_choice" title="Pilih satu" prompt={kartu.prompt}>
      <div className="flex flex-col gap-2">
        {kartu.content.options.map((opsi) => (
          <button
            key={opsi.id}
            type="button"
            onClick={() => onJawab(opsi.id)}
            className="min-h-12 w-full rounded-ctl border border-line bg-background px-4 py-3 text-left text-body transition-colors hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {opsi.text}
          </button>
        ))}
      </div>
    </LessonCard>
  );
}

/**
 * Kartu swipe benar/salah: gestur kiri/kanan (L-04) plus tombol bawaan
 * LessonCard sebagai alternatif wajib (PRD §14.5 — swipe bukan satu-satunya
 * cara). Geser kanan = pernyataan benar, kiri = salah.
 */
function KartuSwipe({
  kartu,
  reduksi,
  onJawab,
  kunci,
}: {
  kartu: PublicCard;
  reduksi: boolean | null;
  onJawab: (answer: boolean) => void;
  kunci: number;
}) {
  return (
    <div className="touch-pan-y">
      <motion.div
        drag="x"
        dragDirectionLock
        dragElastic={0.6}
        // Animasi tarik-balik mati total saat reduced-motion (durasi 0);
        // gesturnya sendiri tetap hidup karena itu manipulasi langsung,
        // bukan animasi dekoratif.
        transition={{ duration: reduksi ? 0 : T_BASE }}
        onDragEnd={(_, info) => {
          if (info.offset.x > AMBANG_SWIPE) onJawab(true);
          else if (info.offset.x < -AMBANG_SWIPE) onJawab(false);
        }}
        key={kunci}
      >
        <LessonCard
          variant="swipe_binary"
          title="Geser atau ketuk"
          prompt={kartu.prompt}
          onCorrect={() => onJawab(true)}
          onIncorrect={() => onJawab(false)}
        />
      </motion.div>
      <p className="mt-2 text-center text-xs text-ink-500">
        Geser ke kanan untuk “Benar”, kiri untuk “Salah”, atau pakai tombol.
      </p>
    </div>
  );
}

/** Layar hasil: seluruh angka lahir dari respons server, bukan dihitung sini. */
function HasilAttempt({
  hasil,
  lesson,
  reduksi,
  onUlang,
}: {
  hasil: AttemptResult;
  lesson: LessonCardsResponse;
  reduksi: boolean | null;
  onUlang: () => void;
}) {
  const promptById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of lesson.cards) m.set(c.id, c.prompt);
    return m;
  }, [lesson.cards]);

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-4 px-4 pb-8 pt-4">
      <header className="text-center">
        <p className="font-mono text-label uppercase text-ink-500">Hasil</p>
        <p className="text-title tabular-nums" data-testid="skor">
          {hasil.score}
          <span className="text-body text-ink-500">/100</span>
        </p>
        {hasil.rewarded ? (
          <motion.p
            className="text-body font-medium"
            initial={reduksi ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: reduksi ? 0 : T_CEL }}
            aria-hidden={reduksi ? undefined : true}
          >
            +{hasil.coins} koin · +{hasil.points} poin
          </motion.p>
        ) : (
          <p className="text-sm text-ink-500">
            Latihan ulang — lesson ini sudah dihargai hari ini, tanpa koin baru.
          </p>
        )}
      </header>

      <ul className="flex flex-col gap-2">
        {hasil.feedback.map((f) => (
          <li
            key={f.card_id}
            className="rounded-card border border-line bg-background p-3 text-sm"
            data-testid="feedback-kartu"
          >
            <p className="font-medium">
              {f.correct ? 'Benar' : 'Salah'} — {promptById.get(f.card_id) ?? 'Kartu'}
            </p>
            <p className="text-ink-500">{f.why}</p>
          </li>
        ))}
      </ul>

      <p className="text-center text-sm text-ink-500">
        Streak {hasil.streak.current} hari{hasil.streak.is_new_record ? ' (rekor baru)' : ''} ·
        quest {hasil.quest.done_tasks}/{hasil.quest.target_tasks}
      </p>

      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={onUlang}
          className="min-h-12 rounded-ctl bg-primary px-4 font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          Ulangi latihan
        </button>
        <Link
          className="min-h-12 rounded-ctl border border-line px-4 py-3 text-center text-body hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          href="/hub"
        >
          Kembali ke Hub
        </Link>
      </div>
    </div>
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

function TombolSekunder({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-h-12 rounded-ctl bg-primary px-6 font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      {children}
    </button>
  );
}
