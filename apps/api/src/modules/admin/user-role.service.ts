import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { type Kysely, sql } from 'kysely';

import { DATABASE, type DB } from '../../infra/kysely';
import { ROLES, type UserRole } from '../../common/guards';

/**
 * Kunci advisory untuk SELURUH perubahan peran — lihat `changeRole`.
 *
 * Satu kunci global, bukan per-pengguna: yang dijaga bukan barisnya, tapi
 * INVARIAN LINTAS BARIS ("selalu ada minimal satu superadmin"). Mengunci per
 * baris tidak menjaga invarian yang melibatkan baris lain.
 */
const ROLE_LOCK_NAME = 'users:role-change';

export interface ChangeRoleResult {
  userId: string;
  role: UserRole;
  previousRole: UserRole;
  /** `false` kalau perannya memang sudah begitu — tidak ada yang berubah. */
  changed: boolean;
}

function isUserRole(v: unknown): v is UserRole {
  return typeof v === 'string' && (ROLES as readonly string[]).includes(v);
}

/**
 * `PATCH /admin/users/:id/role` — `SA-05` (isu #88), PRD §5 Q6 & §10.3.
 *
 * > **Keputusan: satu mentor boleh membina banyak squad; penugasan oleh Superadmin.**
 *
 * ── Kenapa endpoint ini harus ada sama sekali ──
 *
 * Tanpa ia, peran hanya bisa diubah lewat SQL langsung — dan itu justru yang
 * dilarang `SA-2` ("semua aksi tulis lewat endpoint resmi, bukan SQL langsung").
 * Role `strive_readonly` yang dipakai Retool bahkan tidak bisa menulis apa pun,
 * jadi sebelum ini tidak ada jalur sah untuk menunjuk mentor pertama.
 *
 * ── Dua penolakan, dan kenapa keduanya perlu ──
 *
 * **1. Tidak bisa mengubah peran DIRI SENDIRI.** Acceptance criteria-nya
 * menulis "tidak bisa menurunkan", tapi yang dilarang di sini setiap perubahan
 * atas diri sendiri. Menaikkan diri sendiri mustahil (pemanggilnya sudah
 * superadmin — satu-satunya peran yang boleh masuk rute ini), jadi "perubahan
 * atas diri sendiri" dan "penurunan atas diri sendiri" adalah himpunan yang
 * sama. Yang lebih sempit hanya menambah cabang tanpa menambah izin apa pun.
 *
 * **2. Tidak boleh menyisakan NOL superadmin.** Ini tidak ada di acceptance
 * criteria dan tetap wajib: larangan (1) sendirian tidak cukup. Dua superadmin
 * A dan B yang saling menurunkan **pada saat yang sama** sama-sama lolos
 * pemeriksaan "bukan diriku", dan sistem kehilangan seluruh superadmin-nya —
 * secara permanen, karena satu-satunya cara menunjuk superadmin baru adalah
 * rute ini. Tidak ada pemulihan lewat aplikasi; hanya lewat SQL langsung yang
 * dilarang `SA-2`.
 *
 * ── Kenapa advisory lock, bukan `SELECT … FOR UPDATE` ──
 *
 * Yang dijaga invarian LINTAS BARIS: "jumlah superadmin >= 1". Mengunci baris
 * target saja tidak menjaganya — transaksi lain menurunkan superadmin yang
 * BERBEDA dan hitungannya berubah di bawah kaki kita.
 *
 * Mengunci seluruh baris superadmin (`FOR UPDATE`) menutup race-nya, tapi dua
 * transaksi bisa mengunci himpunan yang sama dalam urutan berbeda dan saling
 * menunggu — deadlock, yang muncul ke pengguna sebagai 500. Perubahan peran
 * terjadi beberapa kali seumur proyek; menserialkan semuanya lewat satu
 * advisory lock tidak berbiaya apa pun dan menghapus kedua masalah sekaligus.
 * Pola yang sama dengan `pricing-config.service.ts`.
 */
@Injectable()
export class UserRoleService {
  constructor(@Inject(DATABASE) private readonly db: Kysely<DB>) {}

  async changeRole(input: {
    targetUserId: string;
    role: unknown;
    actorId: string;
  }): Promise<ChangeRoleResult> {
    const { targetUserId, actorId } = input;

    if (!isUserRole(input.role)) {
      throw new BadRequestException({
        error: {
          code: 'VALIDATION_ERROR',
          message: `role harus salah satu dari: ${ROLES.join(', ')}`,
          details: { field: 'role', allowed: ROLES },
        },
      });
    }
    const role = input.role;

    // Diperiksa SEBELUM transaksi: penolakan ini tidak bergantung pada isi
    // database sama sekali, dan mengambil kunci global untuk menolaknya
    // menahan perubahan peran orang lain tanpa alasan.
    if (targetUserId === actorId) {
      throw new ForbiddenException({
        error: {
          code: 'ROLE_CHANGE_FORBIDDEN',
          message: 'Peran sendiri tidak bisa diubah lewat endpoint ini',
          details: { reason: 'self' },
        },
      });
    }

    return this.db.transaction().execute(async (trx) => {
      // Terikat transaksi: lepas otomatis saat commit/rollback.
      await sql`select pg_advisory_xact_lock(hashtext(${ROLE_LOCK_NAME})::bigint)`.execute(trx);

      const target = await trx
        .selectFrom('users')
        .select(['id', 'role'])
        .where('id', '=', targetUserId)
        .executeTakeFirst();

      if (!target) {
        throw new NotFoundException({
          error: {
            code: 'NOT_FOUND',
            message: 'Pengguna tidak ditemukan',
            details: { user_id: targetUserId },
          },
        });
      }

      const previousRole = target.role;

      // Peran yang sudah benar bukan kegagalan, dan bukan pula perubahan.
      // `audit_log` mencatat PERUBAHAN — baris "dari mentor ke mentor" hanya
      // menambah derau ke satu-satunya tempat yang dibaca saat ada yang aneh.
      if (previousRole === role) {
        return { userId: targetUserId, role, previousRole, changed: false };
      }

      // Dihitung SETELAH kunci dipegang dan hanya ketika relevan: yang bisa
      // mengurangi jumlah superadmin cuma penurunan superadmin.
      if (previousRole === 'superadmin') {
        const sisa = await trx
          .selectFrom('users')
          .select((eb) => eb.fn.countAll<string>().as('n'))
          .where('role', '=', 'superadmin')
          .where('id', '!=', targetUserId)
          .executeTakeFirstOrThrow();

        if (Number(sisa.n) === 0) {
          throw new ForbiddenException({
            error: {
              code: 'ROLE_CHANGE_FORBIDDEN',
              message:
                'Superadmin terakhir tidak bisa diturunkan — sistem akan kehilangan satu-satunya jalur penunjukan peran',
              details: { reason: 'last_superadmin' },
            },
          });
        }
      }

      await trx
        .updateTable('users')
        .set({ role, updated_at: new Date() })
        .where('id', '=', targetUserId)
        .execute();

      // DI DALAM transaksi yang sama, dengan pelakunya dan peran LAMA.
      // Dipisah, ada jendela di mana peran sudah berubah tapi belum ada yang
      // tahu siapa yang mengubahnya — persis jendela yang paling ingin dilihat.
      await trx
        .insertInto('audit_log')
        .values({
          actor_id: actorId,
          action: 'user.role.change',
          subject_type: 'user',
          subject_id: targetUserId,
          before: JSON.stringify({ role: previousRole }),
          after: JSON.stringify({ role }),
        })
        .execute();

      return { userId: targetUserId, role, previousRole, changed: true };
    });
  }
}
