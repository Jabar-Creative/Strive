import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { type Kysely, sql } from 'kysely';

import { DATABASE, type DB } from '../../infra/kysely';
import type { Trx } from '../wallet';
import type { FormedSquad, JoinResult, LeaveResult } from './squad.types';

/** Batas anggota — SQ-1 dan CHECK `squads_max_members_range` di 001_init.sql. */
const MIN_MEMBERS = 8;
const MAX_MEMBERS = 12;

/** Jendela pengelompokan: rata-rata poin 2 minggu terakhir (§5 Q4). */
const GROUPING_WINDOW_DAYS = 14;

/** §5 Q5: maksimal 1 perpindahan per musim per pengguna. */
const MAX_MOVES_PER_SEASON = 1;

/**
 * Pembentukan dan keanggotaan squad.
 *
 * Dua batas yang ditegakkan di sini punya sifat berbeda, dan bedanya penting:
 *
 * **"Satu squad aktif per pengguna" ditegakkan DATABASE** lewat partial unique
 * index `squad_members_one_active`. Service ini tidak menduplikasi
 * pengecekannya di kode — ia menangkap pelanggaran constraint dan
 * menerjemahkannya jadi kode error. Pengecekan di kode yang mendahului
 * constraint akan kalah balapan dengan transaksi paralel; constraint tidak.
 *
 * **"Squad tidak melebihi max_members" TIDAK bisa jadi CHECK** — PostgreSQL
 * tidak bisa menyatakan "jumlah baris terkait <= nilai kolom" sebagai
 * constraint sederhana. Karena itu ditegakkan dengan mengunci baris squad
 * (`SELECT … FOR UPDATE`) sebelum menghitung. Tanpa kunci itu, sepuluh join
 * bersamaan sama-sama membaca "7 anggota" dan kesepuluhnya masuk.
 */
@Injectable()
export class SquadService {
  constructor(@Inject(DATABASE) private readonly db: Kysely<DB>) {}

  /** Jumlah anggota aktif. Dipakai service dan test. */
  async activeMemberCount(db: Kysely<DB> | Trx, squadId: string): Promise<number> {
    const row = await db
      .selectFrom('squad_members')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('squad_id', '=', squadId)
      .where('left_at', 'is', null)
      .executeTakeFirst();
    return Number(row?.n ?? 0);
  }

  /**
   * Memasukkan pengguna ke squad.
   *
   * Mengunci baris squad lebih dulu: itu titik serialisasi per squad, dan
   * satu-satunya alasan kursi terakhir tidak bisa diisi dua orang sekaligus.
   */
  async join(trx: Trx, userId: string, squadId: string): Promise<JoinResult> {
    const squad = await trx
      .selectFrom('squads')
      .select(['id', 'max_members'])
      .where('id', '=', squadId)
      .forUpdate()
      .executeTakeFirst();

    if (!squad) {
      throw new ConflictException({
        error: { code: 'NOT_FOUND', message: 'Squad tidak ditemukan', details: { squadId } },
      });
    }

    const count = await this.activeMemberCount(trx, squadId);
    if (count >= squad.max_members) {
      throw new ConflictException({
        error: {
          code: 'SQUAD_FULL',
          message: 'Squad sudah penuh',
          details: { squadId, members: count, max: squad.max_members },
        },
      });
    }

    try {
      const row = await trx
        .insertInto('squad_members')
        .values({ squad_id: squadId, user_id: userId })
        .returning(['id', 'squad_id', 'user_id'])
        .executeTakeFirstOrThrow();
      return { memberId: row.id, squadId: row.squad_id };
    } catch (error) {
      // Pelanggaran `squad_members_one_active` diterjemahkan, bukan didahului
      // pengecekan sendiri — constraint yang jadi sumber kebenarannya.
      if (
        String((error as { message?: string }).message ?? '').includes('squad_members_one_active')
      ) {
        throw new ConflictException({
          error: {
            code: 'ALREADY_IN_SQUAD',
            message: 'Pengguna sudah aktif di squad lain',
            details: { userId },
          },
        });
      }
      throw error;
    }
  }

  /**
   * Mengeluarkan pengguna dari squad aktifnya.
   *
   * Barisnya TIDAK dihapus — `left_at` diisi. Poin mingguan yang sudah
   * terkumpul tetap tercatat di squad lama untuk musim itu (§5 Q5), dan
   * riwayat keanggotaan tetap bisa ditelusuri.
   */
  async leave(trx: Trx, userId: string): Promise<LeaveResult> {
    const rows = await trx
      .updateTable('squad_members')
      .set({ left_at: new Date() })
      .where('user_id', '=', userId)
      .where('left_at', 'is', null)
      .returning(['id', 'squad_id'])
      .execute();

    const row = rows[0];
    // Keluar saat tidak punya squad bukan error: job mingguan memanggil ini
    // untuk banyak pengguna sekaligus dan sebagian memang sudah keluar.
    return row ? { left: true, squadId: row.squad_id } : { left: false, squadId: null };
  }

  /**
   * Pindah squad di tengah musim (§5 Q5).
   *
   * Poin TIDAK ikut pindah dan baris baru mulai dari nol. Tanpa aturan itu ada
   * eksploitasi jelas: pindah ke squad yang hampir menang di hari terakhir.
   */
  async move(trx: Trx, userId: string, targetSquadId: string): Promise<JoinResult> {
    const seasonId = await this.seasonOfSquad(trx, targetSquadId);
    const moves = await this.movesThisSeason(trx, userId, seasonId);

    if (moves >= MAX_MOVES_PER_SEASON) {
      throw new ConflictException({
        error: {
          code: 'SQUAD_MOVE_LIMIT',
          message: 'Sudah mencapai batas perpindahan squad musim ini',
          details: { moves, max: MAX_MOVES_PER_SEASON },
        },
      });
    }

    await this.leave(trx, userId);
    return this.join(trx, userId, targetSquadId);
  }

  /**
   * Job mingguan: menempatkan pengguna tanpa squad ke squad 8–12 orang,
   * dikelompokkan berdasarkan rata-rata poin 2 minggu terakhir (§5 Q4).
   *
   * Sisa yang kurang dari 8 TIDAK dipaksakan jadi squad sendiri — squad kecil
   * membuat liganya tidak berarti, dan PRD sudah menetapkan squad < 3 anggota
   * digabung musim berikutnya. Mereka menunggu job minggu depan.
   */
  async formSquads(trx: Trx, seasonId: string): Promise<FormedSquad[]> {
    const eligible = await this.eligibleUsers(trx);
    if (eligible.length < MIN_MEMBERS) return [];

    const groups = this.chunk(eligible.map((u) => u.user_id));
    const formed: FormedSquad[] = [];

    for (const [index, members] of groups.entries()) {
      const squad = await trx
        .insertInto('squads')
        .values({
          name: `Squad ${index + 1}`,
          season_id: seasonId,
          max_members: MAX_MEMBERS,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      for (const userId of members) {
        await this.join(trx, userId, squad.id);
      }
      formed.push({ squadId: squad.id, memberCount: members.length });
    }

    return formed;
  }

  // ── internal ────────────────────────────────────────────────────────────

  /**
   * Pengguna tanpa squad aktif, diurutkan dari rata-rata poin TERTINGGI.
   *
   * Urutannya yang membuat pengelompokan bermakna: potongan berurutan dari
   * daftar terurut menghasilkan squad yang anggotanya setara, bukan timpang.
   */
  private async eligibleUsers(trx: Trx): Promise<Array<{ user_id: string; avg_points: number }>> {
    const result = await sql<{ user_id: string; avg_points: string }>`
      SELECT u.id AS user_id,
             COALESCE(AVG(a.points), 0) AS avg_points
      FROM users u
      LEFT JOIN lesson_attempts a
        ON a.user_id = u.id
       AND a.attempt_date >= (now() AT TIME ZONE u.timezone)::date
                             - ${sql.lit(GROUPING_WINDOW_DAYS)}::int
      WHERE u.status = 'active'
        AND NOT EXISTS (
          SELECT 1 FROM squad_members m
          WHERE m.user_id = u.id AND m.left_at IS NULL
        )
      GROUP BY u.id
      ORDER BY avg_points DESC, u.id
    `.execute(trx);

    return result.rows.map((r) => ({ user_id: r.user_id, avg_points: Number(r.avg_points) }));
  }

  /**
   * Memotong daftar jadi kelompok 8–12, tanpa menyisakan kelompok < 8.
   *
   * Sisa yang tidak muat dibagikan ke kelompok-kelompok sebelumnya sampai
   * batas 12 — itu sebabnya `MAX_MEMBERS` ada di sini, bukan cuma di database.
   */
  private chunk(userIds: string[]): string[][] {
    const groupCount = Math.floor(userIds.length / MIN_MEMBERS);
    if (groupCount === 0) return [];

    const groups: string[][] = Array.from({ length: groupCount }, () => []);
    let cursor = 0;

    // Isi setiap kelompok sampai minimum dulu, baru bagikan sisanya.
    for (const group of groups) {
      group.push(...userIds.slice(cursor, cursor + MIN_MEMBERS));
      cursor += MIN_MEMBERS;
    }
    for (const group of groups) {
      while (cursor < userIds.length && group.length < MAX_MEMBERS) {
        group.push(userIds[cursor]!);
        cursor += 1;
      }
    }

    return groups;
  }

  private async seasonOfSquad(trx: Trx, squadId: string): Promise<string | null> {
    const row = await trx
      .selectFrom('squads')
      .select('season_id')
      .where('id', '=', squadId)
      .executeTakeFirst();
    return row?.season_id ?? null;
  }

  /**
   * Berapa kali pengguna sudah meninggalkan squad DI MUSIM INI.
   *
   * Dihitung per musim, bukan seumur hidup — riwayat pindah musim lalu tidak
   * boleh membatasi musim ini.
   */
  private async movesThisSeason(
    trx: Trx,
    userId: string,
    seasonId: string | null,
  ): Promise<number> {
    if (!seasonId) return 0;
    const row = await trx
      .selectFrom('squad_members')
      .innerJoin('squads', 'squads.id', 'squad_members.squad_id')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('squad_members.user_id', '=', userId)
      .where('squad_members.left_at', 'is not', null)
      .where('squads.season_id', '=', seasonId)
      .executeTakeFirst();
    return Number(row?.n ?? 0);
  }
}
