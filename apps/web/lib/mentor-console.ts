/**
 * Mesin konsol mentor — PR-04 (Dev B), PRD §7 E11, §10.3 "Mentor".
 *
 * Ini layar KERJA mentor (profil kepadatan Console, §14.3): menyetujui /
 * menolak penilaian yang sudah dikirim anggota binaannya. Tiga hal yang
 * dijaga berkas ini:
 *
 * 1. Kriteria rubrik SAMA dengan form reviewer (PR-10) — diimpor dari
 *    `review-queue.ts`, bukan didefinisi ulang: dua sumber untuk satu daftar
 *    adalah cara dua layar itu diam-diam berbeda.
 * 2. Batas catatan 500 karakter — cermin `CATATAN_MAKS` di
 *    mentor.service. Server tetap pemutus; `maxLength` di sini hanya
 *    mencegah mentor menulis 501 karakter lalu kehilangan semuanya saat
 *    dikirim (aturan keras 9: UI tidak pernah memutuskan).
 * 3. Pesan galat ber-`code` — klien tidak pernah mem-parsing message
 *    server (kontrak §10.2).
 */

import { RUBRIC_KRITERIA, RUBRIC_MAKS } from './review-queue';

/** Cermin `CATATAN_MAKS` mentor.service — satu angka, dua sisi, satu spec. */
export const CATATAN_MAKS_MENTOR = 500;

/** Satu item `GET /mentor/queue` — TANPA identitas penulis (semangat PR-2). */
export interface AntreanMentorItem {
  id: string;
  reviewer_id: string;
  /** Anggota binaan mentor pemanggil — mentor MEMANG melihat ini. */
  reviewer_name: string;
  lesson_id: string;
  lesson_title: string;
  rubric_scores: Record<string, number>;
  comment: string | null;
  weighted_points: number;
  created_at: string;
}

/** Bentuk `POST /mentor/reviews/:id/validate` saat sukses — `HasilValidasi`. */
export interface HasilValidasi {
  review_id: string;
  decision: 'approve' | 'reject';
  awarded: boolean;
  coins: number;
  already_validated: boolean;
}

/**
 * Total skor rubrik seorang reviewer untuk ditampilkan di kartu antrean.
 * Kunci asing diabaikan (server yang menulis rubric_scores lewat gerbangnya
 * sendiri; layar tidak crash karena satu kunci tua).
 */
export function totalRubrikMentor(skor: Record<string, number>): number {
  return RUBRIC_KRITERIA.reduce((t, k) => t + (typeof skor[k] === 'number' ? skor[k]! : 0), 0);
}

/** Maks total = jumlah kriteria × nilai maks — untuk "x / 20". */
export const TOTAL_MAKS_MENTOR = RUBRIC_KRITERIA.length * RUBRIC_MAKS;

/** Pesan hasil validasi — satu tempat, dua keputusan, tiga keadaan koin. */
export function pesanHasilValidasi(h: HasilValidasi): string {
  if (h.already_validated) {
    return 'Review ini sudah divalidasi sebelumnya — keputusan pertama final.';
  }
  if (h.decision === 'approve' && h.awarded) {
    return `Disetujui. ${h.coins} koin tercatat untuk reviewer.`;
  }
  if (h.decision === 'approve') {
    return 'Disetujui — review ini di luar jatah berpoin harian, tanpa koin.';
  }
  return 'Ditolak dengan catatan. Reviewer tidak menerima koin.';
}

/** Pesan galat ber-`code` — cabang pada kode, bukan teks pesan. */
export function pesanGalatMentor(kode: string): string {
  switch (kode) {
    case 'VALIDATION_ERROR':
      return 'Keputusan belum sah — catatan wajib saat menolak (maks 500 karakter).';
    case 'FORBIDDEN_ROLE':
      return 'Review ini bukan dari anggota squad binaanmu.';
    case 'NOT_FOUND':
      return 'Review tidak ditemukan — mungkin sudah ditangani. Muat ulang antrean.';
    case 'UNAUTHENTICATED':
      return 'Sesi berakhir. Masuk ulang untuk melanjutkan.';
    default:
      return `Validasi gagal (${kode}). Coba lagi.`;
  }
}

/** Label keputusan untuk tombol — dipisah supaya testid tidak membawa teks. */
export const LABEL_APPROVE = 'Setujui';
export const LABEL_REJECT = 'Tolak';
