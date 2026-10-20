import { describe, expect, it } from 'vitest';

import type { PurchaseStoreItemResponse, StoreItem } from '@strive/contracts';

import {
  beliGagal,
  beliTiba,
  itemsGagal,
  itemsTiba,
  labelJenisStore,
  mulaiBeli,
  unduhGagal,
} from './store-screen';

/** Mesin etalase ST-02 — perilaku tampilan yang tidak butuh browser. */

function item(n: Partial<StoreItem> & { id: string }): StoreItem {
  return {
    slug: 'x',
    title: 'X',
    kind: 'prompt_library',
    price_coins: 300,
    is_active: true,
    owned: false,
    purchase_id: null,
    ...n,
  };
}

const BELI: PurchaseStoreItemResponse = {
  purchase_id: '00000000-0000-4000-8000-00000005c001',
  item_id: 'item-1',
  price_coins: 300,
  balance: 3700,
};

describe('etalase', () => {
  it('items tiba → siap; galat → fase gagal ber-kode', () => {
    expect(itemsTiba([item({ id: 'a' })]).fase).toBe('siap');
    const g = itemsGagal('UNAUTHENTICATED');
    expect(g.fase).toBe('gagal');
    expect(g.galat?.code).toBe('UNAUTHENTICATED');
  });
});

describe('beli', () => {
  it('sukses: item jadi owned + purchase_id tercatat, saldo = kata server', () => {
    let s = itemsTiba([item({ id: 'item-1' }), item({ id: 'b' })]);
    s = mulaiBeli(s, 'item-1');
    s = beliTiba(s, 'item-1', BELI);
    expect(s.items[0]?.owned).toBe(true);
    expect(s.items[0]?.purchase_id).toBe(BELI.purchase_id);
    expect(s.saldo).toBe(3700); // dari respons, bukan 4000-300 dihitung klien
    expect(s.sedangBeli).toBeNull();
  });

  it('guard klik ganda: beli kedua saat pertama berjalan ditahan mesin', () => {
    let s = itemsTiba([item({ id: 'a' }), item({ id: 'b' })]);
    s = mulaiBeli(s, 'a');
    s = mulaiBeli(s, 'b'); // ditahan — sedangBeli masih 'a'
    expect(s.sedangBeli).toBe('a');
  });

  it('ALREADY_PURCHASED: owned disinkronkan, bukan dipersalahkan', () => {
    let s = itemsTiba([item({ id: 'item-1' })]);
    s = mulaiBeli(s, 'item-1');
    s = beliGagal(s, 'item-1', 'ALREADY_PURCHASED', true);
    expect(s.items[0]?.owned).toBe(true);
    expect(s.sedangBeli).toBeNull();
  });

  it('INSUFFICIENT_COINS: galat ber-kode, item tetap belum dimiliki', () => {
    let s = itemsTiba([item({ id: 'a', price_coins: 1500 })]);
    s = mulaiBeli(s, 'a');
    s = beliGagal(s, 'a', 'INSUFFICIENT_COINS');
    expect(s.items[0]?.owned).toBe(false);
    expect(s.galat?.code).toBe('INSUFFICIENT_COINS');
  });
});

describe('unduh', () => {
  it('galat unduh tercatat terpisah dari galat beli', () => {
    const s = unduhGagal(itemsTiba([item({ id: 'a', owned: true })]), 'NOT_FOUND');
    expect(s.unduhGagal).toBe('NOT_FOUND');
    expect(s.galat).toBeNull();
  });
});

describe('labelJenisStore', () => {
  it('tiga kind SR-1 punya label', () => {
    expect(Object.keys(labelJenisStore)).toHaveLength(3);
  });
});
