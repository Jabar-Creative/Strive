/**
 * Mesin antrean review + form rubrik — PR-03 (Dev B), PRD §7 E11.
 *
 * Dua sumber kebenaran yang TIDAK dimiliki berkas ini dan karena itu
 * dijaga lewat spec:
 * 1. Daftar kriteria rubrik ditetapkan PRD PR-10 (tetap, empat kriteria,
 *    0..5). Penjaga drift membaca `docs/PRD.md` langsung — pola yang sama
 *    dengan `error-codes.spec.ts` di API. Server tetap pemutus akhir
 *    (`totalRubrik` di review.service); yang di sini hanya gerbang tampilan.
 * 2. Penilaian tetap di server (aturan keras 9): `rubrikLengkap` men-disable
 *    tombol kirim, bukan memvalidasi atas nama server.
 */

/** PRD PR-10 — tetap, urutan tampil mengikuti urutan PRD. */
export const RUBRIC_KRITERIA = ['kejelasan', 'ketepatan', 'kelengkapan', 'sitasi'] as const;
export type RubricKriteria = (typeof RUBRIC_KRITERIA)[number];

/** Nilai tertinggi per kriteria — PRD PR-10. */
export const RUBRIC_MAKS = 5;
export const RUBRIC_TOTAL_MAKS = RUBRIC_KRITERIA.length * RUBRIC_MAKS;

/** Label + kalimat bantu per kriteria, untuk form rubrik. */
export const KUNCI_RUBRIK: Record<RubricKriteria, { label: string; bantu: string }> = {
  kejelasan: { label: 'Kejelasan', bantu: 'argumen mudah diikuti' },
  ketepatan: { label: 'Ketepatan', bantu: 'menjawab tugas yang diminta' },
  kelengkapan: { label: 'Kelengkapan', bantu: 'bagian penting tidak hilang' },
  sitasi: { label: 'Sitasi', bantu: 'sumber dirujuk dengan benar' },
};

/** Satu item GET /reviews/queue — TANPA identitas penulis (PR-2, by design). */
export interface AntreanItem {
  attempt_id: string;
  attempt_date: string;
  lesson_id: string;
  lesson_title: string;
  card_results: unknown;
  /** 0 atau 1: sudah ada berapa reviewer yang mengirim. */
  reviews_so_far: number;
}

/** Bentuk POST /reviews/:id saat sukses — review.service `SubmitReviewResult`. */
export interface HasilSubmit {
  id: string;
  weighted_points: number;
  scored_today: number;
  capped: boolean;
}

/**
 * Draf penilaian untuk SATU attempt. `kunci` adalah kunci idempoten milik
 * PERCOBAAN (pola checkout/payment): retry atas pengiriman yang sama memakai
 * kunci yang sama, dan karena ikut tersimpan di draf, retry setelah tutup
 * halaman pun masih kunci yang sama.
 */
export interface DrafReview {
  skor: Partial<Record<RubricKriteria, number>>;
  komentar: string;
  kunci: string;
}

/**
 * Kunci draf LINGKUP PER PENGGUNA (temuan audit PR-03). Tanpa `userId`, dua
 * akun yang berbagi satu profil browser (komputer lab/kos) saling mewarisi
 * draf — termasuk komentarnya. Kunci idempoten di dalamnya aman tabrakan
 * lintas pengguna sejak migrasi 010 (idempotensi per pengguna); yang
 * dilindungi di sini privasi drafnya.
 */
const KUNCI_DRAF = (userId: string, attemptId: string) =>
  `strive:draf-review:v1:${userId}:${attemptId}`;

/** Abstraksi penyimpanan — bentuk sama dengan localStorage, bisa ditiru di test. */
export interface Penyimpanan {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

function penyimpananBawaan(): Penyimpanan | null {
  if (typeof window === 'undefined') return null; // SSR: bukan kesalahan, cuma belum ada
  try {
    return window.localStorage;
  } catch {
    return null; // privacy mode dsb.
  }
}

export function mulaiDraf(): DrafReview {
  return { skor: {}, komentar: '', kunci: crypto.randomUUID() };
}

/**
 * Simpan draf. Gagal menyimpan (quota, private mode) BUKAN kesalahan yang
 * boleh menjatuhkan layar — draf adalah kenyamanan, bukan kebutuhan hidup.
 */
export function simpanDraf(p: Penyimpanan, userId: string, attemptId: string, d: DrafReview): void {
  try {
    p.setItem(KUNCI_DRAF(userId, attemptId), JSON.stringify(d));
  } catch {
    /* diam: lihat catatan fungsi */
  }
}

/**
 * Muat draf. Null untuk: tidak ada, JSON rusak, atau bentuk tidak sah
 * (kriteria asing, nilai tidak bulat/di luar 0..5, kunci idempoten hilang).
 * Draf yang tidak sah dibuang — server akan menolak isinya, membiarkannya
 * tampil hanya menipu pengguna bahwa penilaiannya masih ada.
 */
export function muatDraf(p: Penyimpanan, userId: string, attemptId: string): DrafReview | null {
  let mentah: string | null = null;
  try {
    mentah = p.getItem(KUNCI_DRAF(userId, attemptId));
  } catch {
    return null;
  }
  if (mentah === null) return null;

  const buang = () => {
    try {
      p.removeItem(KUNCI_DRAF(userId, attemptId));
    } catch {
      /* diam */
    }
    return null;
  };

  let hasil: unknown;
  try {
    hasil = JSON.parse(mentah);
  } catch {
    return buang();
  }
  if (typeof hasil !== 'object' || hasil === null) return buang();
  const d = hasil as Partial<DrafReview>;
  if (typeof d.kunci !== 'string' || d.kunci.length === 0) return buang();
  if (typeof d.komentar !== 'string') return buang();
  if (typeof d.skor !== 'object' || d.skor === null) return buang();

  const skor: Partial<Record<RubricKriteria, number>> = {};
  for (const [k, v] of Object.entries(d.skor)) {
    if (!(RUBRIC_KRITERIA as readonly string[]).includes(k)) return buang();
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > RUBRIC_MAKS) return buang();
    skor[k as RubricKriteria] = v;
  }
  return { skor, komentar: d.komentar, kunci: d.kunci };
}

/** Buang draf — dipanggil setelah kirim sukses (draf selesai hidupnya). */
export function hapusDraf(p: Penyimpanan, userId: string, attemptId: string): void {
  try {
    p.removeItem(KUNCI_DRAF(userId, attemptId));
  } catch {
    /* diam */
  }
}

/**
 * Gerbang kirim di sisi tampilan — cermin `totalRubrik` di server: kunci
 * asing ditolak (bukan diabaikan), keempat kriteria wajib, bulat, 0..5.
 * Sisi UI memang tidak bisa menghasilkan kunci asing; cermin tetap dibuat
 * setia supaya jalurnya tidak berpisah diam-diam.
 */
export function rubrikLengkap(skor: Record<string, number | undefined>): boolean {
  const asing = Object.keys(skor).filter(
    (k) => !(RUBRIC_KRITERIA as readonly string[]).includes(k),
  );
  if (asing.length > 0) return false;
  return RUBRIC_KRITERIA.every((k) => {
    const v = skor[k];
    return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= RUBRIC_MAKS;
  });
}

/** Total untuk ditampilkan live — kunci asing diabaikan, draf kosong = 0. */
export function totalRubrik(skor: Record<string, number | undefined>): number {
  return RUBRIC_KRITERIA.reduce((t, k) => t + (typeof skor[k] === 'number' ? skor[k]! : 0), 0);
}

/** Pesan hasil kirim — capped berarti TERSIMPAN tanpa poin (AC-PR-3), bukan gagal. */
export function pesanHasil(h: HasilSubmit): string {
  if (h.capped) {
    return `Review tersimpan tanpa poin — jatah ${h.scored_today} review berpoin hari ini sudah habis (PR-4).`;
  }
  return `Review tersimpan. +${h.weighted_points} poin (${h.scored_today}/5 review berpoin hari ini).`;
}

/** Pesan galat ber-`code` — klien tidak pernah mem-parsing message server. */
export function pesanGalatReview(kode: string): string {
  switch (kode) {
    case 'SELF_REVIEW_FORBIDDEN':
      return 'Ini karya kamu sendiri — tidak bisa dinilai sendiri.';
    case 'ALREADY_PURCHASED':
      return 'Attempt ini sudah punya kedua reviewernya.';
    case 'KEY_CONFLICT':
      return 'Penilaian ini sedang dikirim di tempat lain. Tunggu sebentar lalu cek lagi.';
    case 'VALIDATION_ERROR':
      return 'Penilaian belum sah — periksa keempat kriteria terisi 0..5.';
    case 'UNAUTHENTICATED':
      return 'Sesi berakhir. Masuk ulang, draf penilaianmu tetap tersimpan.';
    default:
      return `Kirim gagal (${kode}). Coba lagi — draf penilaianmu tetap tersimpan.`;
  }
}

export { penyimpananBawaan };
