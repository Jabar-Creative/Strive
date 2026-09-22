import { describe, expect, it } from 'vitest';

import { gradeAttempt, type KartuKunci, type JawabanClient } from './grading.service';

/**
 * Test unit untuk inti L-02: penilaian sepenuhnya di server.
 *
 * Yang diuji adalah `gradeAttempt` — fungsi murni yang menerima kartu
 * BESERTA kunci jawabannya dan jawaban client, tidak lebih. Dua hal yang
 * membuat AC L-02 terbukti di sini:
 *
 * 1. "Skor yang dikirim client diabaikan sepenuhnya" — struktural: fungsi
 *    ini TIDAK PUNYA parameter skor. Tidak ada yang bisa diabaikan karena
 *    tidak pernah diterima. (Pembuktian lapis kontrak: field `score` pada
 *    payload dibuang oleh skema F-08 — lihat packages/contracts attempt
 *    spec.)
 * 2. "Mengirim jawaban acak menghasilkan skor 0, bukan error" — kasus
 *    kedua dan keempat di bawah.
 */

const KARTU_MC: KartuKunci = {
  id: '11111111-1111-4111-8111-111111111111',
  kind: 'multiple_choice',
  options: [
    { id: 'a', text: 'Riset audiens', correct: true, why: 'Kenapa a benar' },
    { id: 'b', text: 'Langsung judul', correct: false, why: 'Kenapa b salah' },
    { id: 'c', text: 'Target share', correct: false, why: 'Kenapa c salah' },
  ],
};

const KARTU_SWIPE: KartuKunci = {
  id: '22222222-2222-4222-8222-222222222222',
  kind: 'swipe_binary',
  options: [
    { id: 'true', text: 'Benar', correct: false, why: 'Kenapa true salah' },
    { id: 'false', text: 'Salah', correct: true, why: 'Kenapa false benar' },
  ],
};

const DUA_KARTU = [KARTU_MC, KARTU_SWIPE];

function jawab(cardId: string, answer: string | boolean): JawabanClient {
  return { card_id: cardId, answer, ms: 4000 };
}

describe('gradeAttempt — penilaian di server (L-02)', () => {
  it('semua benar → skor 100, feedback correct=true dengan why opsi yang dipilih', () => {
    const hasil = gradeAttempt(DUA_KARTU, [jawab(KARTU_MC.id, 'a'), jawab(KARTU_SWIPE.id, false)]);
    expect(hasil.score).toBe(100);
    expect(hasil.feedback).toHaveLength(2);
    expect(hasil.feedback[0]).toEqual({
      card_id: KARTU_MC.id,
      correct: true,
      why: 'Kenapa a benar',
    });
    expect(hasil.feedback[1]?.correct).toBe(true);
  });

  it('jawaban acak semua salah → skor 0, BUKAN error (AC-2)', () => {
    const hasil = gradeAttempt(DUA_KARTU, [jawab(KARTU_MC.id, 'b'), jawab(KARTU_SWIPE.id, true)]);
    expect(hasil.score).toBe(0);
    expect(hasil.feedback.every((f) => !f.correct)).toBe(true);
  });

  it('jawaban parsial: kartu yang tidak dijawab dinilai salah, bukan error', () => {
    const hasil = gradeAttempt(DUA_KARTU, [jawab(KARTU_MC.id, 'a')]);
    expect(hasil.score).toBe(50);
    const swipe = hasil.feedback.find((f) => f.card_id === KARTU_SWIPE.id);
    expect(swipe?.correct).toBe(false);
  });

  it('id opsi tak dikenal dinilai salah, bukan error', () => {
    const hasil = gradeAttempt(DUA_KARTU, [
      jawab(KARTU_MC.id, 'zzz-tidak-ada'),
      jawab(KARTU_SWIPE.id, false),
    ]);
    expect(hasil.score).toBe(50);
  });

  it('cardId yang bukan milik lesson → 422 CARD_NOT_IN_LESSON, bukan skor 0 diam-diam', () => {
    const asing = '99999999-9999-4999-8999-999999999999';
    expect(() => gradeAttempt(DUA_KARTU, [jawab(asing, 'a')])).toThrowError(
      expect.objectContaining({
        getStatus: expect.any(Function),
        response: expect.objectContaining({
          code: 'CARD_NOT_IN_LESSON',
        }),
      }),
    );
  });

  it('boolean swipe_binary dicocokkan ke opsi ber-id "true"/"false"', () => {
    // Data seed memakai id 'true'/'false' pada kartu swipe; jawaban boolean
    // client dan jawaban string id opsi harus jatuh ke ATURAN YANG SAMA.
    const hasilBool = gradeAttempt([KARTU_SWIPE], [jawab(KARTU_SWIPE.id, false)]);
    const hasilString = gradeAttempt([KARTU_SWIPE], [jawab(KARTU_SWIPE.id, 'false')]);
    expect(hasilBool.score).toBe(100);
    expect(hasilString.score).toBe(100);
  });

  it('durasi tidak masuk akal ditandai, tetap dinilai (kasus tepi PRD §7 E2)', () => {
    const terlaluCepat: JawabanClient[] = DUA_KARTU.map((k) => ({
      card_id: k.id,
      answer: k.options.find((o) => o.correct)!.id === 'a' ? 'a' : false,
      ms: 10,
    }));
    const hasil = gradeAttempt(DUA_KARTU, terlaluCepat, {
      durationMs: 1000, // < 3 detik untuk 5 kartu ≈ < 600 ms/kartu — 2 kartu pun cukup rendah
    });
    expect(hasil.score).toBe(100);
    expect(hasil.suspiciousDuration).toBe(true);
  });

  it('why kartu yang salah dijawab/salah opsi memakai why opsi benar sebagai fallback', () => {
    const hasil = gradeAttempt(DUA_KARTU, [
      jawab(KARTU_MC.id, 'b'), // salah → kenapa b dipilih ada
      // swipe tak dijawab → fallback ke why opsi benar
    ]);
    expect(hasil.feedback[0]?.why).toBe('Kenapa b salah');
    const swipe = hasil.feedback.find((f) => f.card_id === KARTU_SWIPE.id);
    expect(swipe?.why).toBe('Kenapa false benar');
  });

  it('defensif: kartu kosong → skor 0 dengan feedback kosong, bukan NaN', () => {
    const hasil = gradeAttempt([], []);
    expect(hasil.score).toBe(0);
    expect(hasil.feedback).toEqual([]);
  });
});
