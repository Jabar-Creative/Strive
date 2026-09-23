/**
 * Mesin pemain lesson — L-04.
 *
 * Seluruh aturan main yang bukan render hidup di file ini sebagai fungsi
 * murni, supaya jalurnya teruji tanpa browser dan komponen React tinggal
 * lapisan tipis. Dua hal yang SENGAJA tidak ada di sini:
 *
 * 1. Penilaian. Tidak ada kata skor, benar, atau salah — UI MENGUMPULKAN
 *    jawaban lalu menyerahkannya ke POST /attempts; skor dan feedback hanya
 *    boleh lahir dari respons server (CLAUDE.md aturan 9).
 * 2. Waktu. Mesin menerima milidetik dari pemanggil (performance.now()),
 *    tidak pernah membaca jam sendiri — test dan komponen yang menentukan
 *    kapan waktu diambil.
 */

/** Satu jawaban yang terkumpul, sebelum dipetakan ke bentuk kontrak. */
export interface CardAnswer {
  cardId: string;
  answer: string | boolean;
  /** Lama pengguna di kartu ini, ms. */
  ms: number;
}

export interface PlayerState {
  /** Indeks kartu aktif; sama dengan jumlah kartu yang sudah dijawab. */
  cardIndex: number;
  totalCards: number;
  answers: CardAnswer[];
  /** Semua kartu terjawab — siap dikirim sebagai attempt. */
  done: boolean;
}

export function startPlayer(totalCards: number): PlayerState {
  return {
    cardIndex: 0,
    totalCards: Math.max(0, totalCards),
    answers: [],
    done: totalCards <= 0,
  };
}

/**
 * Mencatat satu jawaban dan memajukan kartu.
 *
 * Jawaban SETELAH selesai ditolak diam-diam (state dikembalikan apa adanya):
 * pencegahan utama ada di komponen (kartu sudah tidak interaktif), tapi mesin
 * tidak boleh percaya komponen — dobel-submit dari gesture yang nyangkut
 * harus berhenti di sini, bukan menjadi jawaban ekstra di payload.
 */
export function answerCard(
  state: PlayerState,
  cardId: string,
  answer: string | boolean,
  ms: number,
): PlayerState {
  if (state.done) return state;
  const answers = [...state.answers, { cardId, answer, ms: Math.max(0, Math.round(ms)) }];
  const cardIndex = state.cardIndex + 1;
  return {
    ...state,
    answers,
    cardIndex,
    done: cardIndex >= state.totalCards,
  };
}

/** Bentuk body POST /attempts — createAttemptRequestSchema (F-08). */
export interface AttemptPayload {
  lesson_id: string;
  answers: { card_id: string; answer: string | boolean; ms: number }[];
  duration_ms: number;
}

export function attemptPayload(
  lessonId: string,
  state: PlayerState,
  durationMs: number,
): AttemptPayload {
  return {
    lesson_id: lessonId,
    answers: state.answers.map((a) => ({ card_id: a.cardId, answer: a.answer, ms: a.ms })),
    duration_ms: Math.max(0, Math.round(durationMs)),
  };
}
