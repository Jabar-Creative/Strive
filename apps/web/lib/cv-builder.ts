/**
 * Mesin layar ATS CV — AI-07 (Dev B), PRD §7 E8, §13.2.
 *
 * Pola sama dengan `prompt-lab.ts`: aturan tampilan yang bukan render hidup
 * di sini supaya bisa diuji dan direview terpisah dari JSX. Yang khusus CV:
 * pekerjaannya ASINKRON (202 + polling `GET /career/cv/jobs/:id`), jadi
 * mesin ini punya fase job SENDIRI di luar fase layar.
 *
 * Aturan yang dijaga di sini (bukan di komponen):
 *   - Kunci idempotensi MILIK PERCOBAAN: percobaan ulang job yang gagal
 *     memakai kunci BARU (keputusan #245) — tombol "coba lagi" mereset
 *     jobId, bukan memakai ulang kunci lama.
 *   - `failure.code` dari server HANYA kode §10.2 (isu #197) — pesan yang
 *     ditampilkan bercabang pada code, tidak pernah pada message.
 *   - Guard ukuran berkas 8 MB dijalankan SEBELUM base64 dibangun, tapi itu
 *     kenyamanan, bukan keamanan: server memvalidasi ulang semuanya.
 */

import type { AtsFinding, CvJobResponse } from '@strive/contracts';

export type CvFase = 'memuat' | 'siap' | 'gagal';

export type SumberCv = 'upload' | 'profile';

/** Fase satu PERCOBAAN generate — terpisah dari fase layar. */
export type FaseJobCv = 'idle' | 'menunggu' | 'selesai' | 'gagalJob';

/** Batas ukuran berkas SEBELAH didekode — sama dengan `MAKS_DOKUMEN_BYTE` API. */
export const MAKS_BERKAS_BYTE = 8 * 1024 * 1024;

export interface BerkasCv {
  nama: string;
  /** Isi berkas base64 TANPA prefiks data-URL. */
  base64: string;
}

/** Form profil sumber `profile` — keterampilan mentah dipisah koma. */
export interface ProfilFormCv {
  nama: string;
  headline: string;
  ringkasan: string;
  keterampilan: string;
}

export interface CvState {
  fase: CvFase;
  sumber: SumberCv;
  targetRole: string;
  berkas: BerkasCv | null;
  profil: ProfilFormCv;
  biaya: number | null;
  jobId: string | null;
  faseJob: FaseJobCv;
  /** `status` terakhir yang diketahui server (untuk copy "antre/diproses"). */
  statusServer: 'queued' | 'running' | null;
  /** Dokumen CV saat `done` — bentuk `CvDocumentResponse`. */
  hasil: CvJobResponse['cv'];
  /** Galat MEMULAI percobaan (validasi, koin, kuota, jaringan). */
  galat: { code: string } | null;
  /** `failure.code` saat job berakhir gagal di sisi server. */
  galatJob: { code: string } | null;
}

export function mulaiCv(): CvState {
  return {
    fase: 'memuat',
    sumber: 'upload',
    targetRole: '',
    berkas: null,
    profil: { nama: '', headline: '', ringkasan: '', keterampilan: '' },
    biaya: null,
    jobId: null,
    faseJob: 'idle',
    statusServer: null,
    hasil: null,
    galat: null,
    galatJob: null,
  };
}

export function cvSiap(state: CvState, biaya: number | null, namaProfil?: string): CvState {
  // Nama profil hanya dipakai SEKALI saat pertama siap (prefill); pengguna
  // boleh menimpanya dan hasil ketiknya tidak pernah ditimpa ulang.
  return {
    ...state,
    fase: 'siap',
    biaya,
    profil:
      state.profil.nama === '' && namaProfil ? { ...state.profil, nama: namaProfil } : state.profil,
  };
}

export function cvGagal(code: string): CvState {
  return { ...mulaiCv(), fase: 'gagal', galat: { code } };
}

export function pilihSumber(state: CvState, sumber: SumberCv): CvState {
  return { ...state, sumber, galat: null };
}

export function isiTargetRole(state: CvState, nilai: string): CvState {
  return { ...state, targetRole: nilai.slice(0, 120) };
}

/** Berkas baru — dipilih lewat input file di komponen (ukuran sudah dicek). */
export function bacaBerkas(state: CvState, berkas: BerkasCv | null): CvState {
  return { ...state, berkas, galat: null };
}

export function isiProfil(state: CvState, kunci: keyof ProfilFormCv, nilai: string): CvState {
  return { ...state, profil: { ...state.profil, [kunci]: nilai } };
}

/** Mulai percobaan — tombol dikunci di mesin (klik ganda = satu percobaan). */
export function mulaiGenerate(state: CvState): CvState {
  if (state.faseJob === 'menunggu') return state;
  return {
    ...state,
    faseJob: 'menunggu',
    galat: null,
    galatJob: null,
    hasil: null,
    statusServer: null,
  };
}

/**
 * Kunci idempotensi untuk percobaan yang baru dimulai — keputusan #245:
 * kunci itu milik SATU PERCOBAAN.
 *
 * Percobaan lama yang sudah BERAKHIR di server (`done`/`failed`) wajib kunci
 * BARU: server memutar ulang (replay) job lama untuk kunci yang sama, dan
 * hasil percobaan "baru" diam-diam jadi hasil lama — form yang diedit
 * pengguna diabaikan tanpa biaya baru. Ditemukan saat verifikasi browser
 * AI-07 (9 Nov): generate kedua setelah hasil tiba menampilkan skor lama.
 *
 * Dari `idle` (belum pernah mulai, atau gagal MULAI karena jaringan/galat
 * awal) kunci LAMA dipertahankan: itu percobaan yang sama yang dikirim
 * ulang, dan kunci itulah yang membuat pengiriman ulang aman.
 */
export function kunciPercobaanBaru(faseJobLama: FaseJobCv, kunciLama: string | null): string {
  if (faseJobLama === 'selesai' || faseJobLama === 'gagalJob') return crypto.randomUUID();
  return kunciLama ?? crypto.randomUUID();
}

/** 202 {job_id} diterima — polling dimulai. */
export function jobDiterima(state: CvState, jobId: string): CvState {
  return { ...state, jobId };
}

/**
 * Satu hasil polling. `done` menyimpan dokumen; `failed` membawa kode §10.2.
 * Status antara (`queued`/`running`) hanya memperbarui copy, bukan fase.
 */
export function statusTiba(state: CvState, job: CvJobResponse): CvState {
  if (job.status === 'done') {
    return {
      ...state,
      faseJob: 'selesai',
      statusServer: null,
      hasil: job.cv,
      galatJob: null,
    };
  }
  if (job.status === 'failed') {
    return {
      ...state,
      faseJob: 'gagalJob',
      statusServer: null,
      hasil: null,
      galatJob: job.failure ? { code: job.failure.code } : { code: 'INTERNAL_ERROR' },
    };
  }
  return { ...state, statusServer: job.status };
}

/**
 * Selesai menunggu dari sisi klien (batas polling tercapai) — bukan galat
 * server: job tetap berjalan, pengguna bisa kembali ke halaman ini.
 */
export function pollingBerhenti(state: CvState): CvState {
  if (state.faseJob !== 'menunggu') return state;
  return { ...state, galat: { code: 'POLLING_TIMEOUT' } };
}

/** Percobaan BARU: job lama tidak dipakai ulang, kunci baru dibangkitkan. */
export function ulangiPercobaan(state: CvState): CvState {
  return {
    ...state,
    jobId: null,
    faseJob: 'idle',
    statusServer: null,
    hasil: null,
    galat: null,
    galatJob: null,
  };
}

/** Generate gagal DIMULAI (bukan job gagal): form TIDAK dibersihkan. */
export function generateGagal(state: CvState, code: string): CvState {
  return { ...state, faseJob: 'idle', galat: { code } };
}

/** Temuan ATS yang valid dari `ats_findings` (unknown di kontrak) — buang yang salah bentuk. */
export function temuanDari(daftar: unknown): AtsFinding[] {
  if (!Array.isArray(daftar)) return [];
  const SAH = ['error', 'warning', 'info'] as const;
  return daftar.filter(
    (t): t is AtsFinding =>
      typeof t === 'object' &&
      t !== null &&
      'severity' in t &&
      'pesan' in t &&
      typeof (t as AtsFinding).pesan === 'string' &&
      SAH.includes((t as AtsFinding).severity as (typeof SAH)[number]),
  );
}

/** Label severity bahasa Indonesia (wireframe p06: "error"/"peringatan"). */
export const LABEL_SEVERITY: Record<AtsFinding['severity'], string> = {
  error: 'error',
  warning: 'peringatan',
  info: 'info',
};

/** Pesan galat yang bisa dipahami — cabang pada code, bukan message (AC-CV-3). */
export function pesanGalatCv(code: string, biaya: number | null): string {
  switch (code) {
    case 'INSUFFICIENT_COINS':
      return `Koin belum cukup (butuh ${biaya ?? 400}). Selesaikan lesson atau isi lewat Dompet.`;
    case 'DAILY_AI_QUOTA_EXCEEDED':
      return 'Kuota 10 run AI (CV + Prompt Lab + Mastery) harian sudah habis — kembali besok.';
    case 'UNSUPPORTED_FILE_TYPE':
      return 'Hanya PDF dan DOCX yang diterima.';
    case 'FILE_TOO_LARGE':
      return `Dokumen melebihi batas 8 MB.`;
    case 'SOURCE_TOO_SHORT':
      return 'Isian terlalu sedikit untuk disusun jadi CV — lengkapi ringkasan dan pengalamanmu, atau unggah dokumen.';
    case 'DOCUMENT_TOO_LONG':
      return 'Dokumen terlalu panjang (di atas 15.000 kata) — ringkas dulu lalu unggah ulang.';
    case 'KEY_CONFLICT':
      return 'Percobaan yang sama masih berjalan — tunggu hasilnya, lalu mulai percobaan baru.';
    case 'VALIDATION_ERROR':
      return 'Periksa kembali isianmu: target role wajib, dan sumber harus berisi berkas atau profil.';
    case 'PRICING_NOT_CONFIGURED':
      return 'Harga generate CV belum diterbitkan — coba lagi nanti.';
    case 'PROVIDER_UNAVAILABLE':
    case 'LLM_OUTPUT_INVALID':
    case 'INTERNAL_ERROR':
      return 'Proses CV gagal di layanan AI — koin dikembalikan penuh, coba lagi tanpa biaya baru.';
    case 'POLLING_TIMEOUT':
      return 'Masih diproses di server. Biarkan halaman ini terbuka atau kembali lagi sebentar — kamu tidak akan dikenakan biaya tambahan.';
    case 'UNAUTHENTICATED':
      return 'Masuk dulu untuk memakai CV Builder.';
    case 'NETWORK':
      return 'Koneksi terputus. Coba lagi.';
    default:
      return `CV gagal diproses (${code}). Coba lagi sebentar.`;
  }
}
