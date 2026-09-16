import { describe, expect, it } from 'vitest';

import { stripAnswerKeys, ANSWER_KEY_FIELDS } from './content.serializer';

/**
 * Serializer ini satu-satunya yang berdiri antara kunci jawaban di database
 * dan client. Kalau ia bocor, seluruh mekanisme skor kehilangan artinya —
 * dan bocornya tidak akan terlihat di UI, cuma di tab network.
 *
 * Karena itu diuji dua arah: bentuk yang sudah diketahui (snapshot), DAN
 * bentuk yang belum ada tipe kartunya (rekursif, sembarang kedalaman).
 */
describe('stripAnswerKeys', () => {
  it('membuang `correct` dan `why` dari options multiple_choice', () => {
    const mentah = {
      options: [
        { id: 'opt_a', text: 'Jawaban A', correct: true, why: 'Karena fakta X' },
        { id: 'opt_b', text: 'Jawaban B', correct: false, why: 'Keliru karena Y' },
      ],
    };

    expect(stripAnswerKeys(mentah)).toEqual({
      options: [
        { id: 'opt_a', text: 'Jawaban A' },
        { id: 'opt_b', text: 'Jawaban B' },
      ],
    });
  });

  it('membuang kunci jawaban di KEDALAMAN BERAPA PUN, bukan cuma di options[]', () => {
    // Tipe kartu `order_steps` dan `reveal` ada di skema tapi belum di UI
    // (docs/PRD.md §22). Bentuk content-nya belum ditetapkan, jadi serializer
    // tidak boleh mengandalkan jalur `options[]` yang spesifik — kalau ia
    // menebak bentuk, tipe kartu berikutnya bocor tanpa ada yang menyadarinya.
    const mentah = {
      prompt: 'Urutkan langkahnya',
      steps: [
        { id: 's1', label: 'Pertama', meta: { correct: 1, why: 'harus di awal' } },
        { id: 's2', label: 'Kedua', meta: { correct: 2, why: 'menyusul' } },
      ],
      reveal: { body: 'Penjelasan', correct: 'tidak relevan' },
    };

    const bersih = stripAnswerKeys(mentah);
    expect(JSON.stringify(bersih)).not.toMatch(/"correct"|"why"/);
    expect(bersih).toEqual({
      prompt: 'Urutkan langkahnya',
      steps: [
        { id: 's1', label: 'Pertama', meta: {} },
        { id: 's2', label: 'Kedua', meta: {} },
      ],
      reveal: { body: 'Penjelasan' },
    });
  });

  it('tidak mengubah apa pun kalau memang tidak ada kunci jawaban', () => {
    const mentah = { options: [{ id: 'a', text: 'A' }] };
    expect(stripAnswerKeys(mentah)).toEqual(mentah);
  });

  it('menangani null, primitif, dan array kosong tanpa melempar', () => {
    expect(stripAnswerKeys(null)).toBeNull();
    expect(stripAnswerKeys(42)).toBe(42);
    expect(stripAnswerKeys('correct')).toBe('correct'); // nilai, bukan nama field
    expect(stripAnswerKeys([])).toEqual([]);
  });

  it('daftar field yang dibuang adalah persis yang disebut LE-3', () => {
    // Kalau seseorang menambah field kunci jawaban baru di skema kartu, ia
    // harus menambahkannya di sini juga — dan test ini yang mengingatkannya.
    expect([...ANSWER_KEY_FIELDS].sort()).toEqual(['correct', 'why']);
  });

  it('snapshot respons mentah: nol kemunculan `correct` dan `why`', () => {
    const kartu = {
      id: 'c1',
      kind: 'multiple_choice',
      prompt: 'Mana yang benar?',
      content: {
        options: [
          { id: 'opt_a', text: 'A', correct: true, why: 'sebab A' },
          { id: 'opt_b', text: 'B', correct: false, why: 'sebab B' },
        ],
      },
      sort_order: 0,
    };

    expect(stripAnswerKeys(kartu)).toMatchInlineSnapshot(`
      {
        "content": {
          "options": [
            {
              "id": "opt_a",
              "text": "A",
            },
            {
              "id": "opt_b",
              "text": "B",
            },
          ],
        },
        "id": "c1",
        "kind": "multiple_choice",
        "prompt": "Mana yang benar?",
        "sort_order": 0,
      }
    `);
  });
});
