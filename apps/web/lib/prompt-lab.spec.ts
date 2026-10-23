import { describe, expect, it } from 'vitest';

import type { PromptLabHistoryItem } from '@strive/contracts';

import {
  KUNCI_BAGIAN,
  LABEL_BAGIAN,
  TEMPLATE_CONTOH,
  bukaRiwayat,
  isiBagian,
  jalanGagal,
  jalanTiba,
  labSiap,
  mulaiJalan,
  mulaiLab,
  muatDariRiwayat,
  pakaiTemplate,
  pesanGalat,
} from './prompt-lab';

/** Mesin Prompt Lab PL-01 — perilaku tampilan tanpa browser (pola C-03). */

const RUN: PromptLabHistoryItem = {
  id: '00000000-0000-4000-8000-00000000ab01',
  structure: {
    role: 'Editor',
    context: 'Skripsi UMKM',
    task: 'Ringkas abstrak',
    format: 'Prosa',
    constraints: '80 kata',
  },
  output: 'Ringkasan bagus.',
  self_rating: null,
  created_at: '2026-10-19T02:00:00.000Z',
};

const RUN2: PromptLabHistoryItem = {
  id: '00000000-0000-4000-8000-00000000ab02',
  structure: {
    role: 'Mentor',
    context: 'UTS minggu depan',
    task: 'Buat rencana belajar',
    format: 'Tabel harian',
    constraints: '7 hari',
  },
  output: 'Rencana 7 hari siap.',
  self_rating: null,
  created_at: '2026-10-20T02:00:00.000Z',
};

describe('formulir', () => {
  it('lima bagian lengkap dengan label + bantuan', () => {
    expect(KUNCI_BAGIAN).toHaveLength(5);
    for (const k of KUNCI_BAGIAN) {
      expect(pesanGalatLabelAda(k)).toBe(true);
    }
  });

  it('isiBagian mengubah satu kotak tanpa menyentuh lainnya', () => {
    let s = mulaiLab();
    s = isiBagian(s, 'role', 'Editor');
    s = isiBagian(s, 'task', 'Ringkas');
    expect(s.form.role).toBe('Editor');
    expect(s.form.task).toBe('Ringkas');
    expect(s.form.context).toBe('');
  });
});

describe('jalankan', () => {
  it('mulaiJalan mengunci klik ganda di mesin', () => {
    let s = mulaiJalan(labSiap(mulaiLab(), 20, []));
    s = mulaiJalan(s); // kedua — ditahan
    expect(s.sedangJalan).toBe(true);
  });

  it('sukses: hasil + saldo kata server (bukan dihitung klien)', () => {
    const s = jalanTiba(mulaiLab(), { id: RUN.id, output: 'OK', balance: 980 });
    expect(s.hasil?.output).toBe('OK');
    expect(s.saldo).toBe(980);
    expect(s.sedangJalan).toBe(false);
  });

  it('gagal: formulir TIDAK dibersihkan — pekerjaan pengguna jangan ikut dibuang', () => {
    let s = isiBagian(mulaiLab(), 'role', 'Editor mahasiswa');
    s = jalanGagal(s, 'PROVIDER_UNAVAILABLE');
    expect(s.form.role).toBe('Editor mahasiswa');
    expect(s.galat?.code).toBe('PROVIDER_UNAVAILABLE');
  });
});

describe('riwayat (PL-6 + AC jalankan-ulang)', () => {
  it('muatDariRiwayat mengisi formulir dari run lampau', () => {
    const s = muatDariRiwayat(mulaiLab(), RUN);
    expect(s.form.task).toBe('Ringkas abstrak');
    expect(s.hasil).toBeNull();
  });

  it('bukaRiwayat membuka SATU pasangan prompt+hasil; klik lagi menutup', () => {
    let s = labSiap(mulaiLab(), 20, [RUN]);
    expect(s.riwayatTerbuka).toBeNull(); // awal: tertutup semua
    s = bukaRiwayat(s, RUN.id);
    expect(s.riwayatTerbuka).toBe(RUN.id);
    s = bukaRiwayat(s, RUN.id);
    expect(s.riwayatTerbuka).toBeNull(); // toggle, bukan menumpuk
  });

  it('bukaRiwayat memindah fokus kalau run lain diklik', () => {
    let s = labSiap(mulaiLab(), 20, [RUN, RUN2]);
    s = bukaRiwayat(s, RUN.id);
    s = bukaRiwayat(s, RUN2.id);
    expect(s.riwayatTerbuka).toBe(RUN2.id);
  });
});

describe('template contoh (PL-5)', () => {
  it('tepat 3 template, tiap template lengkap 5 bagian dan valid untuk langsung dijalankan', () => {
    expect(TEMPLATE_CONTOH).toHaveLength(3);
    for (const t of TEMPLATE_CONTOH) {
      expect(t.nama.length, `nama ${t.nama}`).toBeGreaterThan(0);
      for (const k of KUNCI_BAGIAN) {
        const v = t.form[k];
        // Batas validasi server: 1–2000 karakter (PL-01). Template yang
        // melanggar batas itu membuat tombol "salin lalu jalankan" mati.
        expect(typeof v).toBe('string');
        expect(v.trim().length, `${t.nama} · ${k}`).toBeGreaterThan(0);
        expect(v.length, `${t.nama} · ${k}`).toBeLessThanOrEqual(2000);
      }
    }
  });

  it('pakaiTemplate menyalin kelima bagian jadi milik pengguna lalu bisa diubah', () => {
    let s = jalanGagal(isiBagian(mulaiLab(), 'role', 'isiku sendiri'), 'PROVIDER_UNAVAILABLE');
    const t = TEMPLATE_CONTOH[0]!;
    s = pakaiTemplate(s, t);
    for (const k of KUNCI_BAGIAN) {
      expect(s.form[k]).toBe(t.form[k]);
    }
    // Salinan = pekerjaan baru: hasil/galat lama tidak boleh nyangkut.
    expect(s.galat).toBeNull();
    expect(s.hasil).toBeNull();
    // ...lalu diubah — bagian lain tetap (sudah diuji isiBagian).
    s = isiBagian(s, 'constraints', 'versi ku sendiri');
    expect(s.form.constraints).toBe('versi ku sendiri');
    expect(s.form.role).toBe(t.form.role);
  });
});

describe('pesanGalat — cabang pada code (§10.1)', () => {
  it('kode dikenal punya pesan yang bisa dipahami; kode asing tetap informatif', () => {
    expect(pesanGalat('INSUFFICIENT_COINS', 20)).toContain('20');
    expect(pesanGalat('DAILY_AI_QUOTA_EXCEEDED', null)).toContain('10 run');
    expect(pesanGalat('PROVIDER_UNAVAILABLE', null)).toContain('tidak terpotong');
    expect(pesanGalat('KODE_ASING', null)).toContain('KODE_ASING');
  });
});

function pesanGalatLabelAda(k: string): boolean {
  // Pembantu kecil: label bagian tidak boleh kosong.
  const label = (LABEL_BAGIAN as Record<string, { label: string }>)[k];
  return Boolean(label?.label);
}
