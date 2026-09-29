import { coinEntryTypeSchema, type CoinLedgerEntry } from '@strive/contracts';
import { describe, expect, it } from 'vitest';

import {
  arahTampil,
  cobaLagi,
  deskripsiBaris,
  formatWaktu,
  ledgerTiba,
  metaEntri,
  mulaiMuatLagi,
  mulaiWallet,
  muatLagiGagal,
  tampilTombolLagi,
  tampilTombolLengkap,
  walletGagal,
  walletTiba,
} from './wallet-screen';

/**
 * Test unit untuk mesin layar dompet (C-03).
 *
 * Yang dijaga file ini: transisi fase recent → ledger (gabung + dedupe id),
 * aturan tombol muat, guard klik ganda, dan kamus penjelasan 11 jenis entri
 * — AC inti C-03 ("pengguna tahu kenapa saldonya berubah"). Dilarang di sini:
 * menjumlahkan saldo (kebenaran saldo ada di server, CLAUDE.md aturan 2).
 */

/** Satu entri ledger sah bentuk kontrak, field bisa ditimpa per test. */
function entri(id: string, overrides: Partial<CoinLedgerEntry> = {}): CoinLedgerEntry {
  return {
    id,
    entry_type: 'earn_lesson',
    amount: 14,
    balance_after: 8450,
    ref_type: null,
    ref_id: null,
    note: null,
    created_at: '2026-09-28T07:02:00Z',
    ...overrides,
  };
}

/** recent_entries sepanjang n, id "r1".."rn". */
function recent(n: number): CoinLedgerEntry[] {
  return Array.from({ length: n }, (_, i) => entri(`r${i + 1}`));
}

describe('kamus jenis entri (metaEntri)', () => {
  it('SEMUA jenis enum punya meta terdefinisi — tidak ada yang lolos diam-diam', () => {
    expect(coinEntryTypeSchema.options).toHaveLength(11);
    for (const jenis of coinEntryTypeSchema.options) {
      const meta = metaEntri(jenis);
      expect(meta, `meta ${jenis} terdefinisi`).toBeDefined();
      expect(meta.label, `label ${jenis} tidak kosong`).toBeTruthy();
      expect(meta.alasan, `alasan ${jenis} tidak kosong`).toBeTruthy();
      expect(['masuk', 'keluar', 'tahan'], `arah ${jenis} sah`).toContain(meta.arah);
    }
  });

  it('hold arah tahan, release arah masuk, adjust memakai kata koreksi', () => {
    expect(metaEntri('hold').arah).toBe('tahan');
    expect(metaEntri('release').arah).toBe('masuk');
    expect(metaEntri('adjust').label.toLowerCase()).toContain('koreksi');
  });

  it('arahTampil: adjust mengikuti tanda amount, jenis lain mengikuti kamus', () => {
    expect(arahTampil(entri('a1', { entry_type: 'adjust', amount: 50 }))).toBe('masuk');
    expect(arahTampil(entri('a2', { entry_type: 'adjust', amount: -50 }))).toBe('keluar');
    expect(arahTampil(entri('h1', { entry_type: 'hold', amount: -400 }))).toBe('tahan');
  });

  it('deskripsiBaris memakai note server bila ada, kalau tidak pakai alasan kamus', () => {
    expect(deskripsiBaris(entri('n1', { note: 'CV builder' }))).toBe('CV builder');
    expect(deskripsiBaris(entri('n2'))).toBe(metaEntri('earn_lesson').alasan);
  });
});

describe('walletTiba / walletGagal', () => {
  it('recent_entries di bawah 20: fase siap, tombol lengkap TIDAK muncul', () => {
    const state = walletTiba({ balance: 8450, recent_entries: recent(5) });
    expect(state.fase).toBe('siap');
    expect(state.saldo).toBe(8450);
    expect(tampilTombolLengkap(state)).toBe(false);
  });

  it('recent_entries kosong: fase kosong, bukan siap tanpa isi', () => {
    const state = walletTiba({ balance: 0, recent_entries: [] });
    expect(state.fase).toBe('kosong');
    expect(state.entri).toEqual([]);
    expect(tampilTombolLengkap(state)).toBe(false);
  });

  it('walletGagal menyimpan code untuk dicabang, bukan message', () => {
    const state = walletGagal('UNAUTHENTICATED');
    expect(state.fase).toBe('gagal');
    expect(state.galat).toEqual({ code: 'UNAUTHENTICATED' });
    expect(cobaLagi().fase).toBe('memuat');
  });
});

describe('transisi recent → ledger (ledgerTiba)', () => {
  it('tepat 20 entri: tombol lengkap muncul; dup 5 + baru 15 menjadi 35', () => {
    const awal = walletTiba({ balance: 8450, recent_entries: recent(20) });
    expect(tampilTombolLengkap(awal)).toBe(true);

    // Halaman pertama ledger tumpang tindih 5 terakhir milik recent_entries.
    const halaman = [
      ...recent(20).slice(15),
      ...Array.from({ length: 15 }, (_, i) => entri(`l${i + 1}`)),
    ];
    const state = ledgerTiba(awal, { data: halaman, next_cursor: 'cl:lanjut' });
    expect(state.entri).toHaveLength(35);
    expect(state.sudahMuatLedger).toBe(true);
    expect(state.cursorBerikutnya).toBe('cl:lanjut');
    expect(state.memuatLagi).toBe(false);
    // Tombol lengkap pergi, tombol lagi mengambil alih.
    expect(tampilTombolLengkap(state)).toBe(false);
    expect(tampilTombolLagi(state)).toBe(true);
    // Urutan: 20 recent diikuti 15 baru — duplikat tidak menempel dua kali.
    expect(state.entri[34]?.id).toBe('l15');
    expect(state.entri.filter((e) => e.id === 'r20')).toHaveLength(1);
  });

  it('dedupe nol + next_cursor null: ternyata itu memang semua, tombol hilang', () => {
    const awal = walletTiba({ balance: 8450, recent_entries: recent(20) });
    const state = ledgerTiba(awal, { data: recent(20), next_cursor: null });
    expect(state.entri).toHaveLength(20);
    expect(tampilTombolLengkap(state)).toBe(false);
    expect(tampilTombolLagi(state)).toBe(false);
  });

  it('respons ledger yang terlambat (layar sudah reset) ditolak diam-diam', () => {
    const awal = walletTiba({ balance: 8450, recent_entries: recent(20) });
    const reset = mulaiWallet(); // pengguna menekan "Coba lagi" di tengah jalan
    const state = ledgerTiba(reset, { data: recent(20), next_cursor: null });
    expect(state).toBe(reset);
    expect(state.entri).toHaveLength(0);
    expect(awal.entri).toHaveLength(20); // state asal tidak tersentuh
  });
});

describe('muat lagi: guard klik ganda dan galat', () => {
  it('mulaiMuatLagi saat sudah memuatLagi: state TIDAK berubah (guard klik ganda)', () => {
    const siap = walletTiba({ balance: 8450, recent_entries: recent(20) });
    const sedang = mulaiMuatLagi(siap);
    expect(sedang.memuatLagi).toBe(true);
    expect(sedang.galat).toBeNull();
    expect(mulaiMuatLagi(sedang)).toBe(sedang); // klik kedua: objek sama
  });

  it('muatLagiGagal INVALID_CURSOR: entri tetap, memuatLagi false, galat tercatat', () => {
    const awal = ledgerTiba(walletTiba({ balance: 8450, recent_entries: recent(20) }), {
      data: recent(20),
      next_cursor: 'cl:basah',
    });
    const state = muatLagiGagal(mulaiMuatLagi(awal), 'INVALID_CURSOR');
    expect(state.entri).toHaveLength(20);
    expect(state.fase).toBe('siap');
    expect(state.memuatLagi).toBe(false);
    expect(state.galat).toEqual({ code: 'INVALID_CURSOR' });
    // Percobaan berikutnya membersihkan galat.
    expect(mulaiMuatLagi(state).galat).toBeNull();
  });

  it('muatLagiGagal pada state yang sudah reset juga ditolak diam-diam', () => {
    const reset = mulaiWallet();
    expect(muatLagiGagal(reset, 'INVALID_CURSOR')).toBe(reset);
  });
});

describe('formatWaktu', () => {
  it('ISO tetap menghasilkan string deterministik zona Asia/Jakarta', () => {
    // Ekspektasi literal dari run pertama (28 Sep 2026 14.02 WIB) — bukan
    // dihitung ulang di test, supaya perubahan format Intl terdeteksi.
    expect(formatWaktu('2026-09-28T07:02:00Z')).toBe('28 Sep 2026, 14.02');
  });
});
