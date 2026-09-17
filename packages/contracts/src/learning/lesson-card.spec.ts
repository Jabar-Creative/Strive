import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  lessonCardOptionResponseSchema,
  lessonCardResponseSchema,
  type LessonCardOptionResponse,
} from './lesson-card';

describe('lessonCardResponseSchema — CLAUDE.md aturan #9', () => {
  // Payload MENTAH seperti yang tersimpan di `lesson_cards.content` (docs/PRD.md
  // §9.3), sengaja menyertakan kunci jawaban `correct`/`why` untuk membuktikan
  // skema PUBLIK membuangnya, bukan cuma "kebetulan" tidak memakainya.
  const rawCardWithAnswerKey = {
    id: '8f2b6b7a-2f1e-4a8a-9c1a-0f2a8c9b1234',
    kind: 'multiple_choice' as const,
    prompt: 'Apa ibu kota Indonesia?',
    content: {
      options: [
        { id: 'opt_a', text: 'Bandung', correct: false, why: 'Bandung bukan ibu kota.' },
        { id: 'opt_b', text: 'Jakarta', correct: true, why: 'Jakarta adalah ibu kota.' },
      ],
    },
    sort_order: 1,
  };

  it('mem-parse opsi TANPA membawa correct/why ke output runtime', () => {
    const result = lessonCardResponseSchema.parse(rawCardWithAnswerKey);

    for (const option of result.content.options) {
      expect(option).not.toHaveProperty('correct');
      expect(option).not.toHaveProperty('why');
      // z.object() non-strict tetap MEM-STRIP field yang tidak didefinisikan
      // di skema saat parsing (bukan hanya "mengabaikan" secara tipe) —
      // dibuktikan dengan membandingkan key set persis.
      expect(Object.keys(option).sort()).toEqual(['id', 'text']);
    }
  });

  it('lessonCardOptionResponseSchema.strict() menolak field asing correct/why', () => {
    // .strict() membuat parsing GAGAL kalau ada properti asing — bukti kedua,
    // di lapisan validasi, bahwa correct/why bukan bagian sah dari kontrak.
    const strictSchema = lessonCardOptionResponseSchema.strict();
    const result = strictSchema.safeParse({
      id: 'opt_b',
      text: 'Jakarta',
      correct: true,
      why: 'Jakarta adalah ibu kota.',
    });

    expect(result.success).toBe(false);
  });

  it('tipe TypeScript LessonCardOptionResponse tidak punya properti correct/why', () => {
    // Bukti di level TIPE (bukan cuma runtime): kalau field ini pernah
    // ditambahkan lagi ke lessonCardOptionResponseSchema secara tidak sengaja,
    // baris expectTypeOf ini akan gagal type-check (bukan cuma gagal test).
    expectTypeOf<LessonCardOptionResponse>().not.toHaveProperty('correct');
    expectTypeOf<LessonCardOptionResponse>().not.toHaveProperty('why');
    expectTypeOf<LessonCardOptionResponse>().toEqualTypeOf<{ id: string; text: string }>();
  });
});
