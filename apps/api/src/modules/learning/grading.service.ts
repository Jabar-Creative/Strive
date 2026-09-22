import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import type { Transaction } from 'kysely';

import type { DB } from '../../infra/kysely';

/**
 * Kode error untuk jawaban yang menunjuk kartu di luar lesson-nya.
 *
 * PRD §7 E2 kasus tepi meminta 422 "bukan skor 0 diam-diam", tapi `CARD_NOT_IN_LESSON`
 * belum ada di daftar TERTUTUP §10.2 — pola yang sama dengan `NOT_FOUND` di
 * `content.service.ts`: dipakai di sini secara lokal dan terang-terangan, dan
 * begitu §10.2 diperbarui, `API_ERROR_CODES` di `packages/contracts` ikut
 * ditambah lalu konstanta ini dipusatkan ke sana. Tidak diam-diam menciptakan
 * kontrak — lihat pula isu #92 soal disiplin daftar itu.
 */
const CARD_NOT_IN_LESSON = 'CARD_NOT_IN_LESSON';

/** Opsi kartu BESERTA kunci jawaban — hanya hidup di server (CLAUDE.md aturan 9). */
export interface OpsiKunci {
  id: string;
  text: string;
  correct: boolean;
  why: string;
}

/** Kartu seperti disimpan `lesson_cards.content`, kunci belum dibuang. */
export interface KartuKunci {
  id: string;
  kind: string;
  options: OpsiKunci[];
}

/**
 * Jawaban client — bidang yang dikirim `POST /attempts` (kontrak F-08).
 * SENGAJA tidak ada (dan tidak akan pernah ada) parameter `score` di sini:
 * LE-2 "skor yang dikirim client diabaikan sepenuhnya" ditegakkan secara
 * struktural, bukan dengan mengecek lalu membuang.
 */
export interface JawabanClient {
  card_id: string;
  answer: string | boolean;
  ms?: number;
}

/** Feedback per kartu SETELAH dinilai — sah memuat kunci (kontrak F-08). */
export interface FeedbackItem {
  card_id: string;
  correct: boolean;
  why: string;
}

export interface HasilNilai {
  /** 0–100: pembulatan dari proporsi kartu benar (AC-LE-1: semua benar = 100). */
  score: number;
  feedback: FeedbackItem[];
  /** duration_ms < 600 ms/kartu — diterima tapi ditandai (PRD §7 E2 kasus tepi). */
  suspiciousDuration: boolean;
}

/** Ambang "terlalu cepat untuk manusia": PRD mencontohkan < 3 dtk untuk 5 kartu. */
const MS_MINIMAL_PER_KARTU = 600;

/**
 * Ambil opsi dari kolom `content` (jsonb) secara defensif.
 *
 * `content` bertipe `Json` di codegen: tidak ada jaminan bentuk pada level
 * tipe. Konten rusak menjadikan kartu tak bisa dijawab benar (skor 0 untuk
 * kartu itu), TIDAK menjadikan seluruh attempt error — semangat "jawaban
 * acak menghasilkan skor 0, bukan error" berlaku dua arah.
 */
function ambilOpsi(content: unknown): OpsiKunci[] {
  if (content === null || typeof content !== 'object') return [];
  const options = (content as { options?: unknown }).options;
  if (!Array.isArray(options)) return [];
  return options.filter(
    (o): o is OpsiKunci =>
      typeof o === 'object' &&
      o !== null &&
      typeof (o as OpsiKunci).id === 'string' &&
      typeof (o as OpsiKunci).text === 'string' &&
      typeof (o as OpsiKunci).correct === 'boolean' &&
      typeof (o as OpsiKunci).why === 'string',
  );
}

/**
 * Inti L-02: menilai jawaban terhadap kunci, sepenuhnya di server.
 *
 * Aturan pencocokan tunggal untuk semua kind v0.1: jawaban cocok dengan opsi
 * ber-id `String(answer)` — kartu `swipe_binary` memakai id `'true'`/`'false'`
 * (lihat data seed), sehingga jawaban boolean dan id opsi jatuh ke aturan yang
 * sama tanpa percabangan kind.
 *
 * Kasus tepi PRD §7 E2:
 * - kartu tidak dijawab / id opsi tak dikenal → dinilai SALAH, bukan error
 * - `card_id` di luar lesson → 422 `CARD_NOT_IN_LESSON`, bukan skor 0 diam-diam
 * - `durationMs` tak masuk akal → tetap dinilai, ditandai `suspiciousDuration`
 */
export function gradeAttempt(
  kartu: KartuKunci[],
  jawaban: JawabanClient[],
  opts?: { durationMs?: number },
): HasilNilai {
  const kartuById = new Map(kartu.map((k) => [k.id, k]));
  const asing = jawaban.find((j) => !kartuById.has(j.card_id));
  if (asing) {
    throw new UnprocessableEntityException({
      code: CARD_NOT_IN_LESSON,
      message: 'Jawaban menunjuk kartu yang bukan milik lesson ini',
      details: { cardId: asing.card_id },
    });
  }

  let benar = 0;
  const feedback: FeedbackItem[] = kartu.map((k) => {
    const j = jawaban.find((x) => x.card_id === k.id);
    const dipilih = j === undefined ? undefined : k.options.find((o) => o.id === String(j.answer));
    const correct = dipilih?.correct === true;
    if (correct) benar += 1;
    // why yang paling berguna bagi pengguna: alasan opsi yang IA pilih;
    // kalau jawabannya tak cocok opsi mana pun (acak/kosong), kenapa opsi
    // benar yang ditampilkan.
    const why = dipilih?.why ?? k.options.find((o) => o.correct)?.why ?? '';
    return { card_id: k.id, correct, why };
  });

  const score = kartu.length === 0 ? 0 : Math.round((benar / kartu.length) * 100);
  const suspiciousDuration =
    opts?.durationMs !== undefined && opts.durationMs < kartu.length * MS_MINIMAL_PER_KARTU;

  return { score, feedback, suspiciousDuration };
}

/** Transaksi pemanggil — grading selalu berjalan DI DALAM transaksi L-03 (LE-6). */
type Trx = Transaction<DB>;

/**
 * GradingService — jembatan DB untuk `gradeAttempt`, untuk dipakai
 * `attempts.service.ts` (L-03, milik Dev A).
 *
 * Kartu diambil BESERTA kunci jawabannya dari `lesson_cards` lewat transaksi
 * pemanggil: attempt dan kartu yang menjadi dasar nilainya harus dibaca dari
 * snapshot transaksi yang sama, bukan dari koneksi lain.
 */
@Injectable()
export class GradingService {
  async grade(
    trx: Trx,
    lessonId: string,
    jawaban: JawabanClient[],
    durationMs?: number,
  ): Promise<HasilNilai> {
    const rows = await trx
      .selectFrom('lesson_cards')
      .select(['id', 'kind', 'content'])
      .where('lesson_id', '=', lessonId)
      .orderBy('sort_order')
      .execute();

    return gradeAttempt(
      rows.map((r) => ({ id: r.id, kind: r.kind, options: ambilOpsi(r.content) })),
      jawaban,
      { durationMs },
    );
  }
}
