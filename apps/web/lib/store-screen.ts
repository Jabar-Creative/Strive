/**
 * Mesin etalase store — ST-02 (Dev B), PRD §7 E14.
 *
 * Aturan tampilan yang bukan render hidup di sini (pola C-03/L-04):
 * - saldo TIDAK PERNAH dihitung klien — `PurchaseStoreItemResponse.balance`
 *   adalah kata server (aturan keras 2);
 * - ALREADY_PURCHASED bukan galat bagi pengguna: etalase menyinkronkan
 *   `owned` (SR-2: satu item sekali — keadaan balapan yang kalah wajar);
 * - unduh hanya mencatat KEBUTUHAN (purchase_id + pesan); membuka URL
 *   ditandatangani server adalah urusan komponen.
 */

import type { PurchaseStoreItemResponse, StoreItem, StoreItemKind } from '@strive/contracts';

export type StoreFase = 'memuat' | 'siap' | 'gagal';

export interface StoreState {
  fase: StoreFase;
  items: StoreItem[];
  /** Id item yang POST /store/purchase-nya sedang berjalan — guard klik ganda. */
  sedangBeli: string | null;
  /** Saldo terakhir kata server (dari respons pembelian); null = belum tahu. */
  saldo: number | null;
  galat: { code: string } | null;
  unduhGagal: string | null;
}

export function mulaiStore(): StoreState {
  return {
    fase: 'memuat',
    items: [],
    sedangBeli: null,
    saldo: null,
    galat: null,
    unduhGagal: null,
  };
}

/** GET /store/items tiba (etalase + penanda owned + purchase_id). */
export function itemsTiba(items: StoreItem[]): StoreState {
  return { ...mulaiStore(), fase: 'siap', items };
}

export function itemsGagal(code: string): StoreState {
  return { ...mulaiStore(), fase: 'gagal', galat: { code } };
}

/** Tombol beli ditekan — penjaga klik ganda di MESIN, tombol disabled cuma lapis pertama. */
export function mulaiBeli(state: StoreState, itemId: string): StoreState {
  if (state.sedangBeli !== null) return state;
  return { ...state, sedangBeli: itemId, galat: null };
}

/** POST /store/purchase sukses: item jadi milik, saldo mengikuti kata server. */
export function beliTiba(
  state: StoreState,
  itemId: string,
  res: PurchaseStoreItemResponse,
): StoreState {
  return {
    ...state,
    sedangBeli: null,
    saldo: res.balance,
    items: state.items.map((i) =>
      i.id === itemId ? { ...i, owned: true, purchase_id: res.purchase_id } : i,
    ),
  };
}

/**
 * POST /store/purchase gagal. ALREADY_PURCHASED = kondisi balapan yang kalah:
 * etalase menyinkronkan owned supaya tombol berubah menjadi Unduh — bukan
 * pesan galat yang menyalahkan pengguna.
 */
export function beliGagal(
  state: StoreState,
  itemId: string,
  code: string,
  owned?: boolean,
): StoreState {
  const dasar =
    owned === true
      ? {
          ...state,
          items: state.items.map((i) => (i.id === itemId ? { ...i, owned: true } : i)),
        }
      : state;
  return { ...dasar, sedangBeli: null, galat: { code } };
}

/** URL unduhan tiba → komponen membukanya; mesin hanya mencatat galat. */
export function unduhGagal(state: StoreState, code: string): StoreState {
  return { ...state, unduhGagal: code };
}

/**
 * Kamus label jenis — `Record<StoreItemKind, string>` membuat jenis baru yang
 * lupa dipetakan GAGAL di typecheck (pola kamus C-03/N-02).
 */
export const labelJenisStore: Record<StoreItemKind, string> = {
  prompt_library: 'Pustaka prompt',
  workspace_template: 'Template kerja',
  design_asset: 'Aset desain',
};
