export interface JoinResult {
  memberId: string;
  squadId: string;
}

export interface LeaveResult {
  /** false kalau pengguna memang tidak punya squad aktif — bukan error. */
  left: boolean;
  squadId: string | null;
}

export interface FormedSquad {
  squadId: string;
  memberCount: number;
}
