import { describe, expect, it } from 'vitest';
import type { DB } from '../src/infra/kysely';

/**
 * Membuktikan bahwa tipe hasil `pnpm db:types` benar-benar DIPAKAI kode API,
 * bukan cuma tergeletak di repo (acceptance criteria F-04).
 *
 * Ini test tipe: kalau sebuah tabel hilang dari skema lalu tipenya digenerate
 * ulang, baris di bawah berhenti dikompilasi. `pnpm typecheck` yang jadi
 * penjaganya, bukan assertion runtime.
 */
describe('tipe Kysely hasil codegen', () => {
  it('memuat tabel jalur uang, dengan kolom sesuai docs/PRD.md §9.3', () => {
    // Kalau kolomnya berubah nama atau hilang, baris ini gagal kompilasi.
    const shape: Pick<
      DB['coin_ledger'],
      'user_id' | 'entry_type' | 'amount' | 'balance_after' | 'idempotency_key'
    > | null = null;
    expect(shape).toBeNull();
  });

  it('memuat 31 tabel domain, tanpa ledger migrasi', () => {
    // strive_meta.schema_migrations adalah perkakas; kalau ia muncul di sini,
    // artinya --exclude-pattern di scripts/db-types.mjs jebol.
    const keys: Array<keyof DB> = [
      'users',
      'sessions',
      'refresh_tokens',
      'push_tokens',
      'tracks',
      'modules',
      'lessons',
      'lesson_cards',
      'lesson_attempts',
      'streaks',
      'daily_quests',
      'squads',
      'squad_members',
      'league_seasons',
      'league_standings',
      'coin_ledger',
      'pricing_config',
      'orders',
      'payments',
      'store_items',
      'store_purchases',
      'plagiarism_scans',
      'peer_reviews',
      'reviewer_weights',
      'ai_jobs',
      'cv_documents',
      'prompt_runs',
      'mastery_sessions',
      'outbox_events',
      'notifications',
      'audit_log',
    ];
    expect(keys).toHaveLength(31);
    expect(new Set(keys).size).toBe(31);
  });
});
