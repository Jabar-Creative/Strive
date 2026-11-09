import { describe, expect, it } from 'vitest';

import {
  bacaBerkas,
  cvSiap,
  generateGagal,
  isiTargetRole,
  jobDiterima,
  kunciPercobaanBaru,
  LABEL_SEVERITY,
  mulaiCv,
  mulaiGenerate,
  pesanGalatCv,
  pilihSumber,
  pollingBerhenti,
  statusTiba,
  temuanDari,
  ulangiPercobaan,
} from './cv-builder';
import type { CvJobResponse } from '@strive/contracts';

/**
 * Mesin layar ATS CV (AI-07) — aturan yang BUKAN render hidup di sini.
 * Pola sama dengan `prompt-lab.spec.ts`: transisi murni, tanpa DOM.
 */

function job(status: CvJobResponse['status'], ekstra?: Partial<CvJobResponse>): CvJobResponse {
  return {
    job_id: 'j-1',
    status,
    created_at: '2026-11-09T00:00:00Z',
    completed_at: null,
    cv: null,
    failure: null,
    ...ekstra,
  };
}

describe('mesin CV — fase layar', () => {
  it('mulaiCv: sumber bawaan upload, biaya belum diketahui', () => {
    const s = mulaiCv();
    expect(s.fase).toBe('memuat');
    expect(s.sumber).toBe('upload');
    expect(s.biaya).toBeNull();
    expect(stateBersih(s)).toBe(true);
  });

  it('cvSiap: nama profil hanya dipakai SEKALI untuk prefill', () => {
    const isi = cvSiap(mulaiCv(), 400, 'Rina');
    expect(isi.fase).toBe('siap');
    expect(isi.biaya).toBe(400);
    expect(isi.profil.nama).toBe('Rina');
    // Ketikan pengguna tidak pernah ditimpa ulang.
    const kutulis = { ...isi, profil: { ...isi.profil, nama: 'R. Melati' } };
    expect(cvSiap(kutulis, 400, 'Rina').profil.nama).toBe('R. Melati');
    // Percobaan kedua tanpa perubahan juga tidak menimpa.
    expect(cvSiap(cvSiap(mulaiCv(), 400, 'Rina'), 400, 'Rina').profil.nama).toBe('Rina');
  });

  it('isiTargetRole: terpotong di 120 karakter (batas kontrak)', () => {
    const s = isiTargetRole(mulaiCv(), 'x'.repeat(200));
    expect(s.targetRole).toHaveLength(120);
  });

  it('pilihSumber/bacaBerkas membersihkan galat lama', () => {
    let s = pilihSumber(mulaiCv(), 'profile');
    s = { ...s, galat: { code: 'NETWORK' } };
    expect(pilihSumber(s, 'upload').galat).toBeNull();
    expect(bacaBerkas(s, { nama: 'cv.pdf', base64: 'aGk=' }).galat).toBeNull();
  });
});

describe('mesin CV — fase percobaan', () => {
  it('mulaiGenerate: klik ganda saat menunggu = SATU percobaan', () => {
    const s = mulaiGenerate(mulaiCv());
    expect(s.faseJob).toBe('menunggu');
    expect(mulaiGenerate(s)).toBe(s); // objek sama, tanpa transisi baru
  });

  it('mulaiGenerate mengosongkan hasil dan galat percobaan sebelumnya', () => {
    let s = statusTiba(mulaiCv(), job('done'));
    s = { ...s, galat: { code: 'NETWORK' }, galatJob: { code: 'INTERNAL_ERROR' } };
    const baru = mulaiGenerate(s);
    expect(baru.faseJob).toBe('menunggu');
    expect(baru.hasil).toBeNull();
    expect(baru.galat).toBeNull();
    expect(baru.galatJob).toBeNull();
  });

  it('statusTiba: done menyimpan dokumen, antara hanya memperbarui status', () => {
    const dok = {
      id: 'd-1',
      job_id: 'j-1',
      created_at: '2026-11-09T00:00:00Z',
      ats_score: 80,
      ats_findings: [],
      pdf_url: 'http://lokal/pdf',
    };
    let s = mulaiGenerate(mulaiCv());
    s = jobDiterima(s, 'j-1');
    s = statusTiba(s, job('queued'));
    expect(s.faseJob).toBe('menunggu');
    expect(s.statusServer).toBe('queued');
    s = statusTiba(s, job('running'));
    expect(s.statusServer).toBe('running');
    s = statusTiba(s, job('done', { cv: dok as CvJobResponse['cv'] }));
    expect(s.faseJob).toBe('selesai');
    expect(s.hasil).toBe(dok);
    expect(s.statusServer).toBeNull();
  });

  it('statusTiba: failed membawa kode §10.2; tanpa failure = INTERNAL_ERROR', () => {
    const a = statusTiba(mulaiCv(), job('failed', { failure: { code: 'SOURCE_TOO_SHORT' } }));
    expect(a.faseJob).toBe('gagalJob');
    expect(a.galatJob).toEqual({ code: 'SOURCE_TOO_SHORT' });
    const b = statusTiba(mulaiCv(), job('failed'));
    expect(b.galatJob).toEqual({ code: 'INTERNAL_ERROR' });
  });

  it('pollingBerhenti hanya berlaku saat menunggu (bukan galat server)', () => {
    const s = pollingBerhenti(mulaiGenerate(mulaiCv()));
    expect(s.galat).toEqual({ code: 'POLLING_TIMEOUT' });
    expect(s.faseJob).toBe('menunggu'); // job tetap berjalan di server
    expect(pollingBerhenti(mulaiCv()).galat).toBeNull();
  });

  it('ulangiPercobaan mereset jobId dan seluruh keadaan percobaan', () => {
    let s = jobDiterima(mulaiGenerate(mulaiCv()), 'j-lama');
    s = statusTiba(s, job('failed', { failure: { code: 'PROVIDER_UNAVAILABLE' } }));
    s = ulangiPercobaan(s);
    expect(s.jobId).toBeNull();
    expect(s.faseJob).toBe('idle');
    expect(s.hasil).toBeNull();
    expect(s.galatJob).toBeNull();
  });

  it('generateGagal mempertahankan isian form (gagal MULAI, bukan job gagal)', () => {
    const s = isiTargetRole(mulaiGenerate(mulaiCv()), 'Data Analyst');
    const g = generateGagal(s, 'INSUFFICIENT_COINS');
    expect(g.faseJob).toBe('idle');
    expect(g.galat).toEqual({ code: 'INSUFFICIENT_COINS' });
    expect(g.targetRole).toBe('Data Analyst');
  });
});

describe('kunciPercobaanBaru — kunci idempotensi milik PERCOBAAN (#245)', () => {
  it('dari idle dengan kunci lama: kunci DIPERTAHANKAN (percobaan yang sama)', () => {
    expect(kunciPercobaanBaru('idle', 'kunci-lama')).toBe('kunci-lama');
  });

  it('dari idle tanpa kunci: kunci BARU dibangkitkan', () => {
    const k = kunciPercobaanBaru('idle', null);
    expect(typeof k).toBe('string');
    expect(k).not.toBe('');
  });

  it('dari menunggu: kunci dipertahankan (mulaiGenerate menahan klik ganda)', () => {
    expect(kunciPercobaanBaru('menunggu', 'kunci-lama')).toBe('kunci-lama');
  });

  it('dari selesai: kunci BARU — server mereplay job lama untuk kunci lama', () => {
    expect(kunciPercobaanBaru('selesai', 'kunci-lama')).not.toBe('kunci-lama');
  });

  it('dari gagalJob: kunci BARU', () => {
    expect(kunciPercobaanBaru('gagalJob', 'kunci-lama')).not.toBe('kunci-lama');
  });
});

describe('pesanGalatCv — bercabang pada code, bukan message (AC-CV-3)', () => {
  it('koin kurang menyebut biaya dan Dompet', () => {
    expect(pesanGalatCv('INSUFFICIENT_COINS', 400)).toContain('400');
    expect(pesanGalatCv('INSUFFICIENT_COINS', 400)).toContain('Dompet');
  });

  it('kegagalan layanan AI menyebut koin dikembalikan penuh', () => {
    for (const kode of ['PROVIDER_UNAVAILABLE', 'LLM_OUTPUT_INVALID', 'INTERNAL_ERROR']) {
      expect(pesanGalatCv(kode, 400)).toContain('dikembalikan penuh');
    }
  });

  it('POLLING_TIMEOUT menjelaskan bahwa job tetap berjalan tanpa biaya baru', () => {
    const m = pesanGalatCv('POLLING_TIMEOUT', null);
    expect(m).toContain('diproses');
    expect(m).toContain('biaya tambahan');
  });

  it('kode asing tetap dapat pesan yang bisa dipahami', () => {
    expect(pesanGalatCv('KODE_ASLING', 400)).toContain('KODE_ASLING');
  });

  it('SOURCE_TOO_SHORT memberi tahu apa yang harus dilengkapi', () => {
    expect(pesanGalatCv('SOURCE_TOO_SHORT', 400)).toContain('lengkapi');
  });
});

describe('temuanDari + LABEL_SEVERITY', () => {
  it('temuan salah bentuk dibuang, severity divalidasi', () => {
    const hasil = temuanDari([
      { severity: 'error', pesan: 'Email tidak ada', aturan: 'kontak', penalti: -20 },
      { severity: 'fatal', pesan: 'severity asing' },
      { pesan: 'tanpa severity' },
      'bukan objek',
      null,
    ]);
    expect(hasil).toHaveLength(1);
    expect(hasil[0]?.pesan).toBe('Email tidak ada');
  });

  it('input bukan array menghasilkan daftar kosong', () => {
    expect(temuanDari(undefined)).toEqual([]);
    expect(temuanDari('x')).toEqual([]);
  });

  it('label severity tersedia untuk ketiganya', () => {
    expect(LABEL_SEVERITY.error).toBe('error');
    expect(LABEL_SEVERITY.warning).toBe('peringatan');
    expect(LABEL_SEVERITY.info).toBe('info');
  });
});

/** Semua kolom keadaan percobaan kosong — dipakai assert awal mesin. */
function stateBersih(s: ReturnType<typeof mulaiCv>): boolean {
  return (
    s.jobId === null &&
    s.faseJob === 'idle' &&
    s.statusServer === null &&
    s.hasil === null &&
    s.galat === null &&
    s.galatJob === null
  );
}
