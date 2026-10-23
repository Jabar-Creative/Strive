/**
 * Mesin layar Prompt Lab — PL-01 (Dev B), PRD §7 E13.
 *
 * Aturan tampilan yang bukan render (pola C-03): saldo & biaya KATA SERVER
 * (respons `balance`), idempotensi MILIK PERCOBAAN (retry sama = kunci sama,
 * edit lalu jalankan = kunci baru), riwayat berpasangan prompt+hasil (PL-6)
 * dan menampilkan biaya per run dari pricing.
 */

import type { PromptLabHistoryItem } from '@strive/contracts';

export type LabFase = 'memuat' | 'siap' | 'gagal';

export interface LabState {
  fase: LabFase;
  /** Nilai lima kotak; kunci tetap supaya bisa dijalankan-ulang dari riwayat. */
  form: Record<KunciBagian, string>;
  sedangJalan: boolean;
  hasil: { id: string; output: string } | null;
  riwayat: PromptLabHistoryItem[];
  saldo: number | null;
  biaya: number | null;
  galat: { code: string } | null;
}

export type KunciBagian = 'role' | 'context' | 'task' | 'format' | 'constraints';

export const KUNCI_BAGIAN: readonly KunciBagian[] = [
  'role',
  'context',
  'task',
  'format',
  'constraints',
] as const;

/** Label + bantuan singkat tiap bagian (PL-1). */
export const LABEL_BAGIAN: Record<KunciBagian, { label: string; bantu: string }> = {
  role: { label: 'Peran', bantu: 'AI bertindak sebagai siapa' },
  context: { label: 'Konteks', bantu: 'Latar belakang yang perlu diketahui' },
  task: { label: 'Tugas', bantu: 'Apa yang harus dikerjakan' },
  format: { label: 'Format', bantu: 'Bentuk keluaran yang diinginkan' },
  constraints: { label: 'Batasan', bantu: 'Yang boleh dan tidak boleh' },
};

export function mulaiLab(): LabState {
  return {
    fase: 'memuat',
    form: { role: '', context: '', task: '', format: '', constraints: '' },
    sedangJalan: false,
    hasil: null,
    riwayat: [],
    saldo: null,
    biaya: null,
    galat: null,
  };
}

export function labSiap(
  state: LabState,
  biaya: number | null,
  riwayat: PromptLabHistoryItem[],
): LabState {
  return { ...state, fase: 'siap', biaya, riwayat };
}

export function labGagal(code: string): LabState {
  return { ...mulaiLab(), fase: 'gagal', galat: { code } };
}

/** Menulis satu kotak formulir. */
export function isiBagian(state: LabState, kunci: KunciBagian, nilai: string): LabState {
  return { ...state, form: { ...state.form, [kunci]: nilai } };
}

/** Mulai menjalankan — tombol dikunci di MESIN (klik ganda = satu run). */
export function mulaiJalan(state: LabState): LabState {
  if (state.sedangJalan) return state;
  return { ...state, sedangJalan: true, galat: null };
}

/** Run sukses: hasil tampil, saldo kata server, riwayat bertambah di depan. */
export function jalanTiba(
  state: LabState,
  res: { id: string; output: string; balance: number },
): LabState {
  return {
    ...state,
    sedangJalan: false,
    hasil: { id: res.id, output: res.output },
    saldo: res.balance,
  };
}

/**
 * Run gagal. Galat tetap terlihat ber-kode; kotak formulir TIDAK dibersihkan
 * — pekerjaan pengguna jangan dibuang bersama galatnya.
 */
export function jalanGagal(state: LabState, code: string): LabState {
  return { ...state, sedangJalan: false, galat: { code } };
}

/** Jalankan-ulang dari riwayat (AC backlog): isi formulir dari run lampau. */
export function muatDariRiwayat(state: LabState, item: PromptLabHistoryItem): LabState {
  return { ...state, form: { ...state.form, ...item.structure }, hasil: null };
}

/** Pesan galat yang bisa dipahami (AC-PL-2) — cabang pada code, bukan message. */
export function pesanGalat(code: string, biaya: number | null): string {
  switch (code) {
    case 'INSUFFICIENT_COINS':
      return `Koin belum cukup (butuh ${biaya ?? 20}). Selesaikan lesson atau isi lewat Dompet.`;
    case 'DAILY_AI_QUOTA_EXCEEDED':
      return 'Kuota 10 run AI harian sudah habis — kembali besok.';
    case 'PROVIDER_UNAVAILABLE':
      return 'Layanan AI tidak menjawab — koin tidak terpotong, silakan coba lagi.';
    case 'LLM_OUTPUT_INVALID':
      return 'Layanan AI menghasilkan jawaban rusak — koin tidak terpotong.';
    case 'PRICING_NOT_CONFIGURED':
      return 'Harga run belum diterbitkan — coba lagi nanti.';
    case 'UNAUTHENTICATED':
      return 'Masuk dulu untuk memakai Prompt Lab.';
    default:
      return `Run gagal (${code}). Coba lagi sebentar.`;
  }
}
