/**
 * Mesin layar Prompt Lab — PL-01 + PL-02 (Dev B), PRD §7 E13.
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
  /** Id run yang pasangan prompt+hasilnya sedang dibuka (PL-6). */
  riwayatTerbuka: string | null;
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
    riwayatTerbuka: null,
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

/** Satu template contoh (PL-5): nama + kelima bagian siap jalankan. */
export interface TemplateContoh {
  nama: string;
  form: Record<KunciBagian, string>;
}

/**
 * Tiga template contoh (PL-5). Konstanta statis sisi web — PRD §10.3 tidak
 * punya rute template, "menjadi milik pengguna" berarti salinan masuk form,
 * lalu tersimpan sebagai run miliknya di `prompt_runs`. Tiap bagian wajib
 * lolos validasi server 1–2000 karakter supaya salinan bisa langsung dijalankan.
 */
export const TEMPLATE_CONTOH: readonly TemplateContoh[] = [
  {
    nama: 'Ringkas jurnal kuliah',
    form: {
      role: 'Asisten riset yang teliti dan terbiasa membaca jurnal ilmiah berbahasa Inggris.',
      context:
        'Saya mahasiswa semester akhir yang membaca jurnal untuk tugas kuliah. Jurnalnya berbahasa Inggris dan panjang, sementara saya butuh intisarinya dalam bahasa Indonesia. Saya akan menempelkan isi jurnalnya di sini.',
      task: 'Ringkas jurnal yang saya tempel: temukan pertanyaan penelitian, metode, temuan utama, dan keterbatasannya.',
      format:
        'Poin-poin dengan empat judul: Pertanyaan penelitian, Metode, Temuan utama, Keterbatasan. Maksimal satu kalimat per poin.',
      constraints:
        'Bahasa Indonesia. Tidak menambahkan interpretasi di luar isi jurnal. Maksimal 150 kata.',
    },
  },
  {
    nama: 'Rencana belajar UTS',
    form: {
      role: 'Mentor akademik yang menyiapkan mahasiswa menghadapi ujian tengah semester.',
      context:
        'Saya mahasiswa dengan tiga mata kuliah yang akan di-UTS minggu depan. Waktu belajar saya sekitar tiga jam per hari dan saya paling produktif di malam hari.',
      task: 'Susun rencana belajar tujuh hari menuju UTS yang membagi materi per hari dan menyisakan hari terakhir untuk latihan soal.',
      format: 'Tabel dengan kolom: Hari, Materi, Metode belajar, Target selesai.',
      constraints:
        'Total belajar maksimal tiga jam per hari. Sertakan satu jeda istirahat per sesi. Jangan menyarankan begadang.',
    },
  },
  {
    nama: 'Draf email lamaran magang',
    form: {
      role: 'Konsultan karir yang membantu mahasiswa menulis email lamaran magang pertamanya.',
      context:
        'Saya mahasiswa tingkat tiga, ingin melamar magang di perusahaan teknologi. Belum ada pengalaman kerja formal — yang saya punya proyek kuliah dan kegiatan organisasi.',
      task: 'Tulis draf email lamaran magang singkat yang menonjolkan proyek kuliah sebagai bukti kemampuan, lengkap dengan subjek email.',
      format:
        'Subjek email di baris pertama, lalu isi email maksimal tiga paragraf pendek, ditutup salam.',
      constraints:
        'Bahasa Indonesia formal tapi tidak kaku. Pakai penanda [nama perusahaan] dan [posisi] untuk bagian yang harus saya ganti sendiri. Maksimal 120 kata.',
    },
  },
];

/**
 * Menyalin template ke formulir (PL-5). Salinan adalah pekerjaan BARU milik
 * pengguna: hasil dan galat lama dibuang supaya tidak nyangkut di percobaan
 * berikutnya — yang dijalankan server tetap apa adanya isi formulir.
 */
export function pakaiTemplate(state: LabState, t: TemplateContoh): LabState {
  return { ...state, form: { ...t.form }, galat: null, hasil: null };
}

/**
 * Membuka/menutup pasangan prompt+hasil satu run (PL-6). Toggle untuk run
 * yang sama, pindah fokus untuk run lain — tidak pernah dua terbuka bersamaan.
 */
export function bukaRiwayat(state: LabState, id: string): LabState {
  return { ...state, riwayatTerbuka: state.riwayatTerbuka === id ? null : id };
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
