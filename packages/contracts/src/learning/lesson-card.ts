import { z } from 'zod';
import { uuidSchema } from '../common';

/** docs/PRD.md §9.2 ENUM `card_kind`. */
export const cardKindSchema = z.enum(['multiple_choice', 'swipe_binary', 'order_steps', 'reveal']);
export type CardKind = z.infer<typeof cardKindSchema>;

/**
 * Bentuk INTERNAL `lesson_cards.content` — docs/PRD.md §9.3 + CLAUDE.md
 * "Serializer membuang kunci jawaban": `{ options: [{ id, text, correct, why }] }`.
 *
 * SENGAJA TIDAK di-export dari file ini maupun dari barrel domain (`./index`)
 * — lihat `lessonCardResponseSchema` di bawah. Ini murni referensi bentuk
 * kolom database untuk dokumentasi tipe; tidak ada kode client yang boleh
 * mengimpornya, jadi tidak ada jalan untuk `correct`/`why` bocor ke
 * `GET /lessons/:id/cards` lewat tipe TypeScript.
 */
const lessonCardOptionInternalSchema = z.object({
  id: z.string(),
  text: z.string(),
  correct: z.boolean(),
  why: z.string(),
});

/**
 * Opsi kartu versi PUBLIK — CLAUDE.md aturan #9 (penilaian selalu di server,
 * kunci jawaban dibuang sebelum respons). Diturunkan dari skema internal
 * dengan `.pick()` supaya keduanya TIDAK PERNAH bisa diverifikasi manual
 * (bebas dari typo diam-diam menyalin field yang salah) — silih beda field
 * antara publik dan internal terlihat langsung sebagai daftar `pick`.
 *
 * TIDAK PUNYA `correct` maupun `why` — ini yang membuat GET /lessons/:id/cards
 * bocor kunci jawaban jadi error kompilasi kalau suatu saat field itu
 * ditambahkan lagi secara tidak sengaja di sini.
 */
export const lessonCardOptionResponseSchema = lessonCardOptionInternalSchema.pick({
  id: true,
  text: true,
});
export type LessonCardOptionResponse = z.infer<typeof lessonCardOptionResponseSchema>;

/**
 * GET /lessons/:id/cards — docs/PRD.md §10.3 ("Kunci jawaban dibuang di
 * serializer") dan §7 E2 aturan LE-3 / AC-LE-5.
 *
 * ASUMSI: bentuk `content` yang didokumentasikan (CLAUDE.md) adalah pola
 * `{ options: [...] }` yang sama untuk `multiple_choice` dan `swipe_binary`
 * (dua kind yang diimplementasikan di v0.1 — §7 E2). `order_steps`/`reveal`
 * ada di enum tapi belum ada di UI, jadi bentuk content-nya belum
 * didokumentasikan PRD; kalau nanti diaktifkan, field content perlu di-union
 * per `kind`.
 */
export const lessonCardResponseSchema = z.object({
  id: uuidSchema,
  kind: cardKindSchema,
  prompt: z.string(),
  content: z.object({
    options: z.array(lessonCardOptionResponseSchema),
  }),
  sort_order: z.number().int(),
});
export type LessonCardResponse = z.infer<typeof lessonCardResponseSchema>;

export const lessonCardsResponseSchema = z.array(lessonCardResponseSchema);
export type LessonCardsResponse = z.infer<typeof lessonCardsResponseSchema>;
