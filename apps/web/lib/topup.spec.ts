import { describe, expect, it } from 'vitest';

import type { CheckoutResponse, OrderResponse, PricingResponse } from '@strive/contracts';

import {
  BATAS_POLL_DETIK,
  checkoutGagal,
  checkoutTiba,
  detikBerlalu,
  mulaiTopup,
  orderTiba,
  paketGagal,
  paketTiba,
  pilihPaket,
  urlSnapAman,
} from './topup';

/**
 * Mesin top-up P-04 — AC backlog: "Status 'menunggu pembayaran' jelas dan
 * TIDAK MENGGANTUNG SELAMANYA — ada polling status order dengan BATAS WAKTU."
 * Batas waktu itu yang diuji di sini dengan detik EKSPLISIT (jam tidak pernah
 * hidup di mesin — pola C-03/S-03).
 */

const HARGA: PricingResponse = {
  version: 3,
  active_from: '2026-10-01T00:00:00.000Z',
  coin_price_idr: 25,
  scan_cost_coins: 2400,
  scan_cached_cost_coins: 1200,
  lesson_reward_coins: 14,
  cv_cost_coins: 1500,
  interview_cost_coins: 2000,
  statement_cost_coins: 2000,
  prompt_run_cost_coins: 20,
  freeze_cost_coins: 400,
  packages: [
    { id: 'starter', name: 'Starter', coins: 2200, price_idr: 55_000 },
    { id: 'reguler', name: 'Reguler', coins: 6000, price_idr: 150_000 },
    { id: 'skripsi', name: 'Skripsi', coins: 12000, price_idr: 300_000 },
  ],
};

const CHECKOUT: CheckoutResponse = {
  order_id: '00000000-0000-4000-8000-00000000p041',
  snap_token: 'tok-1',
  redirect_url: 'https://sandbox.midtrans.example/snap/xxx',
};

function order(status: OrderResponse['status']): OrderResponse {
  return {
    id: CHECKOUT.order_id,
    pricing_version: 3,
    coins: 2200,
    amount_idr: 55_000,
    status,
    provider: 'midtrans',
    paid_at: status === 'paid' ? '2026-10-18T08:00:00.000Z' : null,
    created_at: '2026-10-18T07:00:00.000Z',
  };
}

describe('paket & pilih', () => {
  it('paket tiba → siap memilih; galat → fase gagal dengan kode', () => {
    const siap = paketTiba(mulaiTopup(), HARGA);
    expect(siap.fase).toBe('siap');
    expect(siap.paket).toHaveLength(3);

    const gagal = paketGagal(mulaiTopup(), 'PRICING_NOT_CONFIGURED');
    expect(gagal.fase).toBe('gagal');
    expect(gagal.galat?.code).toBe('PRICING_NOT_CONFIGURED');
  });

  it('pilih paket menandai kode terpilih; memilih yang tak ada ditolak diam-diam', () => {
    let s = pilihPaket(paketTiba(mulaiTopup(), HARGA), 'reguler');
    expect(s.terpilih).toBe('reguler');
    s = pilihPaket(s, 'tidak-ada');
    expect(s.terpilih).toBe('reguler');
  });
});

describe('checkout', () => {
  it('sukses dengan redirect_url → fase menunggu + order + hitungan batas waktu', () => {
    const s = checkoutTiba(pilihPaket(paketTiba(mulaiTopup(), HARGA), 'starter'), CHECKOUT);
    expect(s.fase).toBe('menunggu');
    expect(s.order?.id).toBe(CHECKOUT.order_id);
    expect(s.sisaDetik).toBe(BATAS_POLL_DETIK);
    expect(s.redirectUrl).toBe(CHECKOUT.redirect_url);
  });

  it('respons reuse tanpa redirect_url tetap menunggu (order pending sah — PA-3)', () => {
    const s = checkoutTiba(pilihPaket(paketTiba(mulaiTopup(), HARGA), 'starter'), {
      ...CHECKOUT,
      snap_token: '',
      redirect_url: null as unknown as string,
    });
    expect(s.fase).toBe('menunggu');
    expect(s.redirectUrl).toBeNull();
  });

  it('galat checkout kembali ke siap dengan kodenya (404 rute belum ada, vendor, dsb.)', () => {
    const s = checkoutGagal(pilihPaket(paketTiba(mulaiTopup(), HARGA), 'starter'), 'NOT_FOUND');
    expect(s.fase).toBe('siap');
    expect(s.galat?.code).toBe('NOT_FOUND');
    expect(s.order).toBeNull();
  });
});

describe('polling dengan batas waktu — AC inti', () => {
  const menunggu = () =>
    checkoutTiba(pilihPaket(paketTiba(mulaiTopup(), HARGA), 'starter'), CHECKOUT);

  it('detik berjalan; mencapai nol → TENGGANG, polling berhenti (tidak menggantung)', () => {
    let s = menunggu();
    for (let i = 0; i < BATAS_POLL_DETIK; i++) s = detikBerlalu(s);
    expect(s.fase).toBe('tenggang');
    expect(s.sisaDetik).toBe(0);
    // Setelah tenggang, detik TIDAK menambah apa pun — state stabil.
    expect(detikBerlalu(s)).toEqual(s);
  });

  it('order paid di tengah hitungan → BERHASIL; failed → selesai-gagal dengan status', () => {
    const bayar = orderTiba(menunggu(), order('paid'));
    expect(bayar.fase).toBe('berhasil');
    expect(bayar.koinMasuk).toBe(2200);

    const gagal = orderTiba(menunggu(), order('failed'));
    expect(gagal.fase).toBe('selesai-gagal');
    expect(gagal.statusAkhir).toBe('failed');
  });

  it('order masih pending dan sisa waktu ada → tetap menunggu', () => {
    const s = orderTiba(menunggu(), order('pending'));
    expect(s.fase).toBe('menunggu');
    expect(s.sisaDetik).toBe(BATAS_POLL_DETIK);
  });

  it('status order setelah fase selesai diabaikan (respons terlambat ditolak diam-diam)', () => {
    const selesai = orderTiba(menunggu(), order('paid'));
    expect(orderTiba(selesai, order('failed')).fase).toBe('berhasil');
  });
});

describe('urlSnapAman — pintu terakhir sebelum window.open', () => {
  it('https + host Midtrans lolos; skema/host lain ditolak', () => {
    expect(urlSnapAman('https://app.sandbox.midtrans.com/snap/x')).toBe(true);
    expect(urlSnapAman('https://app.midtrans.com/snap/x')).toBe(true);
    expect(urlSnapAman('javascript:alert(1)')).toBe(false);
    expect(urlSnapAman('https://penipu.example/snap')).toBe(false);
    expect(urlSnapAman('http://app.midtrans.com/snap')).toBe(false); // http ditolak
    expect(urlSnapAman(null)).toBe(false);
  });
});

describe('harga menunggu mengikuti ORDER, bukan daftar lokal', () => {
  it('orderTiba menimpa coins/amountIdr dari respons server (PA-4)', () => {
    const s = checkoutTiba(pilihPaket(paketTiba(mulaiTopup(), HARGA), 'starter'), CHECKOUT);
    // Server membalas order dengan harga versi order (beda dari daftar lokal).
    const sesudah = orderTiba(s, {
      ...order('pending'),
      coins: 999,
      amount_idr: 12_345,
    });
    expect(sesudah.order?.coins).toBe(999);
    expect(sesudah.order?.amountIdr).toBe(12_345);
  });
});
