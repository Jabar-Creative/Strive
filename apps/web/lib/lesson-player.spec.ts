import { describe, expect, it } from 'vitest';

import { answerCard, attemptPayload, startPlayer } from './lesson-player';

/**
 * Test unit untuk mesin pemain lesson (L-04).
 *
 * Komponen React hanya lapis tipis; seluruh aturan main hidup di sini supaya
 * bisa diuji tanpa browser: urutan kartu, pengumpulan jawaban (yang jadi
 * payload POST /attempts), dan pengukuran durasi. Aturan paling penting yang
 * dijaga file ini: UI MENGUMPULKAN jawaban, tidak pernah menilai — tidak ada
 * kata "skor" di mesin ini sama sekali (CLAUDE.md aturan 9).
 */
describe('startPlayer', () => {
  it('lima kartu dimulai di kartu pertama, belum selesai', () => {
    const state = startPlayer(5, 'kunci-a');
    expect(state.cardIndex).toBe(0);
    expect(state.answers).toEqual([]);
    expect(state.done).toBe(false);
  });

  it('nol kartu langsung selesai (defensif, bukan crash)', () => {
    expect(startPlayer(0, 'kunci-a').done).toBe(true);
  });
});

describe('answerCard', () => {
  it('menjawab memajukan ke kartu berikutnya dan mencatat jawaban', () => {
    const state = answerCard(startPlayer(3, 'kunci-a'), 'kartu-1', 'a', 4200);
    expect(state.cardIndex).toBe(1);
    expect(state.answers).toEqual([{ cardId: 'kartu-1', answer: 'a', ms: 4200 }]);
    expect(state.done).toBe(false);
  });

  it('kartu terakhir menandai selesai', () => {
    let state = startPlayer(2, 'kunci-a');
    state = answerCard(state, 'k1', true, 1000);
    state = answerCard(state, 'k2', false, 2000);
    expect(state.done).toBe(true);
    expect(state.cardIndex).toBe(2);
  });

  it('jawaban SETELAH selesai ditolak diam-diam, tidak menambah apa pun', () => {
    let state = startPlayer(1, 'kunci-a');
    state = answerCard(state, 'k1', 'a', 500);
    const setelah = answerCard(state, 'k1', 'b', 999);
    expect(setelah).toBe(state);
  });
});

describe('attemptPayload', () => {
  it('membentuk payload persis kontrak POST /attempts (snake_case, ms per kartu)', () => {
    let state = startPlayer(2, 'kunci-a');
    state = answerCard(state, '11111111-1111-4111-8111-111111111111', 'opt_a', 3000);
    state = answerCard(state, '22222222-2222-4222-8222-222222222222', false, 2500);
    const payload = attemptPayload('lesson-xyz', state, 57_000);
    expect(payload).toEqual({
      lesson_id: 'lesson-xyz',
      answers: [
        { card_id: '11111111-1111-4111-8111-111111111111', answer: 'opt_a', ms: 3000 },
        { card_id: '22222222-2222-4222-8222-222222222222', answer: false, ms: 2500 },
      ],
      duration_ms: 57_000,
    });
  });
});

describe('kunci idempoten attempt (review PR #137)', () => {
  it('retry dari state yang sama memakai kunci IDENTIK sepanjang percobaan', () => {
    let state = startPlayer(2, 'kunci-retry');
    state = answerCard(state, 'k1', 'a', 1000);
    state = answerCard(state, 'k2', false, 1500);
    // kirim() gagal lalu "Kirim ulang": keduanya membaca state yang sama,
    // jadi kunci yang dikirim ke createAttempt identik -> LE-8 di server,
    // bukan LE-4 yang memberi tahu pengguna hadiahnya hilang.
    expect(state.idempotencyKey).toBe('kunci-retry');
    expect(state.done).toBe(true);
  });

  it('percobaan baru (muat/ulang) = kunci BARU dan pengumpulan dari nol', () => {
    const pertama = startPlayer(2, 'kunci-satu');
    const kedua = startPlayer(2, 'kunci-dua'); // pemanggil membangkitkan ulang
    expect(pertama.idempotencyKey).not.toBe(kedua.idempotencyKey);
    expect(kedua.cardIndex).toBe(0);
    expect(kedua.answers).toEqual([]);
  });
});
