import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import type { Kysely } from 'kysely';

import { DATABASE, type DB } from '../../infra/kysely';
import { REDIS } from '../../infra/redis';

/** Kunci ZSET per musim — PRD §9.4. Dirotasi per musim, tidak pernah di-reset (SQ-5). */
export const squadKey = (seasonId: string, squadId: string) => `lb:sq:${seasonId}:${squadId}`;
export const leagueKey = (seasonId: string, tier: string) => `lb:lg:${seasonId}:${tier}`;

/** 14 hari — PRD §9.4. Kunci musim lama kedaluwarsa sendiri, tidak dihapus manual. */
export const LB_TTL_SECONDS = 14 * 24 * 60 * 60;

export interface RankedUser {
  user_id: string;
  points: number;
  rank: number;
}

/**
 * Papan peringkat minggu berjalan — PRD §7 E5 `SQ-4` … `SQ-7`.
 *
 * **Redis melayani, Postgres memiliki.** Itu bukan optimasi; itu satu-satunya
 * hal yang membuat berkas ini aman. Setiap struktur di sini punya fungsi
 * rebuild, dan kehilangan Redis **bukan insiden** (CLAUDE.md aturan 7) —
 * acceptance criteria item ini menyebutkannya harfiah: `FLUSHALL` lalu papan
 * pulih sendiri pada request berikutnya, dengan angka identik.
 *
 * Konsekuensi yang membentuk setiap method: **tidak ada satu pun nilai yang
 * hanya hidup di Redis.** Kalau suatu saat ada yang menambah kunci baru di
 * sini tanpa jalur rebuild-nya, itu belum selesai.
 *
 * Penulisan poin TIDAK dilakukan dari request (SQ-7) — ia datang dari outbox
 * worker setelah transaksi commit (aturan 6 & 10). `bump()` di bawah ada untuk
 * dipanggil worker itu, bukan controller.
 */
@Injectable()
export class LeaderboardService {
  constructor(
    @Inject(DATABASE) private readonly db: Kysely<DB>,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /**
   * Papan satu squad. **Membangun ulang sendiri kalau kuncinya tidak ada.**
   *
   * Itu inti AC-nya: pemanggil tidak pernah perlu tahu apakah Redis baru saja
   * kosong. Tidak ada jalur kode "tolong rebuild dulu" — karena jalur seperti
   * itu pasti ada yang lupa memanggilnya.
   */
  async squadBoard(seasonId: string, squadId: string): Promise<RankedUser[]> {
    const key = squadKey(seasonId, squadId);
    if ((await this.redis.exists(key)) === 0) {
      await this.rebuildSquad(seasonId, squadId);
    }
    return this.readZset(key);
  }

  /** Peringkat satu pengguna di squad-nya, atau null kalau ia bukan anggota. */
  async rankOf(seasonId: string, squadId: string, userId: string): Promise<RankedUser | null> {
    const board = await this.squadBoard(seasonId, squadId);
    return board.find((r) => r.user_id === userId) ?? null;
  }

  /**
   * Menambah poin. **Dipanggil outbox worker, bukan request** (SQ-7).
   *
   * Aman dipanggil pada kunci yang belum ada: `ZINCRBY` membuatnya. Tapi kunci
   * yang lahir dari `bump` saja akan TIDAK LENGKAP — ia hanya memuat pengguna
   * yang kebetulan bergerak sejak Redis kosong. Karena itu ia di-rebuild dulu
   * kalau kuncinya belum ada, dan TTL selalu diperbarui.
   */
  async bump(seasonId: string, squadId: string, userId: string, points: number): Promise<void> {
    const key = squadKey(seasonId, squadId);
    if ((await this.redis.exists(key)) === 0) {
      await this.rebuildSquad(seasonId, squadId);
    }
    await this.redis.zincrby(key, points, userId);
    await this.redis.expire(key, LB_TTL_SECONDS);
  }

  /**
   * Membangun ulang ZSET squad DARI POSTGRES.
   *
   * Sumbernya `squad_members.weekly_points` — kolom yang sama yang dibaca
   * `GET /hub`. Satu sumber kebenaran untuk dua pembaca; kalau keduanya
   * membaca tempat berbeda, salah satunya akan berbohong.
   */
  async rebuildSquad(seasonId: string, squadId: string): Promise<number> {
    const rows = await this.db
      .selectFrom('squad_members')
      .innerJoin('squads', 'squads.id', 'squad_members.squad_id')
      .select(['squad_members.user_id as user_id', 'squad_members.weekly_points as points'])
      .where('squad_members.squad_id', '=', squadId)
      .where('squad_members.left_at', 'is', null)
      .where('squads.season_id', '=', seasonId)
      .execute();

    const key = squadKey(seasonId, squadId);
    // Pipeline, bukan N perjalanan bolak-balik. DEL dulu supaya rebuild
    // benar-benar mengganti, bukan menumpuk di atas sisa yang mungkin ada.
    const pipe = this.redis.pipeline();
    pipe.del(key);
    for (const r of rows) pipe.zadd(key, r.points, r.user_id);
    // TTL dipasang meski ZSET kosong? Tidak — kunci kosong tidak dibuat sama
    // sekali oleh zadd, dan expire atas kunci yang tidak ada adalah no-op.
    pipe.expire(key, LB_TTL_SECONDS);
    await pipe.exec();

    return rows.length;
  }

  /** Membangun ulang papan liga (agregat poin per squad) dari ZSET squad. */
  async rebuildLeague(seasonId: string, tier: string): Promise<number> {
    const squads = await this.db
      .selectFrom('squads')
      .select('id')
      .where('season_id', '=', seasonId)
      .execute();

    const key = leagueKey(seasonId, tier);
    const pipe = this.redis.pipeline();
    pipe.del(key);
    for (const s of squads) {
      const board = await this.squadBoard(seasonId, s.id);
      pipe.zadd(
        key,
        board.reduce((t, r) => t + r.points, 0),
        s.id,
      );
    }
    pipe.expire(key, LB_TTL_SECONDS);
    await pipe.exec();

    return squads.length;
  }

  // ── internal ────────────────────────────────────────────────────────────

  private async readZset(key: string): Promise<RankedUser[]> {
    const flat = await this.redis.zrevrange(key, 0, -1, 'WITHSCORES');
    const out: RankedUser[] = [];
    for (let i = 0; i < flat.length; i += 2) {
      out.push({
        user_id: flat[i]!,
        // Skor Redis bertipe double. Koin dan poin selalu INTEGER di produk
        // ini (CLAUDE.md), jadi dibulatkan di batas ini alih-alih membiarkan
        // 0.30000000000000004 muncul di respons API.
        points: Math.round(Number(flat[i + 1]!)),
        rank: out.length + 1,
      });
    }
    return out;
  }
}
