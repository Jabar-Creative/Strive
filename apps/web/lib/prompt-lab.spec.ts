import { describe, expect, it } from 'vitest';

import type { PromptLabHistoryItem } from '@strive/contracts';

import {
  KUNCI_BAGIAN,
  LABEL_BAGIAN,
  isiBagian,
  jalanGagal,
  jalanTiba,
  labSiap,
  mulaiJalan,
  mulaiLab,
  muatDariRiwayat,
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
