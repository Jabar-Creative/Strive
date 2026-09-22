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
   * Menyelaraskan skor SATU anggota dengan Postgres. **Dipanggil outbox
   * worker, bukan request** (SQ-7). Menggantikan `bump()` (`Q-03`).
   *
   * ── Kenapa bukan `ZINCRBY` ──
   *
   * `bump()` versi `Q-02` menambah poin dengan `ZINCRBY`, dan itu salah di dua
   * tempat sekaligus — keduanya baru terlihat begitu `L-03` benar-benar
   * menulis event:
   *
   * 1. **Poin terhitung DUA KALI setelah Redis kosong.** `L-03` menaikkan
   *    `squad_members.weekly_points` di transaksi yang SAMA dengan event
   *    outbox-nya. Saat worker memproses event itu dan kuncinya tidak ada,
   *    rebuild membaca `weekly_points` — yang SUDAH memuat poin event ini —
   *    lalu `ZINCRBY` menambahkannya lagi. Test `Q-02` lulus karena ia tidak
   *    pernah menulis `weekly_points` sebelum `bump`, jadi ia menguji dunia
   *    yang urutannya tidak pernah ada.
   *
   * 2. **Tidak idempoten.** PRD §8.3: pengantaran outbox *at-least-once*, dan
   *    konsumen **wajib idempoten**. Worker yang mati tepat setelah menulis
   *    Redis tapi sebelum menandai event selesai akan memprosesnya lagi, dan
   *    `ZINCRBY` kedua menambah poin yang tidak pernah diperoleh.
   *
   * Yang dipakai karena itu `ZADD` dengan nilai **mutlak** dari Postgres —
   * sumber kebenarannya (SQ-4). Dijalankan sekali, dua kali, atau sepuluh kali:
   * hasilnya sama. Urutan pemrosesan pun tidak lagi penting, karena yang
   * ditulis selalu nilai terbaru, bukan selisih.
   */
  async syncMember(seasonId: string, squadId: string, userId: string): Promise<void> {
    const key = squadKey(seasonId, squadId);
    if ((await this.redis.exists(key)) === 0) {
      // Rebuild sudah memuat nilai terbaru pengguna ini — tidak ada yang perlu
      // ditambahkan sesudahnya. Justru menambah di sini asal double-count.
      await this.rebuildSquad(seasonId, squadId);
      return;
    }

    const row = await this.db
      .selectFrom('squad_members')
      .select('weekly_points')
      .where('squad_id', '=', squadId)
      .where('user_id', '=', userId)
      .where('left_at', 'is', null)
      .executeTakeFirst();

    if (!row) {
      // Sudah keluar sejak event ditulis. Papan tidak memuat anggota yang
      // keluar (sama dengan `rebuildSquad`), jadi yang benar menghapusnya.
      await this.redis.zrem(key, userId);
      return;
    }

    const pipe = this.redis.pipeline();
    pipe.zadd(key, row.weekly_points, userId);
    pipe.expire(key, LB_TTL_SECONDS);
    await pipe.exec();
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
