import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';

import { DATABASE, type DB } from '../../infra/kysely';
import type { SessionContext } from './auth.types';

/**
 * Yang tersisa dari AU-5, dan **hanya** itu.
 *
 * Isu #18 membuang AU-5 — deteksi pemakaian ulang refresh token. Better-Auth
 * tidak merotasi token sesi, jadi sinyal otomatis "sesi ini dicuri" tidak
 * punya padanan, dan membangunnya sendiri di atas Better-Auth berarti menulis
 * logika auth sendiri lewat pintu belakang.
 *
 * Akibatnya perlu disebut terang, bukan disamarkan jadi nama method yang
 * terdengar aman: **token sesi yang dicuri berlaku sampai kedaluwarsa, dan
 * tidak ada yang tahu ia dicuri.**
 *
 * Tiga method di bawah adalah penggantinya, dan ketiganya **mengurangi
 * dampak, bukan menggantikan deteksinya**:
 *
 * 1. `recordSession` — sesi ganda dari lokasi berbeda masih bisa DILIHAT
 *    manusia di `audit_log`. Tidak otomatis.
 * 2. `revokeAllSessions` — ganti password memutus semua perangkat sekaligus.
 * 3. `revokeSession` — Superadmin mencabut satu sesi lewat Retool.
 *
 * Pantas ditinjau ulang di checkpoint scope W5 (PRD §7 E1).
 */
@Injectable()
export class AuthService {
  constructor(@Inject(DATABASE) private readonly db: Kysely<DB>) {}

  /**
   * Mencatat pembuatan sesi ke `audit_log`.
   *
   * `ip` masuk ke kolom `after` (jsonb), BUKAN ke `audit_log.ip` yang bertipe
   * `inet` — nilai yang datang dari `X-Forwarded-For` boleh berisi rantai
   * proxy, dan `inet` menolaknya. Pencatatan audit yang gagal karena format
   * alamat adalah kehilangan jejak justru pada kejadian yang paling ingin
   * dilihat.
   */
  async recordSession(userId: string, ctx: SessionContext): Promise<void> {
    await this.db
      .insertInto('audit_log')
      .values({
        actor_id: userId,
        action: 'auth.session_created',
        subject_type: 'user',
        subject_id: userId,
        after: JSON.stringify({
          session_id: ctx.sessionId,
          ip: ctx.ip,
          user_agent: ctx.userAgent,
        }),
      })
      .execute();
  }

  /**
   * Mencabut SELURUH sesi pengguna. Dipanggil saat ganti password.
   *
   * Mengembalikan jumlah sesi yang benar-benar dihapus — pemanggil berhak tahu
   * berapa perangkat yang baru saja diputus, dan angka itu yang masuk audit.
   */
  async revokeAllSessions(userId: string, reason: string): Promise<number> {
    const dihapus = await this.db
      .deleteFrom('sessions')
      .where('user_id', '=', userId)
      .returning('id')
      .execute();

    // Ditulis meski nol: "tidak ada sesi yang dicabut" adalah fakta yang
    // berguna saat menelusuri insiden, dan ketiadaan baris audit tidak bisa
    // dibedakan dari "pencabutannya tidak pernah dipanggil".
    await this.db
      .insertInto('audit_log')
      .values({
        actor_id: userId,
        action: 'auth.sessions_revoked',
        subject_type: 'user',
        subject_id: userId,
        after: JSON.stringify({ count: dihapus.length, reason }),
      })
      .execute();

    return dihapus.length;
  }

  /**
   * Mencabut satu sesi.
   *
   * Mengembalikan `false` kalau sesinya tidak ada, bukan melempar: reaper dan
   * panel admin memanggil ini untuk banyak id sekaligus, dan sebagian mungkin
   * sudah kedaluwarsa duluan.
   */
  async revokeSession(sessionId: string, reason: string): Promise<boolean> {
    const baris = await this.db
      .deleteFrom('sessions')
      .where('id', '=', sessionId)
      .returning(['id', 'user_id'])
      .executeTakeFirst();

    if (!baris) return false;

    await this.db
      .insertInto('audit_log')
      .values({
        actor_id: baris.user_id,
        action: 'auth.session_revoked',
        subject_type: 'session',
        subject_id: baris.id,
        after: JSON.stringify({ user_id: baris.user_id, reason }),
      })
      .execute();

    return true;
  }
}
