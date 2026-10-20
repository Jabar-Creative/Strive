/**
 * Penjaga refetch in-flight + satu trailing run — RT-02, diangkat dari
 * squad-screen Q-05 (di sana ia hidup sebagai closure tak teruji).
 *
 * Kenapa perlu: burst event realtime memancar ke seluruh anggota squad.
 * Tanpa penjaga, tiap event menembak satu GET — memakai jatah rate limit
 * 120/menit per pengguna LINTAS RUTE (POST /attempts pengguna yang sama
 * bisa kena 429 karena papan rebut jatahnya), dan respons paralel bisa
 * selesai tak berurutan sehingga papan mundur sesaat. Event yang tiba saat
 * fetch berjalan cukup DICATAT; satu pengambilan ulang setelah selesai.
 */

export interface PenjagaRefetch {
  /** Jalankan (atau catat) satu pengambilan. Selalu sinkron kembali. */
  ambil(): void;
}

export function buatPenjagaRefetch(eksekusi: () => Promise<unknown>): PenjagaRefetch {
  let sedang = false;
  let muncrat = false;

  const penghalang: PenjagaRefetch = {
    ambil() {
      if (sedang) {
        muncrat = true;
        return;
      }
      sedang = true;
      // Eksekusi ditunda SATU microtask sebelum dipanggil: lemparan SINKRON
      // dari fungsi non-async pun menjadi penolakan promise, bukan lolos
      // sebelum .finally terpasang — tanpa ini penjaga mencatat "sedang"
      // lalu membeku selamanya (temuan audit RT-02, diuji spec).
      // Kegagalan eksekusi DITELAN di sini: penjaga menjaga IRAMA, bukan
      // pelaporan galat — layar yang menanganinya (papan lama tetap tampil,
      // poll/WS berikutnya mencoba lagi).
      void Promise.resolve()
        .then(eksekusi)
        .catch(() => undefined)
        .finally(() => {
          sedang = false;
          if (muncrat) {
            muncrat = false;
            penghalang.ambil();
          }
        });
    },
  };
  return penghalang;
}
