import { describe, expect, it } from 'vitest';

import type { ListNotificationsResponse, Notification } from '@strive/contracts';

import {
  bellGagal,
  bellTiba,
  dibacaBerhasil,
  dibacaGagal,
  labelJenis,
  mulaiBell,
  peringatanStreakTerbaru,
  tandaiDibaca,
  waktuRelatif,
} from './notification-bell';

/**
 * Mesin lonceng + banner N-02 — AC yang diuji di sini adalah perilaku UI yang
 * tidak butuh browser:
 *   1. "Jumlah belum dibaca akurat" → angka datang dari server
 *      (`unread_count`), TIDAK PERNAH dihitung dari panjang daftar.
 *   2. NO-7 "Menandai dibaca optimistik dan pulih kalau request gagal"
 *      → dibacaGagal mengembalikan persis keadaan sebelum optimistik.
 */

const ISO = (menit: number) => new Date(Date.UTC(2026, 9, 18, 10, menit)).toISOString();

function notif(n: Partial<Notification> & { id: string }): Notification {
  return {
    kind: 'streak_warning',
    title: 'T',
    body: 'B',
    data: null,
    read_at: null,
    sent_at: null,
    created_at: ISO(0),
    ...n,
  };
}

const HALAMAN = (data: Notification[], unread_count: number): ListNotificationsResponse => ({
  data,
  next_cursor: null,
  unread_count,
});

describe('bellTiba — kebenaran belum dibaca dari server', () => {
  it('belumDibaca = unread_count respons, BUKAN dihitung dari isi halaman', () => {
    // 5 belum dibaca di server, halaman hanya memuat 2 — pengguna yang lama
    // tidak membuka aplikasi punya lebih banyak belum dibaca daripada halaman.
    const s = bellTiba(
      HALAMAN(
        [
          notif({ id: 'a', kind: 'streak_warning', title: 'Streak akan putus' }),
          notif({ id: 'b', kind: 'job_done', title: 'CV selesai' }),
        ],
        5,
      ),
    );
    expect(s.fase).toBe('siap');
    expect(s.belumDibaca).toBe(5);
  });
});

describe('bellGagal — tamu vs galat', () => {
  it('UNAUTHENTICATED berarti tanpa sesi: lonceng sembunyi, bukan error', () => {
    expect(bellGagal('UNAUTHENTICATED').fase).toBe('tanpaSesi');
  });

  it('galat lain tetap terlihat dengan kodenya', () => {
    const s = bellGagal('NETWORK');
    expect(s.fase).toBe('gagal');
    expect(s.galat?.code).toBe('NETWORK');
  });
});

describe('tandaiDibaca — optimistik dengan penjaga', () => {
  const dasar = bellTiba(
    HALAMAN(
      [notif({ id: 'a', title: 'Belum' }), notif({ id: 'b', title: 'Sudah', read_at: ISO(1) })],
      1,
    ),
  );

  it('menandai item belum dibaca: read_at terisi kini, belumDibaca turun', () => {
    const s = tandaiDibaca(dasar, 'a', ISO(5));
    expect(s.notifikasi.find((n) => n.id === 'a')?.read_at).toBe(ISO(5));
    expect(s.belumDibaca).toBe(0);
  });

  it('item yang SUDAH dibaca tidak mengurangi lagi (idempoten di sisi UI)', () => {
    const s = tandaiDibaca(dasar, 'b', ISO(5));
    expect(s.belumDibaca).toBe(1);
    // read_at tidak ditimpa stempel baru — sudah dibaca tetap pakai yang lama.
    expect(s.notifikasi.find((n) => n.id === 'b')?.read_at).toBe(ISO(1));
  });

  it('klik ganda id yang sama saat permintaan berjalan: sekali saja', () => {
    const sekali = tandaiDibaca(dasar, 'a', ISO(5));
    const duaKali = tandaiDibaca(sekali, 'a', ISO(6));
    expect(duaKali.belumDibaca).toBe(0);
    expect(duaKali.notifikasi.find((n) => n.id === 'a')?.read_at).toBe(ISO(5));
  });
});

describe('dibacaBerhasil / dibacaGagal — konfirmasi dan pemulihan (NO-7)', () => {
  const dasar = bellTiba(HALAMAN([notif({ id: 'a' }), notif({ id: 'b', read_at: ISO(1) })], 1));

  it('berhasil: stempel server menggantikan stempel optimistik', () => {
    const optimistik = tandaiDibaca(dasar, 'a', ISO(5));
    const s = dibacaBerhasil(optimistik, 'a', ISO(7));
    expect(s.notifikasi.find((n) => n.id === 'a')?.read_at).toBe(ISO(7));
    expect(s.belumDibaca).toBe(0);
  });

  it('gagal: PULIH — read_at kembali null dan belumDibaca kembali naik', () => {
    const optimistik = tandaiDibaca(dasar, 'a', ISO(5));
    const pulih = dibacaGagal(optimistik, 'a');
    expect(pulih.notifikasi.find((n) => n.id === 'a')?.read_at).toBeNull();
    expect(pulih.belumDibaca).toBe(1);
  });

  it('gagal untuk item yang memang sudah dibaca sejak awal: tidak menaikkan hitungan', () => {
    // Pemulihan hanya membalik apa yang optimistik lakukan — bukan +1 buta.
    const pulih = dibacaGagal(dasar, 'b');
    expect(pulih.belumDibaca).toBe(1);
  });
});

describe('peringatanStreakTerbaru — sumber banner Hub', () => {
  it('streak_warning belum dibaca TERBARU yang tampil, bukan yang mana pun', () => {
    const s = bellTiba(
      HALAMAN(
        [
          notif({ id: 'baru', kind: 'streak_warning', created_at: ISO(9) }),
          notif({ id: 'lama', kind: 'streak_warning', created_at: ISO(2) }),
          notif({ id: 'lain', kind: 'league_change', created_at: ISO(8) }),
        ],
        2,
      ),
    );
    expect(peringatanStreakTerbaru(s)?.id).toBe('baru');
  });

  it('null saat semua sudah dibaca atau tidak ada streak_warning', () => {
    const s = bellTiba(HALAMAN([notif({ id: 'x', kind: 'streak_warning', read_at: ISO(1) })], 0));
    expect(peringatanStreakTerbaru(s)).toBeNull();
    expect(peringatanStreakTerbaru(mulaiBell())).toBeNull();
  });
});

describe('waktuRelatif — deterministik dari kini eksplisit', () => {
  const kini = ISO(60); // 10:60 → relatif terhadap ini
  it('menit, jam, dan hari', () => {
    expect(waktuRelatif(ISO(60), kini)).toBe('baru saja');
    expect(waktuRelatif(ISO(55), kini)).toBe('5 mnt lalu');
    expect(waktuRelatif(ISO(30), kini)).toBe('30 mnt lalu');
    expect(waktuRelatif(ISO(0), kini)).toBe('1 jam lalu');
    expect(waktuRelatif(new Date(Date.UTC(2026, 9, 17, 10, 0)).toISOString(), kini)).toBe(
      '1 hari lalu',
    );
  });
});

describe('labelJenis — kamus lengkap, Record memaksa tiap jenis ada', () => {
  it('empat jenis NO-1 punya label Bahasa Indonesia', () => {
    expect(labelJenis.streak_warning).toBeTruthy();
    expect(labelJenis.league_change).toBeTruthy();
    expect(labelJenis.job_done).toBeTruthy();
    expect(labelJenis.review_validated).toBeTruthy();
  });
});
