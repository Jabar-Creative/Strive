import { describe, expect, it, vi } from 'vitest';

import { buatPenjagaRefetch } from './refetch-guard';

/**
 * Penjaga refetch RT-02 — perilaku yang diambil dari squad-screen Q-05
 * (temuan audit-nya) dan dibuat fungsi murni supaya teruji:
 *
 *   burst `score.updated` memancar ke seluruh anggota squad; tanpa penjaga,
 *   tiap event menembak satu GET (jatah rate limit 120/menit LINTAS RUTE),
 *   dan respons paralel bisa selesai tak berurutan (papan mundur sesaat).
 *   Event yang datang saat fetch berjalan cukup DICATAT; satu pengambilan
 *   ulang setelah selesai.
 */

function tundaTerkendali() {
  let selesaikan!: () => void;
  const janji = new Promise<void>((r) => {
    selesaikan = r;
  });
  return { janji, selesaikan };
}

/** Buang antrean mikro beberapa putaran supaya .finally trailing sempat jalan. */
async function tiriskan() {
  const mikro = () => new Promise<void>((r) => setTimeout(r, 0));
  for (let i = 0; i < 5; i++) await mikro();
}

describe('buatPenjagaRefetch', () => {
  it('idle: satu panggilan = satu eksekusi', async () => {
    const eksekusi = vi.fn().mockResolvedValue(undefined);
    buatPenjagaRefetch(eksekusi).ambil();
    // Eksekusi ditunda satu microtask oleh penjaga (lihat komentar impl),
    // jadi hitungannya diamati setelah antrean mikro tiriskan sekali.
    await Promise.resolve();
    expect(eksekusi).toHaveBeenCalledTimes(1);
  });

  it('saat berjalan: panggilan tambahan dicatat, bukan dieksekusi', async () => {
    const { janji, selesaikan } = tundaTerkendali();
    const eksekusi = vi.fn().mockReturnValueOnce(janji).mockResolvedValue(undefined);
    const penjaga = buatPenjagaRefetch(eksekusi);

    penjaga.ambil(); // mulai
    await Promise.resolve(); // eksekusi pertama benar-benar berjalan
    penjaga.ambil(); // saat berjalan — dicatat
    penjaga.ambil(); // saat berjalan — tetap satu catatan
    expect(eksekusi).toHaveBeenCalledTimes(1);

    selesaikan();
    await tiriskan();
    // TEPAT SATU trailing run — bukan dua (dua catatan bukan dua jalan).
    expect(eksekusi).toHaveBeenCalledTimes(2);
  });

  it('eksekusi melempar: penjaga pulih, panggilan berikut tetap jalan', async () => {
    const eksekusi = vi
      .fn()
      .mockRejectedValueOnce(new Error('jaringan'))
      .mockResolvedValue(undefined);
    const penjaga = buatPenjagaRefetch(eksekusi);

    penjaga.ambil(); // gagal
    await tiriskan();
    expect(eksekusi).toHaveBeenCalledTimes(1);

    penjaga.ambil(); // harus tetap bisa jalan, tidak macet "sedang"
    await tiriskan();
    expect(eksekusi).toHaveBeenCalledTimes(2);
  });

  it('eksekusi melempar SINKRON: penjaga tidak membeku selamanya', async () => {
    // Temuan audit RT-02: lib ini dipakai ulang tiap layar realtime, dan
    // pemakai berikutnya bisa memberi fungsi non-async yang melempar saat
    // dipanggil. Kalau penjaga mencatat "sedang" lalu lemparan sinkron
    // lolos sebelum .finally terpasang, semua ambil() berikutnya hanya
    // dicatat — layar beku diam-diam tanpa galat.
    const eksekusi = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('lemparan sinkron');
      })
      .mockResolvedValue(undefined);
    const penjaga = buatPenjagaRefetch(eksekusi);

    expect(() => penjaga.ambil()).not.toThrow();
    await tiriskan();
    expect(eksekusi).toHaveBeenCalledTimes(1);

    penjaga.ambil(); // TIDAK boleh macet "sedang"
    await tiriskan();
    expect(eksekusi).toHaveBeenCalledTimes(2);
  });

  it('trailing memicu trailing berikutnya hanya kalau ada panggilan baru', async () => {
    const { janji, selesaikan } = tundaTerkendali();
    const eksekusi = vi.fn().mockReturnValueOnce(janji).mockResolvedValue(undefined);
    const penjaga = buatPenjagaRefetch(eksekusi);

    penjaga.ambil();
    penjaga.ambil(); // dicatat
    selesaikan();
    await tiriskan(); // trailing run #2 selesai — tidak ada catatan baru
    expect(eksekusi).toHaveBeenCalledTimes(2);

    penjaga.ambil(); // idle lagi → jalan normal
    await tiriskan();
    expect(eksekusi).toHaveBeenCalledTimes(3);
  });
});
