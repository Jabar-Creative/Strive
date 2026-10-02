/**
 * Bentuk respons `GET /hub`.
 *
 * Skemanya SUDAH ada di `packages/contracts` sejak `S-03` (#191, isu #52) —
 * utang `F-08` yang dicatat di sini sebelumnya sudah ditutup Dev B.
 *
 * **Tipe ini tetap tinggal di sini, dan itu bukan duplikasi yang terlupakan.**
 * `packages/contracts` milik Dev B (CLAUDE.md §Kepemilikan file), jadi dua
 * field yang ditambahkan di bawah (`freeze_used_today`, `timezone`) belum ada
 * di skema zod-nya — dan tidak boleh kutambahkan sendiri. Respons API yang
 * membawa field lebih banyak daripada skemanya **tidak merusak apa pun**:
 * `hubResponseSchema` bukan `.strict()`, dan klien web mengetik respons lewat
 * assertion, bukan `parse()`. Yang hilang cuma TIPE-nya di sisi web, jadi
 * cabang `frozen` menunggu satu PR kecil dari Dev B.
 */
export interface HubQuest {
  /** Tanggal LOKAL pengguna, `YYYY-MM-DD`. */
  date: string;
  target_tasks: number;
  done_tasks: number;
  completed: boolean;
}

export interface HubSquad {
  squad_id: string;
  name: string;
  /** Peringkat pengguna DI DALAM squad-nya, 1 = teratas. */
  rank: number;
  members: number;
  weekly_points: number;
}

export interface HubNextCard {
  lesson_id: string;
  lesson_title: string;
  track_title: string;
}

export interface HubResponse {
  streak: {
    current_streak: number;
    longest_streak: number;
    freeze_credits: number;
    last_activity_date: string | null;
    /** `true` kalau pengguna belum aktif di hari lokalnya sendiri. */
    at_risk_today: boolean;
    /**
     * `true` kalau kredit beku MENYELAMATKAN hari lokal ini (SK-9).
     *
     * Boolean, bukan `freeze_used_date` mentah yang diminta isu #192: pola
     * yang sama dengan `at_risk_today`, dan alasannya sama — perbandingan
     * tanggal terjadi di Postgres dalam zona waktu pengguna (aturan keras 5),
     * bukan di klien yang tidak punya tanggal lokal yang bisa dipercaya.
     * Ekspresinya SATU ejaan dengan `localFacts` di `StreakService`.
     *
     * **Presentasi: ini menang atas `at_risk_today`.** Keduanya `true` pada
     * hari yang dibekukan — pengguna memang belum aktif, jadi `at_risk_today`
     * harfiahnya benar — tapi harinya sudah aman, jadi layar yang menampilkan
     * "sisa N jam untuk menjaga streak-mu" di situ berbohong soal urgensi.
     */
    freeze_used_today: boolean;
    /**
     * Zona waktu IANA yang MENENTUKAN seluruh tanggal di respons ini.
     *
     * Diambil dari `streaks.timezone` — sumber yang dipakai setiap
     * perhitungan streak, quest, dan kuota harian (lihat `ProfileService`).
     * Ada di sini supaya klien tidak perlu memanggil `GET /me` hanya untuk
     * merender hitungan sisa jam, dan — lebih penting — supaya hitungan itu
     * memakai zona yang SAMA dengan status yang didampinginya. `/me`
     * mengembalikan `users.timezone`, yang merupakan baris yang BERBEDA.
     */
    timezone: string;
  };
  quest: HubQuest;
  squad: HubSquad | null;
  balance: number;
  next_cards: HubNextCard[];
}
