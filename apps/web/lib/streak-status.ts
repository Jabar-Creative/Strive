/**
 * Turunan presentasi streak untuk layar Hub — S-03 (Dev B), PRD §7 E3 SK-9/SK-10.
 *
 * PEMBAGIAN TUGAS dengan server (S-02) sengaja tegas:
 * - Server menentukan STATUS (at_risk_today dihitung Postgres di zona waktu
 *   baris streaks — aturan keras 5). Client tidak pernah menentukan status
 *   dari jam prosesnya sendiri.
 * - Client hanya menghitung SISA JAM sampai tengah malam LOKAL untuk
 *   ditampilkan ("sisa N jam") — dari zona waktu pengguna yang dikirim
 *   GET /me (A-05), dengan Intl, bukan Date polos yang melihat TZ proses.
 */

export type StatusStreak = 'active' | 'at_risk' | 'frozen' | 'broken';

export interface StatusStreakInput {
  currentStreak: number;
  /** Dari GET /hub — sudah dihitung server di zona waktu pengguna. */
  atRiskToday: boolean;
}

export interface StatusStreakHasil {
  status: StatusStreak;
  /** Kalimat pembuka di kartu streak. */
  kop: string;
}

/**
 * SK-9: active (sudah aktif hari ini), at_risk (belum), broken (streak = 0).
 * SK-10: broken TIDAK pernah merah — "streak putus itu kekecewaan, bukan
 * kesalahan" — kalimatnya pun memilih "mulai lagi", bukan kata yang menyalahkan.
 *
 * `frozen` tidak bisa diturunkan dari /hub hari ini: butuh tahu apakah freeze
 * DIPAKAI hari ini (freeze_used_date), dan respons S-02 tidak membawanya —
 * dicatat sebagai isu untuk Dev A. Sampai field itu ada, hari yang
 * diselamatkan freeze tampil sebagai active/at_risk sesuai data server.
 */
export function statusStreak(input: StatusStreakInput): StatusStreakHasil {
  if (input.currentStreak === 0) {
    return { status: 'broken', kop: 'Mulai lagi hari ini' };
  }
  if (input.atRiskToday) {
    return {
      status: 'at_risk',
      kop:
        input.currentStreak === 1
          ? 'Streak 1 hari menunggu'
          : `Streak ${input.currentStreak} hari menunggu`,
    };
  }
  return { status: 'active', kop: `Streak ${input.currentStreak} hari menyala` };
}

/**
 * Jam (pecahan) sampai tengah malam zona waktu PENGGUNA.
 *
 * Menghitung "kapan tanggal lokal berganti" lewat Intl dua kali (tanggal
 * sekarang vs tanggal 24 jam kemudian, keduanya diformat di zona waktu
 * pengguna) — bukan `new Date().getHours()`, yang membaca zona waktu
 * PROSES. Rumus ini hanya presentasi; kebenaran status tetap di server.
 */
export function jamSisaHariLokal(kiniEpochMs: number, zonaWaktu: string): number {
  const bagian = new Intl.DateTimeFormat('en-GB', {
    timeZone: zonaWaktu,
    hourCycle: 'h23',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(new Date(kiniEpochMs));

  const ambil = (t: string): number => Number(bagian.find((p) => p.type === t)?.value ?? '0');

  const detikLewat = ambil('hour') * 3600 + ambil('minute') * 60 + ambil('second');
  // Sisa dalam JAM DINDING zona pengguna — pada hari pergeseran DST itu
  // memang yang dimaksud pengguna ("sisa 3 jam" sebelum tanggal berganti),
  // bukan durasi fisik yang bisa 23/25 jam.
  return Math.max(0, 24 * 3600 - detikLewat) / 3600;
}
