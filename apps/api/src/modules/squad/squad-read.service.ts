import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { type Kysely, sql } from 'kysely';

import { DATABASE, type DB } from '../../infra/kysely';
import { LeaderboardService } from '../league';
import type { UserRole } from '../../common/guards';

export interface SquadMemberView {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  weekly_points: number;
  rank: number;
}

export interface MySquad {
  squad_id: string;
  name: string;
  tier: string;
  season: { id: string; code: string; ends_at: string };
  members: SquadMemberView[];
  /** Posisi si pemanggil sendiri — supaya UI tidak perlu mencarinya di daftar. */
  me: { rank: number; weekly_points: number };
}

/** Siapa yang bertanya. Kepemilikan dicek service, bukan guard (PRD §2.5). */
export interface Actor {
  id: string;
  role: UserRole;
}

/**
 * Pembacaan squad untuk HTTP — `Q-06` (isu #79), PRD §10.3.
 *
 * ── Dua rute, dua sumber, dan itu DISENGAJA ──
 *
 *   `GET /squads/me`              -> PostgreSQL  (pemilik data)
 *   `GET /squads/:id/leaderboard` -> Redis ZSET  (lapisan pelayan)
 *
 * PRD §10.3 menulis "Dari ZSET Redis" hanya untuk yang kedua, dan bedanya
 * bukan gaya. `/squads/me` adalah pandangan keanggotaan: siapa anggota squad
 * ini dan berapa poinnya — pertanyaan yang jawabannya dimiliki
 * `squad_members`. `/leaderboard` adalah papan yang dibaca berulang-ulang
 * setiap 30 detik oleh setiap anggota, dan itulah yang pantas dilayani cache.
 *
 * Konsekuensinya bisa diuji: `FLUSHALL` Redis, lalu kedua rute **harus
 * mengembalikan angka yang identik** — karena yang satu membaca sumbernya dan
 * yang satu membangun ulang dari sumber yang sama.
 *
 * ── Musim diturunkan dari SQUAD-nya, bukan dari "musim berjalan" ──
 *
 * `squads.season_id` sudah menentukannya. Mencari "musim yang sedang aktif"
 * lalu menganggap squad ini ada di dalamnya akan salah tepat pada saat
 * pergantian musim — momen ketika papan paling sering dibuka orang.
 */
@Injectable()
export class SquadReadService {
  constructor(
    @Inject(DATABASE) private readonly db: Kysely<DB>,
    private readonly leaderboard: LeaderboardService,
  ) {}

  /** Squad milik si pemanggil, atau `null` kalau ia belum punya squad. */
  async mySquad(userId: string): Promise<MySquad | null> {
    const squad = await this.db
      .selectFrom('squad_members')
      .innerJoin('squads', 'squads.id', 'squad_members.squad_id')
      .innerJoin('league_seasons', 'league_seasons.id', 'squads.season_id')
      .select([
        'squads.id as squad_id',
        'squads.name as name',
        'squads.league_tier as tier',
        'league_seasons.id as season_id',
        'league_seasons.code as season_code',
        sql<string>`to_char(league_seasons.ends_at, 'YYYY-MM-DD"T"HH24:MI:SSOF')`.as('ends_at'),
      ])
      .where('squad_members.user_id', '=', userId)
      .where('squad_members.left_at', 'is', null)
      .executeTakeFirst();

    // Bukan 404: "belum punya squad" adalah keadaan yang SAH bagi pengguna
    // baru — squad dibentuk job mingguan (Q-01), bukan saat registrasi.
    if (!squad) return null;

    const members = await this.membersOf(squad.squad_id);
    const me = members.find((m) => m.user_id === userId);

    return {
      squad_id: squad.squad_id,
      name: squad.name,
      tier: squad.tier,
      season: { id: squad.season_id, code: squad.season_code, ends_at: squad.ends_at },
      members,
      // `me` pasti ada — ia terbaca dari keanggotaan yang sama. Fallback-nya
      // ada supaya tipe tidak berbohong, bukan karena kasusnya diharapkan.
      me: { rank: me?.rank ?? 0, weekly_points: me?.weekly_points ?? 0 },
    };
  }

  /**
   * Papan satu squad — dari Redis, dengan nama pengguna dari Postgres.
   *
   * **Kepemilikan dicek di sini, bukan di guard.** `RolesGuard` menjawab
   * "peran ini boleh masuk rute ini?" dan tidak tahu apa-apa soal keanggotaan.
   * AC `Q-06` menyebutnya harfiah: anggota squad lain tidak boleh membaca
   * papan squad yang bukan miliknya lewat `:id` tebakan.
   */
  async leaderboardOf(squadId: string, actor: Actor): Promise<SquadMemberView[]> {
    const squad = await this.db
      .selectFrom('squads')
      .select(['id', 'season_id', 'mentor_id'])
      .where('id', '=', squadId)
      .executeTakeFirst();

    if (!squad) {
      throw new NotFoundException({
        error: { code: 'NOT_FOUND', message: 'Squad tidak ditemukan', details: {} },
      });
    }

    await this.assertBolehMembaca(squad, actor);

    // `squads.season_id` NULLABLE sejak migrasi 001 — `REFERENCES
    // league_seasons(id)` tanpa NOT NULL. Squad tanpa musim tidak punya kunci
    // ZSET sama sekali (`lb:sq:<musim>:<squad>`), jadi papannya bukan "kosong",
    // ia tidak bisa dibentuk.
    //
    // Dikembalikan sebagai galat eksplisit, BUKAN array kosong: array kosong
    // terbaca "belum ada yang berpoin minggu ini" dan menyembunyikan keadaan
    // data yang seharusnya tidak pernah ada. `Q-01` selalu mengisinya — kalau
    // ini menyala, ada jalur lain yang membuat squad. Dicatat di isu #84.
    if (squad.season_id === null) {
      throw new ConflictException({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Squad ini tidak terhubung ke musim mana pun — papannya tidak bisa dibentuk',
          details: { squad_id: squadId },
        },
      });
    }

    const papan = await this.leaderboard.squadBoard(squad.season_id, squadId);
    if (papan.length === 0) return [];

    const nama = await this.db
      .selectFrom('users')
      .select(['id', 'display_name', 'avatar_url'])
      .where(
        'id',
        'in',
        papan.map((p) => p.user_id),
      )
      .execute();
    const byId = new Map(nama.map((u) => [u.id, u]));

    // Peringkat DIHITUNG ULANG di sini, tidak memakai `p.rank`.
    //
    // `LeaderboardService.readZset` memberi peringkat posisional
    // (`out.length + 1`) — benar untuk ZSET, tapi itu semantik ROW_NUMBER:
    // dua orang berpoin sama mendapat peringkat berbeda. `GET /squads/me`
    // memakai RANK() Postgres yang berbagi peringkat saat seri.
    //
    // Dua rute yang menampilkan papan yang sama dengan peringkat berbeda
    // adalah bug yang terlihat langsung oleh pengguna, di layar yang sama.
    // Disamakan ke semantik RANK().
    let rank = 0;
    let poinSebelumnya: number | null = null;
    return papan.map((p, i) => {
      if (p.points !== poinSebelumnya) {
        rank = i + 1;
        poinSebelumnya = p.points;
      }
      return {
        user_id: p.user_id,
        display_name: byId.get(p.user_id)?.display_name ?? '(pengguna dihapus)',
        avatar_url: byId.get(p.user_id)?.avatar_url ?? null,
        weekly_points: p.points,
        rank,
      };
    });
  }

  // ── internal ──────────────────────────────────────────────────────────

  /**
   * Boleh membaca kalau: anggota aktif squad itu, ATAU mentornya (PR-7).
   *
   * Pesan galatnya sengaja SAMA dengan "squad tidak ditemukan"? Tidak —
   * squad id adalah uuid v4, tidak bisa dicacah dengan menebak, dan
   * membedakan "tidak ada" dari "bukan milikmu" membuat pesan errornya
   * berguna bagi orang yang memang salah klik.
   */
  private async assertBolehMembaca(
    squad: { id: string; mentor_id: string | null },
    actor: Actor,
  ): Promise<void> {
    if (actor.role === 'mentor' && squad.mentor_id === actor.id) return;

    const anggota = await this.db
      .selectFrom('squad_members')
      .select('id')
      .where('squad_id', '=', squad.id)
      .where('user_id', '=', actor.id)
      .where('left_at', 'is', null)
      .executeTakeFirst();

    if (!anggota) {
      throw new ForbiddenException({
        error: {
          code: 'FORBIDDEN_ROLE',
          message: 'Papan squad hanya bisa dibaca anggotanya sendiri',
          details: { squad_id: squad.id },
        },
      });
    }
  }

  /** Anggota aktif + peringkat, dihitung Postgres. Sama sumbernya dengan `GET /hub`. */
  private async membersOf(squadId: string): Promise<SquadMemberView[]> {
    const r = await sql<{
      user_id: string;
      display_name: string;
      avatar_url: string | null;
      weekly_points: number;
      rank: string;
    }>`
      SELECT m.user_id,
             u.display_name,
             u.avatar_url,
             m.weekly_points,
             -- RANK(), bukan ROW_NUMBER(): dua anggota berpoin sama BERBAGI
             -- peringkat. ROW_NUMBER menempatkan salah satunya di atas
             -- berdasarkan urutan baris — perbedaan yang tidak ada dasarnya
             -- tapi terlihat nyata di layar.
             --
             -- Kolom user_id SENGAJA TIDAK ikut di dalam OVER(). Menambahkannya
             -- membuat urutannya total, dan RANK() yang urutannya total tidak
             -- pernah seri — ia berubah jadi ROW_NUMBER dengan nama lain.
             -- Versi pertama berkas ini melakukannya, dan komentar di atas
             -- jadi bohong sampai test menangkapnya.
             -- (Backtick dilarang di sini: ia menutup template literal-nya.)
             RANK() OVER (ORDER BY m.weekly_points DESC)::text AS rank
      FROM squad_members m
      JOIN users u ON u.id = m.user_id
      WHERE m.squad_id = ${squadId} AND m.left_at IS NULL
      ORDER BY m.weekly_points DESC, m.user_id
    `.execute(this.db);

    return r.rows.map((x) => ({
      user_id: x.user_id,
      display_name: x.display_name,
      avatar_url: x.avatar_url,
      weekly_points: x.weekly_points,
      rank: Number(x.rank),
    }));
  }
}
