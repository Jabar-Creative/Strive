/**
 * Mesin lonceng notifikasi + banner peringatan streak — N-02.
 *
 * Aturan tampilan yang bukan render hidup di sini sebagai fungsi murni
 * (pola C-03/L-04) supaya teruji tanpa browser. Tiga hal yang SENGAJA tidak
 * ada di file ini:
 *
 * 1. MENGHITUNG belum dibaca. Angka datang dari `unread_count` respons
 *    server (dihitung Postgres) dan hanya DIGESER saat optimistik — tidak
 *    pernah dihitung ulang dari panjang daftar (halaman terpotong `limit`,
 *    AC "akurat" akan salah bagi pengguna yang lama tidak membuka aplikasi).
 * 2. fetch dan DOM — hidup di komponen.
 * 3. Jam proses. Stempel waktu masuk sebagai parameter eksplisit supaya
 *    test deterministik; `waktuRelatif` membandingkan dua nilai yang dikasih.
 */

import type { ListNotificationsResponse, Notification, NotificationKind } from '@strive/contracts';

export type BellFase = 'memuat' | 'siap' | 'gagal' | 'tanpaSesi';

export interface NotificationBellState {
  fase: BellFase;
  /**
   * Halaman pertama (terbaru-dulu, limit 20). Panel lonceng TIDAK memuat
   * lebih jauh — NO-5 membatasi 3 notifikasi/hari sehingga 20 baris ≈
   * sepekan penuh; cursor di API tetap tersedia bila kelak dibutuhkan.
   */
  notifikasi: Notification[];
  /** Dari `unread_count` server; digeser optimistik lalu dipulihkan bila gagal. */
  belumDibaca: number;
  /** Id yang sedang di-PATCH — penjaga klik ganda di MESIN, bukan cuma tombol. */
  sedangDitandai: string[];
  /** Kontrak galat (`code` saja) — null saat tidak ada. */
  galat: { code: string } | null;
}

/** Sebelum GET /notifications pertama kembali. */
export function mulaiBell(): NotificationBellState {
  return { fase: 'memuat', notifikasi: [], belumDibaca: 0, sedangDitandai: [], galat: null };
}

/** Respons GET /notifications tiba. */
export function bellTiba(res: ListNotificationsResponse): NotificationBellState {
  return {
    ...mulaiBell(),
    fase: 'siap',
    notifikasi: res.data,
    belumDibaca: res.unread_count,
  };
}

/**
 * GET gagal. 401 (UNAUTHENTICATED) bukan galat yang perlu dilihat pengguna:
 * tamu tidak memakai lonceng, jadi komponen menyembunyikannya. Galat lain
 * tetap ditampilkan dengan kodenya.
 */
export function bellGagal(code: string): NotificationBellState {
  if (code === 'UNAUTHENTICATED') {
    return { ...mulaiBell(), fase: 'tanpaSesi' };
  }
  return { ...mulaiBell(), fase: 'gagal', galat: { code } };
}

function perbaruiItem(
  state: NotificationBellState,
  id: string,
  ubah: (n: Notification) => Notification,
): NotificationBellState {
  return {
    ...state,
    notifikasi: state.notifikasi.map((n) => (n.id === id ? ubah(n) : n)),
  };
}

/**
 * NO-7: menandai dibaca OPTIMISTIK. `kiniIso` eksplisit (bukan `new Date()`)
 * supaya test deterministik. Item yang sudah dibaca TIDAK diubah — menandainya
 * lagi idempoten (PRD §10.3), dan read_at lamanya dipertahankan.
 */
export function tandaiDibaca(
  state: NotificationBellState,
  id: string,
  kiniIso: string,
): NotificationBellState {
  const item = state.notifikasi.find((n) => n.id === id);
  if (!item) return state;
  if (item.read_at !== null) return state;
  if (state.sedangDitandai.includes(id)) return state;
  return {
    ...perbaruiItem(state, id, (n) => ({ ...n, read_at: kiniIso })),
    belumDibaca: Math.max(0, state.belumDibaca - 1),
    sedangDitandai: [...state.sedangDitandai, id],
  };
}

/** PATCH berhasil — stempel `read_at` server menggantikan stempel optimistik. */
export function dibacaBerhasil(
  state: NotificationBellState,
  id: string,
  readAtIso: string,
): NotificationBellState {
  return {
    ...perbaruiItem(state, id, (n) => ({ ...n, read_at: readAtIso })),
    sedangDitandai: state.sedangDitandai.filter((x) => x !== id),
  };
}

/**
 * PATCH gagal — PULIHKAN (NO-7 "pulih kalau request gagal"): read_at kembali
 * null dan hitungan belum dibaca naik kembali. Pemulihan membalik hanya apa
 * yang optimistik lakukan; item yang memang sudah dibaca sejak awal tidak
 * menaikkan hitungan.
 */
export function dibacaGagal(state: NotificationBellState, id: string): NotificationBellState {
  const sudahTidakBerjalan = state.sedangDitandai.filter((x) => x !== id);
  const item = state.notifikasi.find((n) => n.id === id);
  // Hanya pulihkan kalau optimistiknya benar-benar terjadi (item pernah masuk
  // sedangDitandai) — tanpa ini, kegagalan untuk item orang lain/id asing
  // menaikkan hitungan buta.
  const pernahOptimistik = state.sedangDitandai.includes(id) && item?.read_at !== null;
  if (!pernahOptimistik) {
    return { ...state, sedangDitandai: sudahTidakBerjalan };
  }
  return {
    ...perbaruiItem(state, id, (n) => ({ ...n, read_at: null })),
    belumDibaca: state.belumDibaca + 1,
    sedangDitandai: sudahTidakBerjalan,
  };
}

/**
 * Banner Hub menampilkan PERINGATAN STREAK yang belum dibaca — daftar sudah
 * terbaru-dulu, jadi cukup yang pertama ber-kind streak_warning dan belum
 * dibaca. Setelah dibaca (banner ditutup), banner tidak muncul lagi.
 */
export function peringatanStreakTerbaru(state: NotificationBellState): Notification | null {
  return state.notifikasi.find((n) => n.kind === 'streak_warning' && n.read_at === null) ?? null;
}

/**
 * Selisih waktu sebagai teks pendek. `kiniIso` eksplisit supaya deterministik
 * di test; komponen yang memanggil menentukan "sekarang"-nya.
 */
export function waktuRelatif(iso: string, kiniIso: string): string {
  const selisihMs = Date.parse(kiniIso) - Date.parse(iso);
  const mnt = Math.floor(selisihMs / 60_000);
  if (mnt < 1) return 'baru saja';
  if (mnt < 60) return `${mnt} mnt lalu`;
  const jam = Math.floor(mnt / 60);
  if (jam < 24) return `${jam} jam lalu`;
  return `${Math.floor(jam / 24)} hari lalu`;
}

/**
 * Kamus label jenis — `Record<NotificationKind, string>` membuat jenis baru
 * yang lupa dipetakan GAGAL di typecheck, bukan menampilkan kodenya mentah
 * (pola yang sama dengan kamus jenis entri dompet C-03).
 */
export const labelJenis: Record<NotificationKind, string> = {
  streak_warning: 'Peringatan streak',
  league_change: 'Liga',
  job_done: 'Tugas AI selesai',
  review_validated: 'Review tervalidasi',
};
