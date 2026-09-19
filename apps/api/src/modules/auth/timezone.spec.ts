import { describe, expect, it } from 'vitest';

import { ZONA_DEFAULT, skemaZonaWaktu, zonaWaktuKanonik, zonaWaktuSah } from './timezone';

/**
 * AU-7 — validasi zona waktu (isu #65 poin 2).
 *
 * Yang diuji di sini bukan "apakah string ini kelihatan seperti zona waktu",
 * tapi **apakah nilai ini aman dipakai `AT TIME ZONE` di PostgreSQL** (aturan
 * keras 5). Kegagalan di sana muncul sebagai error runtime di kode streak yang
 * tidak menyentuh auth sama sekali, berhari-hari setelah registrasinya.
 */

const jalankan = (nilai: unknown) => skemaZonaWaktu['~standard'].validate(nilai);

describe('validasi zona waktu IANA', () => {
  it('menerima zona Indonesia — ketiga zonanya, bukan cuma Jakarta', () => {
    // WIB, WITA, WIT. Repo ini untuk mahasiswa Indonesia; kalau salah satunya
    // ditolak, seluruh pengguna di zona itu mendapat jam yang salah.
    for (const z of ['Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura', 'Asia/Pontianak']) {
      expect(zonaWaktuSah(z), `${z} ditolak`).toBe(true);
      expect(zonaWaktuKanonik(z)).toBe(z);
    }
  });

  it('menerima `UTC` — yang justru TIDAK ada di Intl.supportedValuesOf', () => {
    // Ini bukan test defensif teoretis. `Intl.supportedValuesOf('timeZone')`
    // benar-benar TIDAK memuat 'UTC' di Node 22/24, jadi daftar izin yang
    // memakainya apa adanya akan menolak zona waktu paling umum di dunia.
    expect(Intl.supportedValuesOf('timeZone')).not.toContain('UTC');
    expect(zonaWaktuSah('UTC'), 'UTC ditolak — lihat catatan di timezone.ts').toBe(true);
  });

  it('longgar pada huruf besar-kecil, ketat pada yang disimpan', () => {
    for (const v of ['asia/jakarta', 'ASIA/JAKARTA', 'aSiA/jAkArTa']) {
      expect(zonaWaktuKanonik(v)).toBe('Asia/Jakarta');
    }
  });

  it('menerima alias lawas, dan mengembalikan bentuk kanonik Node', () => {
    // Node mengkanonikalkan Asia/Kolkata -> Asia/Calcutta (nama MODERN jadi
    // nama LAWAS, bukan sebaliknya — mengejutkan tapi konsisten). Keduanya
    // diterima PostgreSQL, jadi yang penting hasilnya stabil, bukan indah.
    const a = zonaWaktuKanonik('Asia/Kolkata');
    const b = zonaWaktuKanonik('Asia/Calcutta');
    expect(a).toBe(b);
    expect(a).not.toBeNull();
  });

  it('menolak zona offset tetap seperti Etc/GMT+7', () => {
    // Lolos `Intl.DateTimeFormat`, tapi bukan zona waktu manusia: tidak punya
    // aturan DST dan tidak pernah berubah. Mahasiswa tinggal di Asia/Jakarta,
    // bukan di Etc/GMT+7.
    expect(zonaWaktuSah('Etc/GMT+7')).toBe(false);
  });

  it('menolak sampah, tanpa melempar', () => {
    for (const v of [
      'Mars/Olympus',
      '',
      ' ',
      'Asia/Jakarta ', // spasi di ujung — sering datang dari form
      'Asia',
      '../../etc/passwd',
      "Asia/Jakarta'; DROP TABLE users;--",
      null,
      undefined,
      42,
      {},
      [],
    ]) {
      expect(zonaWaktuSah(v), `${JSON.stringify(v)} LOLOS validasi`).toBe(false);
    }
  });

  it('skema mengembalikan bentuk kanonik, bukan nilai aslinya', () => {
    const r = jalankan('asia/makassar');
    expect(r).toEqual({ value: 'Asia/Makassar' });
  });

  it('skema melaporkan issue yang bisa dibaca manusia saat gagal', () => {
    const r = jalankan('Mars/Olympus');
    // `'issues' in r` TIDAK menyempitkan union ini: cabang suksesnya punya
    // `issues?: undefined`, jadi propertinya "ada" di kedua cabang. Dicek
    // lewat nilainya, bukan keberadaannya.
    const issues = r.issues;
    expect(issues, 'nilai tidak sah malah diterima').toBeTruthy();
    // Pesannya menyebut contoh konkret. Pesan validasi yang cuma bilang
    // "tidak valid" memaksa orang menebak formatnya.
    expect(issues![0]!.message).toContain('Asia/Jakarta');
  });

  it('default AU-7 sama dengan default kolomnya, dan ia sah', () => {
    expect(ZONA_DEFAULT).toBe('Asia/Jakarta');
    expect(zonaWaktuSah(ZONA_DEFAULT)).toBe(true);
  });

  it('SELURUH daftar izin lolos validatornya sendiri', () => {
    // Menangkap ketidakcocokan antara daftar izin dan kanonikalisasi: kalau
    // ada nama di daftar yang tidak mengkanonikalkan ke dirinya sendiri, ia
    // akan diterima di satu tempat dan ditolak di tempat lain.
    const semua = [...Intl.supportedValuesOf('timeZone'), 'UTC'];
    const gagal = semua.filter((z) => !zonaWaktuSah(z));
    expect(gagal, `${gagal.length} zona di daftar izin ditolak validatornya sendiri`).toEqual([]);
  });
});
