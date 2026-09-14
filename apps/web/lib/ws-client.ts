/**
 * KERANGKA client WebSocket. Belum konek — itu disengaja.
 *
 * Aturan yang TIDAK boleh hilang saat file ini diisi (docs/PRD.md §7 E15, §11):
 *   - WS adalah PELENGKAP, bukan pengganti. Setiap layar harus tetap benar
 *     tanpa satu pun event WS; REST memberi keadaan awal.
 *   - Fallback polling 30 detik WAJIB dan otomatis (RT-5).
 *   - v0.1 hanya satu kanal: `squad:{id}` dengan event `score.updated`.
 *     Kanal `user:` dan `league:` tetap polling.
 *   - Klien hanya boleh subscribe ke squad-nya sendiri; ditolak saat subscribe.
 *
 * Implementasi: item RT-02 (Dev B), bergantung pada RT-01 (Dev A).
 */

export const REALTIME_NAMESPACE = '/rt';

/** Interval fallback saat WS mati atau dimatikan lewat FEATURE_WS_ENABLED. */
export const POLLING_FALLBACK_MS = 30_000;

/** Kanal yang aktif di v0.1. Sisanya polling — docs/PRD.md §11. */
export type RealtimeChannel = `squad:${string}`;

export interface ScoreUpdatedEvent {
  user_id: string;
  points: number;
  user_total: number;
  squad_total: number;
}

export interface WsClientConfig {
  url: string;
  getAccessToken: () => string | null | Promise<string | null>;
}

export function createWsClient(_config: WsClientConfig) {
  // Implementasi menyusul di RT-02.
  throw new Error(
    'ws-client belum diimplementasikan — lihat RT-02 di docs/BACKLOG.md sebelum memakainya.',
  );
}

export type WsClient = ReturnType<typeof createWsClient>;
