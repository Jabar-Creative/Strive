/**
 * Bentuk respons `GET /hub`.
 *
 * **Seharusnya tinggal di `packages/contracts`**, tapi tidak ada di sana:
 * `F-08` berjudul "skema zod SELURUH endpoint MVP" dan `/hub` terlewat —
 * padahal PRD §10.3 menyebutnya "satu panggilan untuk seluruh layar Hub" dan
 * ia endpoint paling sering dipanggil di produk ini.
 *
 * `packages/contracts` milik Dev B (CLAUDE.md §Kepemilikan file), jadi tipenya
 * didefinisikan di sini sementara dan **dipindahkan begitu Dev B menambahkan
 * skemanya**. Sampai itu terjadi, klien web tidak punya tipe untuk endpoint
 * ini — itu kerugian nyata, bukan formalitas, dan sudah dilaporkan sebagai isu.
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
  };
  quest: HubQuest;
  squad: HubSquad | null;
  balance: number;
  next_cards: HubNextCard[];
}
