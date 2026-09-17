import { Inject, Injectable } from '@nestjs/common';
import { type Kysely, sql } from 'kysely';

import { DATABASE, type DB } from '../../infra/kysely';
import type { HubNextCard, HubQuest, HubResponse, HubSquad } from './hub.types';

/** Berapa lesson berikutnya yang disarankan — PRD §10.3: "3 kartu berikutnya". */
const NEXT_CARDS = 3;

/**
 * Satu request untuk seluruh layar Hub — PRD §10.3.
 *
 * Alasan endpoint ini ada sama sekali adalah **menghindari 5 request dari satu
 * layar**. Jadi service ini hanya boleh melanggar janjinya sendiri dengan satu
 * cara: mengerjakan lima query berurutan. Kelimanya dijalankan **bersamaan**
 * lewat `Promise.all`, dan tidak satu pun bergantung pada hasil yang lain.
 *
 * Semua perhitungan tanggal terjadi DI DALAM SQL dengan
 * `(now() AT TIME ZONE users.timezone)::date` (CLAUDE.md aturan 5). Tidak ada
 * satu pun `Date` yang dibentuk di Node di berkas ini — kalau ada, "hari ini"
 * akan bergantung pada TZ proses, dan quest harian pengguna WIB akan berganti
 * pada jam yang salah.
 */
@Injectable()
export class HubService {
  constructor(@Inject(DATABASE) private readonly db: Kysely<DB>) {}

  async forUser(userId: string): Promise<HubResponse> {
    const [streak, quest, squad, balance, next_cards] = await Promise.all([
      this.streak(userId),
      this.quest(userId),
      this.squad(userId),
      this.balance(userId),
      this.nextCards(userId),
    ]);
    return { streak, quest, squad, balance, next_cards };
  }

  // ── bagian ────────────────────────────────────────────────────────────

  private async streak(userId: string): Promise<HubResponse['streak']> {
    const r = await sql<{
      current_streak: number;
      longest_streak: number;
      freeze_credits: number;
      last_activity_date: string | null;
      at_risk_today: boolean;
    }>`
      SELECT s.current_streak, s.longest_streak, s.freeze_credits,
             to_char(s.last_activity_date, 'YYYY-MM-DD') AS last_activity_date,
             -- "Berisiko" = belum aktif di HARI LOKALNYA SENDIRI. Dibandingkan
             -- di Postgres; membandingkannya di Node akan salah untuk setiap
             -- pengguna yang zona waktunya berbeda dari server.
             (s.last_activity_date IS DISTINCT FROM (now() AT TIME ZONE s.timezone)::date)
               AS at_risk_today
      FROM streaks s
      WHERE s.user_id = ${userId}
    `.execute(this.db);

    const row = r.rows[0];
    // Baris streaks dibuat trigger saat registrasi (AU-6, migrasi 005).
    // Ketiadaannya berarti registrasi tidak utuh — Hub tidak menambalnya
    // diam-diam, tapi juga tidak menggagalkan seluruh layar karena itu.
    if (!row) {
      return {
        current_streak: 0,
        longest_streak: 0,
        freeze_credits: 0,
        last_activity_date: null,
        at_risk_today: true,
      };
    }
    return {
      current_streak: row.current_streak,
      longest_streak: row.longest_streak,
      freeze_credits: row.freeze_credits,
      last_activity_date: row.last_activity_date,
      at_risk_today: row.at_risk_today,
    };
  }

  private async quest(userId: string): Promise<HubQuest> {
    const r = await sql<{
      date: string;
      target_tasks: number;
      done_tasks: number;
      completed: boolean;
    }>`
      SELECT to_char((now() AT TIME ZONE u.timezone)::date, 'YYYY-MM-DD') AS date,
             COALESCE(q.target_tasks, 3)      AS target_tasks,
             COALESCE(q.done_tasks, 0)        AS done_tasks,
             (q.completed_at IS NOT NULL)     AS completed
      FROM users u
      -- LEFT JOIN, bukan SELECT terpisah: quest hari ini belum tentu ada
      -- (barisnya dibuat saat micro-task pertama), dan Hub harus tetap
      -- menampilkan target 3/0 alih-alih kosong.
      LEFT JOIN daily_quests q
        ON q.user_id = u.id
       AND q.quest_date = (now() AT TIME ZONE u.timezone)::date
      WHERE u.id = ${userId}
    `.execute(this.db);

    const row = r.rows[0];
    return row
      ? {
          date: row.date,
          target_tasks: row.target_tasks,
          done_tasks: row.done_tasks,
          completed: row.completed,
        }
      : { date: '', target_tasks: 3, done_tasks: 0, completed: false };
  }

  private async squad(userId: string): Promise<HubSquad | null> {
    const r = await sql<{
      squad_id: string;
      name: string;
      rank: string;
      members: string;
      weekly_points: number;
    }>`
      WITH anggota AS (
        SELECT m.squad_id
        FROM squad_members m
        WHERE m.user_id = ${userId} AND m.left_at IS NULL
      ),
      papan AS (
        -- Poin MINGGUAN per pengguna tinggal di squad_members.weekly_points.
        -- league_standings berkunci (season_id, squad_id) — itu peringkat
        -- SQUAD di liga, bukan peringkat orang di dalam squad. Dua hal yang
        -- namanya mirip dan artinya berbeda.
        SELECT m.user_id,
               m.weekly_points,
               -- Peringkat dihitung Postgres. Mengurutkannya di Node berarti
               -- menarik seluruh anggota squad ke memori untuk satu angka.
               RANK() OVER (ORDER BY m.weekly_points DESC, m.user_id) AS rank
        FROM squad_members m
        JOIN anggota a ON a.squad_id = m.squad_id
        WHERE m.left_at IS NULL
      )
      SELECT s.id AS squad_id, s.name,
             p.rank::text AS rank,
             (SELECT count(*) FROM papan)::text AS members,
             p.weekly_points
      FROM papan p
      JOIN anggota a ON true
      JOIN squads s ON s.id = a.squad_id
      WHERE p.user_id = ${userId}
    `.execute(this.db);

    const row = r.rows[0];
    return row
      ? {
          squad_id: row.squad_id,
          name: row.name,
          rank: Number(row.rank),
          members: Number(row.members),
          weekly_points: row.weekly_points,
        }
      : null;
  }

  private async balance(userId: string): Promise<number> {
    const row = await this.db
      .selectFrom('users')
      .select('coin_balance')
      .where('id', '=', userId)
      .executeTakeFirst();
    return row?.coin_balance ?? 0;
  }

  private async nextCards(userId: string): Promise<HubNextCard[]> {
    const r = await sql<{ lesson_id: string; lesson_title: string; track_title: string }>`
      SELECT l.id AS lesson_id, l.title AS lesson_title, t.title AS track_title
      FROM lessons l
      JOIN modules m ON m.id = l.module_id
      JOIN tracks  t ON t.id = m.track_id
      WHERE t.is_published
        -- Lesson yang SUDAH dikerjakan tidak disarankan lagi. NOT EXISTS,
        -- bukan LEFT JOIN … IS NULL: lesson_attempts terpartisi dan bisa
        -- sangat besar, dan anti-join berhenti di baris pertama yang cocok.
        AND NOT EXISTS (
          SELECT 1 FROM lesson_attempts a
          WHERE a.user_id = ${userId} AND a.lesson_id = l.id
        )
      ORDER BY t.sort_order, m.sort_order, l.sort_order
      LIMIT ${sql.lit(NEXT_CARDS)}
    `.execute(this.db);

    return r.rows.map((x) => ({
      lesson_id: x.lesson_id,
      lesson_title: x.lesson_title,
      track_title: x.track_title,
    }));
  }
}
