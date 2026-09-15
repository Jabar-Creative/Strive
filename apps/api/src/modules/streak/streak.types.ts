/** Baris `streaks` — docs/PRD.md §9.3. */
export interface StreakRow {
  user_id: string;
  current_streak: number;
  longest_streak: number;
  /** TANGGAL LOKAL pengguna, bukan UTC. */
  last_activity_date: string | null;
  timezone: string;
  freeze_credits: number;
  freeze_used_date: string | null;
  freeze_purchased_month: string | null;
}

/** Empat hasil yang mungkin — docs/PRD.md Lampiran B. */
export type StreakKind = 'already_active' | 'extended' | 'restarted';

export interface StreakResult {
  kind: StreakKind;
  current: number;
  longest: number;
  /** Tanggal lokal pengguna saat aktivitas ini dicatat, `YYYY-MM-DD`. */
  localDate: string;
  isNewRecord: boolean;
}

export type FreezeKind =
  /** Kredit terpakai, hari ini terselamatkan. */
  | 'frozen'
  /** Sudah di-freeze hari ini — no-op, kredit tidak berkurang lagi. */
  | 'already_frozen'
  /** Sudah aktif hari ini — freeze tidak ada gunanya, kredit tidak dipakai. */
  | 'already_active';

export interface FreezeResult {
  kind: FreezeKind;
  credits: number;
  localDate: string;
}
