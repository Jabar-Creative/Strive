import { describe, expect, it } from 'vitest';

import { createAttemptRequestSchema } from './attempt';

/**
 * Pembuktian LE-2 di lapis kontrak: "Skor yang dikirim client diabaikan
 * sepenuhnya" (docs/PRD.md §7 E2, item L-02). Skema ini SATU-SATUNYA gerbang
 * antara payload client dan kode server; zod membuang field tak dikenal,
 * jadi `score` (dan field lain yang tak dijanjikan) tidak pernah sampai ke
 * fungsi penilaian. Bersama `grading.service.spec.ts` yang tidak punya
 * parameter skor, dua lapis ini menutup AC L-02 pertama dari dua arah.
 */
describe('createAttemptRequestSchema — skor client dibuang (LE-2)', () => {
  it('payload memuat score palsu tetap lolos, dan score-nya hilang', () => {
    const hasil = createAttemptRequestSchema.parse({
      lesson_id: '11111111-1111-4111-8111-111111111111',
      answers: [{ card_id: '22222222-2222-4222-8222-222222222222', answer: 'a', ms: 900 }],
      duration_ms: 45000,
      score: 100, // diklaim benar semua oleh client
      points: 99999, // hadiah palsu
      coins: 99999,
    });
    expect(hasil).not.toHaveProperty('score');
    expect(hasil).not.toHaveProperty('points');
    expect(hasil).not.toHaveProperty('coins');
    expect(hasil.duration_ms).toBe(45000);
  });
});
