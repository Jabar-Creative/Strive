/**
 * Mesin top-up dompet — P-04 (Dev B), PRD §7 E6 + §6.3.
 *
 * AC-nya satu kalimat: "Status 'menunggu pembayaran' jelas dan TIDAK
 * MENGGANTUNG SELAMANYA — ada polling status order dengan batas waktu."
 * Batas waktu hidup di sini sebagai hitungan detik yang DIGESER pemanggil
 * (jam tidak pernah hidup di mesin — pola C-03/S-03): komponen men-tick
 * tiap detik dan menembak GET /payments/orders/:id tiap beberapa detik.
 *
 * Tiga hal yang SENGAJA tidak ada di file ini:
 * 1. fetch dan jam — hidup di komponen;
 * 2. penambahan koin — PA-5: koin HANYA dari webhook bertanda tangan,
 *    layar ini hanya MEMBACA status order;
 * 3. pembukaan Snap — `redirectUrl` cukup diserahkan ke pemanggil.
 */

import type { CheckoutResponse, OrderResponse, PricingResponse } from '@strive/contracts';

/** Batas polling status order: 10 menit (batas QRIS lazim). */
export const BATAS_POLL_DETIK = 600;

export type TopupFase =
  'memuat' | 'siap' | 'menunggu' | 'berhasil' | 'selesai-gagal' | 'tenggang' | 'gagal';

export interface TopupState {
  fase: TopupFase;
  paket: PricingResponse['packages'];
  /** `code` paket terpilih — null = belum memilih. */
  terpilih: string | null;
  order: { id: string; coins: number; amountIdr: number } | null;
  /** URL Snap untuk dibuka pemanggil; reuse order tidak membawanya (PA-3). */
  redirectUrl: string | null;
  /** Sisa detik jendela polling; 0 pada fase tenggang. */
  sisaDetik: number;
  /** Koin yang masuk saat order lunas — dari order, bukan dihitung klien. */
  koinMasuk: number | null;
  /** Status akhir order untuk fase selesai-gagal (failed | expired). */
  statusAkhir: string | null;
  galat: { code: string } | null;
}

export function mulaiTopup(): TopupState {
  return {
    fase: 'memuat',
    paket: [],
    terpilih: null,
    order: null,
    redirectUrl: null,
    sisaDetik: 0,
    koinMasuk: null,
    statusAkhir: null,
    galat: null,
  };
}

/** GET /pricing tiba. Pra-peluncuran (PRICING_NOT_CONFIGURED) lewat paketGagal. */
export function paketTiba(state: TopupState, res: PricingResponse): TopupState {
  return { ...mulaiTopup(), fase: 'siap', paket: res.packages };
}

export function paketGagal(state: TopupState, code: string): TopupState {
  return { ...mulaiTopup(), fase: 'gagal', galat: { code } };
}

/** Menandai paket terpilih; kode asing diabaikan (tombol dari daftar sendiri). */
export function pilihPaket(state: TopupState, code: string): TopupState {
  if (!state.paket.some((p) => p.id === code)) return state;
  return { ...state, terpilih: code };
}

/**
 * Respons POST /payments/checkout (⚡ idempoten). Baik respons baru (memuat
 * redirect_url) maupun reuse kunci (order pending tanpa redirect — PA-3)
 * masuk fase menunggu: yang membedakan cuma apakah Snap bisa dibuka lagi.
 */
export function checkoutTiba(state: TopupState, res: CheckoutResponse): TopupState {
  const paket = state.paket.find((p) => p.id === state.terpilih);
  return {
    ...state,
    fase: 'menunggu',
    order: {
      id: res.order_id,
      coins: paket?.coins ?? 0,
      amountIdr: paket?.price_idr ?? 0,
    },
    redirectUrl: res.redirect_url || null,
    sisaDetik: BATAS_POLL_DETIK,
    galat: null,
  };
}

/** Checkout gagal (404 rute belum ada — isu #233, vendor, dsb.): kembali memilih. */
export function checkoutGagal(state: TopupState, code: string): TopupState {
  return { ...state, fase: 'siap', galat: { code } };
}

/**
 * Satu detik berlalu. Nol → TENGGANG: polling berhenti dengan pesan jelas,
 * bukan menggantung selamanya (AC). Setelah tenggang, state stabil —
 * detik berikutnya tidak mengubah apa pun.
 */
export function detikBerlalu(state: TopupState): TopupState {
  if (state.fase !== 'menunggu') return state;
  const sisa = state.sisaDetik - 1;
  if (sisa > 0) return { ...state, sisaDetik: sisa };
  return { ...state, fase: 'tenggang', sisaDetik: 0 };
}

/**
 * Status order hasil polling. Respons yang datang SETELAH fase selesai
 * ditolak diam-diam — pola yang sama dengan ledger terlambat di C-03:
 * menumpuk status baru ke layar yang sudah pindah babak hanya membingungkan.
 *
 * `coins`/`amountIdr` SELALU ditimpa dari respons server: harga tampilan
 * awalnya berasal dari daftar paket lokal, dan versi harga bisa berganti
 * antara GET /pricing dan checkout (temuan audit P-04 — PA-4: order membawa
 * harga versinya sendiri, layar wajib menampilkan harga order, bukan harga
 * daftar).
 */
export function orderTiba(state: TopupState, res: OrderResponse): TopupState {
  if (state.fase !== 'menunggu') return state;
  const dasar = {
    ...state,
    order: state.order ? { ...state.order, coins: res.coins, amountIdr: res.amount_idr } : null,
  };
  if (res.status === 'paid') {
    return { ...dasar, fase: 'berhasil', koinMasuk: res.coins, statusAkhir: 'paid' };
  }
  if (res.status === 'failed' || res.status === 'expired') {
    return { ...dasar, fase: 'selesai-gagal', statusAkhir: res.status };
  }
  return dasar; // pending — terus menunggu selama sisaDetik masih ada.
}

/**
 * Hanya URL Snap Midtrans (https + host allowlist) yang boleh dibuka.
 * `z.string().url()` di kontrak LOLOS untuk skema `javascript:`/`data:`
 * (temuan audit P-04) — URL ini berakhir dibuka window.open, dan biarpun
 * sumbernya API sendiri, defense-in-depth di pintu terakhir murah.
 */
const HOST_SNAP = new Set(['app.midtrans.com', 'app.sandbox.midtrans.com']);

export function urlSnapAman(url: string | null): url is string {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && HOST_SNAP.has(u.hostname);
  } catch {
    return false;
  }
}
