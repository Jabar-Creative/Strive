/**
 * Mesin layar dompet — C-03.
 *
 * Seluruh aturan tampilan yang bukan render hidup di file ini sebagai fungsi
 * murni supaya teruji tanpa browser (pola L-04). Tiga hal yang SENGAJA tidak
 * ada di sini:
 *
 * 1. Penjumlahan/penilaian saldo. `saldo` dan `balance_after` hanya
 *    dilewatkan dari respons server, tidak pernah dihitung ulang — kebenaran
 *    saldo ada di `SUM(coin_ledger.amount)` di server (CLAUDE.md aturan 2).
 * 2. fetch dan DOM — pemanggilan API hidup di komponen, bukan di mesin.
 * 3. Jam proses. Waktu masuk sebagai string ISO; `formatWaktu` memakai
 *    zona waktu EKSPLISIT supaya hasilnya deterministik di test.
 */

import type {
  CoinEntryType,
  CoinLedgerEntry,
  WalletLedgerResponse,
  WalletResponse,
} from '@strive/contracts';
// Nilai, bukan tipe — web boleh; API tidak (ERR_UNSUPPORTED_DIR_IMPORT).
import { WALLET_LEDGER_LIMIT_DEFAULT } from '@strive/contracts';

export type WalletFase = 'memuat' | 'gagal' | 'siap' | 'kosong';

export interface WalletState {
  fase: WalletFase;
  /** Dari `WalletResponse.balance` — cache server, tidak pernah dihitung sini. */
  saldo: number;
  /** recent_entries + halaman ledger yang sudah bergabung (dedupe per id). */
  entri: CoinLedgerEntry[];
  /**
   * Cursor halaman ledger berikutnya; `null` = riwayat sudah habis.
   * String buram dari server — tidak diparse, tidak direkayasa (§10.1).
   */
  cursorBerikutnya: string | null;
  /** Sudah pernah memanggil GET /wallet/ledger (transisi recent → lengkap). */
  sudahMuatLedger: boolean;
  /** Permintaan ledger sedang berjalan — mengunci tombol muat (klik ganda). */
  memuatLagi: boolean;
  /**
   * Galat terakhir sebagai KONTRAK (`code` saja, tanpa message — cabang pada
   * code, bukan message). Null saat tidak ada galat aktif.
   */
  galat: { code: string } | null;
}

/** State awal sebelum GET /wallet pertama kembali. */
export function mulaiWallet(): WalletState {
  return {
    fase: 'memuat',
    saldo: 0,
    entri: [],
    cursorBerikutnya: null,
    sudahMuatLedger: false,
    memuatLagi: false,
    galat: null,
  };
}

/**
 * Respons GET /wallet tiba. recent_entries kosong bukan error: pengguna baru
 * memang belum punya riwayat, dan layarnya wajib menjelaskan cara mendapat
 * koin (PRD §14.4 — tidak ada layar kosong tanpa cerita).
 */
export function walletTiba(res: WalletResponse): WalletState {
  return {
    ...mulaiWallet(),
    fase: res.recent_entries.length === 0 ? 'kosong' : 'siap',
    saldo: res.balance,
    entri: res.recent_entries,
  };
}

/** GET /wallet gagal (401, 5xx, jaringan). Satu-satunya jalan keluar: ulang. */
export function walletGagal(code: string): WalletState {
  return { ...mulaiWallet(), fase: 'gagal', galat: { code } };
}

/**
 * Satu halaman GET /wallet/ledger tiba: gabungkan dengan entri yang sudah
 * tampil lalu dedupe berdasarkan `id` — halaman pertama ledger tumpang
 * tindih dengan recent_entries, dan `id` bigserial dijamin unik.
 *
 * Respons ledger yang DATANG TERLAMBAT (setelah layar dimuat ulang dari
 * awal) ditolak diam-diam: menggabungkannya ke state yang sudah reset akan
 * menempel riwayat lama di atas saldo yang baru — pola tolak-diam-diam yang
 * sama dengan `answerCard` di L-04.
 */
export function ledgerTiba(state: WalletState, res: WalletLedgerResponse): WalletState {
  if (state.fase === 'memuat' || state.fase === 'gagal') return state;
  const sudahAda = new Set(state.entri.map((e) => e.id));
  const entri = [...state.entri, ...res.data.filter((e) => !sudahAda.has(e.id))];
  return {
    ...state,
    fase: entri.length === 0 ? 'kosong' : 'siap',
    entri,
    cursorBerikutnya: res.next_cursor,
    sudahMuatLedger: true,
    memuatLagi: false,
    galat: null,
  };
}

/**
 * Permintaan ledger dimulai. Klik ganda TIDAK boleh memicu request kedua:
 * begitu `memuatLagi` true, state dikembalikan apa adanya (guard mesin —
 * tombol yang disabled di komponen hanya lapis pertama).
 */
export function mulaiMuatLagi(state: WalletState): WalletState {
  if (state.memuatLagi) return state;
  return { ...state, memuatLagi: true, galat: null };
}

/**
 * Permintaan ledger gagal (mis. cursor basi → INVALID_CURSOR). Daftar yang
 * sudah tampil TETAP: galat hanya mengunci tombol dan menawarkan muat ulang
 * dari awal, tidak pernah membuang riwayat yang sudah ada di layar.
 */
export function muatLagiGagal(state: WalletState, code: string): WalletState {
  if (state.fase === 'memuat' || state.fase === 'gagal') return state;
  return { ...state, memuatLagi: false, galat: { code } };
}

/** "Coba lagi" dari layar gagal: mulai bersih dari GET /wallet. */
export function cobaLagi(): WalletState {
  return mulaiWallet();
}

/**
 * Tombol "Muat riwayat lengkap" hanya saat jendela recent_entries PENUH
 * dan ledger belum pernah dimuat. Penuh = mungkin ada lagi; kurang dari
 * itu = pasti habis. Batasnya dari KONTRAK (isu #182): kalau suatu hari
 * `.max()` di contracts berubah, tombol ini ikut — bukan hilang diam-diam.
 */
export function tampilTombolLengkap(state: WalletState): boolean {
  return state.entri.length === WALLET_LEDGER_LIMIT_DEFAULT && !state.sudahMuatLedger;
}

/** Setelah ledger pertama, "Muat lagi" hanya selama ada halaman berikutnya. */
export function tampilTombolLagi(state: WalletState): boolean {
  return state.sudahMuatLedger && state.cursorBerikutnya !== null;
}

export interface MetaEntri {
  /** Nama jenis entri yang dilihat pengguna — bukan istilah teknis mentah. */
  label: string;
  /** Kalimat penjelasan saat baris diketuk: kenapa saldo berubah. */
  alasan: string;
  /** Arah tampilan chip: masuk (＋), keluar (−), tahan (◌). */
  arah: 'masuk' | 'keluar' | 'tahan';
}

/**
 * Kamus 11 jenis entri ENUM `coin_entry` (docs/PRD.md §9.2) — inti AC C-03:
 * pengguna bisa menjawab sendiri "kenapa saldo saya berubah". `Record`
 * bertipe `CoinEntryType` membuat jenis baru yang lupa dipetakan GAGAL di
 * typecheck, bukan lolos diam-diam.
 */
const JENIS_META: Record<CoinEntryType, MetaEntri> = {
  earn_lesson: {
    label: 'Kartu lesson selesai',
    alasan: 'Koin dari menyelesaikan kartu belajar; jumlahnya diskalakan sesuai skormu.',
    arah: 'masuk',
  },
  earn_streak: {
    label: 'Bonus streak',
    alasan: 'Hadiah karena belajar beberapa hari berturut-turut.',
    arah: 'masuk',
  },
  earn_review: {
    label: 'Imbalan peer review',
    alasan: 'Koin dari menilai pekerjaan teman satu squad.',
    arah: 'masuk',
  },
  purchase: {
    label: 'Top-up paket koin',
    alasan: 'Koin yang kamu beli lewat paket top-up.',
    arah: 'masuk',
  },
  hold: {
    label: 'Ditahan untuk pekerjaan berjalan',
    alasan:
      'Koin dikunci sementara selama pekerjaan berjalan (mis. scan atau CV builder); bukan hilang, dan dikembalikan penuh kalau pekerjaan gagal.',
    arah: 'tahan',
  },
  settle: {
    // Menurut CO-8, settle TIDAK menulis entri ledger (penahanan cukup
    // ditandai selesai). Dipetakan tetap demi enum lengkap — kalau kontrak
    // berubah, baris ini siap tanpa perubahan UI.
    label: 'Penahanan dipakai',
    alasan: 'Pekerjaan selesai dan koin yang ditahan menjadi pembayaran final.',
    arah: 'keluar',
  },
  release: {
    label: 'Penahanan dikembalikan',
    alasan: 'Pekerjaan gagal atau dibatalkan, koin yang ditahan kembali penuh.',
    arah: 'masuk',
  },
  spend_store: {
    label: 'Pembelian di store',
    alasan: 'Tukar koin dengan aset di store.',
    arah: 'keluar',
  },
  spend_scan: {
    label: 'Scan plagiarisme',
    alasan: 'Bayar pemeriksaan dokumen di klinik plagiarisme.',
    arah: 'keluar',
  },
  spend_ai: {
    label: 'Fitur AI',
    alasan: 'Bayar fitur AI seperti CV builder, prompt lab, atau mastery.',
    arah: 'keluar',
  },
  adjust: {
    label: 'Koreksi saldo',
    alasan: 'Perbaikan dari sistem, bukan karena kesalahanmu.',
    // Nilai `arah` di sini TIDAK PERNAH dipakai untuk adjust: `arahTampil`
    // selalu menimpanya dari tanda `amount` karena koreksi bisa dua arah
    // (isu #182). Tetap diisi demi kelengkapan `Record` — jenis entri baru
    // yang lupa dipetakan harus GAGAL di typecheck.
    arah: 'keluar',
  },
};

export function metaEntri(entryType: CoinEntryType): MetaEntri {
  return JENIS_META[entryType];
}

/**
 * Arah tampilan SATU BARIS. Semua jenis mengikuti kamus, kecuali `adjust`:
 * koreksi bisa dua arah, jadi arahnya dibaca dari tanda `amount` — satu-satunya
 * tempat client boleh melihat tanda adalah untuk menampilkan, bukan menghitung.
 */
export function arahTampil(entry: CoinLedgerEntry): 'masuk' | 'keluar' | 'tahan' {
  if (entry.entry_type === 'adjust') return entry.amount >= 0 ? 'masuk' : 'keluar';
  return metaEntri(entry.entry_type).arah;
}

/**
 * Tanggal-jam tampilan. Zona waktu PARAMETER dengan default Asia/Jakarta
 * (isu #182): transaksi ini milik pengguna, dan pengguna di Asia/Makassar
 * berhak melihat jam Makassar untuk hal yang ia lakukan sendiri. Default
 * tetap eksplisit supaya test deterministik lintas mesin.
 *
 * Formatter DI-CACHE per zona: `Intl.DateTimeFormat` mahal dibangun, dan
 * riwayat koin memformat puluhan baris dengan zona yang sama.
 */
const ZONA_DEFAULT = 'Asia/Jakarta';
const cacheFormatWaktu = new Map<string, Intl.DateTimeFormat>();

function formatWaktuZona(zona: string): Intl.DateTimeFormat {
  let f = cacheFormatWaktu.get(zona);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat('id-ID', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: zona,
      });
    } catch {
      // Zona peramban tak valid (mis. "Etc/Unknown" dari Chromium yang gagal
      // memetakan zona OS) tidak boleh menjatuhkan layar dompet — jatuh ke
      // default mesin. Hasil fallback tetap DI-CACHE dengan kunci zona buruk
      // supaya tidak mencoba konstruksi ulang tiap baris riwayat.
      // (Temuan audit #182; kelas yang sama dengan pengerasan zona di
      // streak-status.)
      f = cacheFormatWaktu.get(ZONA_DEFAULT) ?? formatWaktuZona(ZONA_DEFAULT);
    }
    cacheFormatWaktu.set(zona, f);
  }
  return f;
}

export function formatWaktu(iso: string, zona: string = ZONA_DEFAULT): string {
  return formatWaktuZona(zona).format(new Date(iso));
}

/** Angka ribuan gaya Indonesia — "8.450", bukan "8,450". */
const FORMAT_ANGKA = new Intl.NumberFormat('id-ID');

export function formatAngka(n: number): string {
  return FORMAT_ANGKA.format(n);
}

/**
 * Teks meta di bawah label: `note` dari server (konteks transaksi, mis.
 * nama pekerjaan) MENGGANTIKAN teks bawaan kalau ada; kalau tidak, kalimat
 * alasan dari kamus.
 */
export function deskripsiBaris(entry: CoinLedgerEntry): string {
  return entry.note ?? metaEntri(entry.entry_type).alasan;
}
