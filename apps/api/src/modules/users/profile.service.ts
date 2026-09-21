import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Kysely } from 'kysely';

import { DATABASE, type DB } from '../../infra/kysely';
import { zonaWaktuKanonik } from '../auth';

/**
 * Panjang maksimum `display_name`. Kolomnya `text` tanpa CHECK, jadi batas ini
 * ada di satu tempat saja — dan tanpanya, satu PATCH bisa menyimpan megabyte
 * yang lalu dikirim ulang di setiap leaderboard.
 */
export const DISPLAY_NAME_MAX = 80;

export interface MyProfile {
  id: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
  role: 'student' | 'mentor' | 'superadmin';
  timezone: string;
  coin_balance: number;
  email_verified: boolean;
  status: string;
  created_at: Date;
}

export interface PatchProfileInput {
  display_name?: unknown;
  timezone?: unknown;
  avatar_url?: unknown;
}

/**
 * `GET /me` + `PATCH /me` — `A-05` (isu #88), PRD §10.3.
 *
 * ── Kenapa daftar putih, bukan daftar hitam ──
 *
 * Acceptance criteria-nya: *"field lain diabaikan, bukan error"*. Yang
 * diabaikan bukan cuma field tak dikenal — `role`, `coin_balance`, `email`,
 * dan `status` juga ada di tabel yang sama dan semuanya menarik untuk dikirim
 * dari klien.
 *
 * `role` adalah eskalasi hak akses langsung; `coin_balance` adalah uang
 * (CLAUDE.md aturan 2-3: hanya `CoinLedgerService` yang boleh menulisnya).
 * Daftar hitam melupakan kolom yang ditambahkan BESOK; daftar putih tidak
 * bisa — kolom baru otomatis tertolak sampai seseorang sengaja menambahkannya.
 *
 * ── `users.timezone` dan `streaks.timezone` adalah DUA SUMBER untuk SATU fakta ──
 *
 * Trigger `users_registration_rows` (migrasi 005) menyalin zona waktu ke
 * `streaks` saat registrasi, dan sejak itu **tidak ada yang menyinkronkannya
 * lagi**. Seluruh perhitungan streak, quest, dan kuota harian membaca
 * `streaks.timezone` — bukan `users.timezone`.
 *
 * Endpoint ini kode PERTAMA yang bisa membuat keduanya menyimpang. Kalau hanya
 * `users` yang ditulis, pengguna yang pindah zona melihat profilnya berubah
 * sementara streak-nya tetap putus di jam yang lama, dan tidak ada apa pun
 * yang terlihat salah. Karena itu keduanya ditulis dalam SATU transaksi.
 *
 * PRD §5 Q8: **"Perubahan zona waktu tidak retroaktif"** — `last_activity_date`
 * yang sudah tercatat sengaja tidak dihitung ulang.
 */
@Injectable()
export class ProfileService {
  constructor(@Inject(DATABASE) private readonly db: Kysely<DB>) {}

  async me(userId: string): Promise<MyProfile> {
    const row = await this.db
      .selectFrom('users')
      .select([
        'id',
        'email',
        'display_name',
        'avatar_url',
        'role',
        'timezone',
        'coin_balance',
        'email_verified_at',
        'status',
        'created_at',
      ])
      .where('id', '=', userId)
      .executeTakeFirst();

    if (!row) {
      // Sesi sah untuk pengguna yang tidak ada berarti barisnya terhapus di
      // tengah sesi. 404 yang jujur, bukan 500.
      throw new NotFoundException({
        error: { code: 'NOT_FOUND', message: 'Pengguna tidak ditemukan', details: {} },
      });
    }

    return serialize(row);
  }

  async updateMe(userId: string, patch: PatchProfileInput): Promise<MyProfile> {
    const set: {
      display_name?: string;
      timezone?: string;
      avatar_url?: string | null;
    } = {};

    if ('display_name' in patch && patch.display_name !== undefined) {
      set.display_name = bacaDisplayName(patch.display_name);
    }

    if ('timezone' in patch && patch.timezone !== undefined) {
      const kanonik = zonaWaktuKanonik(patch.timezone);
      if (kanonik === null) {
        // AU-7: **ditolak**, bukan diam-diam jatuh ke Asia/Jakarta. Fallback
        // hanya berlaku saat zona waktu TIDAK DIKIRIM (registrasi tanpa
        // field-nya). Pengguna yang mengirim zona salah pantas tahu; yang
        // diam-diam dipindahkan ke WIB akan melihat streak-nya putus di jam
        // yang tidak ia mengerti.
        throw new BadRequestException({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Zona waktu tidak dikenal',
            details: { field: 'timezone', value: String(patch.timezone) },
          },
        });
      }
      // Bentuk KANONIK yang disimpan, bukan yang dikirim: 'asia/jakarta' dan
      // 'Asia/Jakarta' harus berakhir sebagai satu nilai yang sama.
      set.timezone = kanonik;
    }

    if ('avatar_url' in patch && patch.avatar_url !== undefined) {
      set.avatar_url = bacaAvatarUrl(patch.avatar_url);
    }

    // Patch kosong bukan kegagalan. Klien yang mengirim `{}` — atau hanya
    // field yang diabaikan — mendapat profilnya apa adanya.
    if (Object.keys(set).length === 0) return this.me(userId);

    return this.db.transaction().execute(async (trx) => {
      const row = await trx
        .updateTable('users')
        .set({ ...set, updated_at: new Date() })
        .where('id', '=', userId)
        .returning([
          'id',
          'email',
          'display_name',
          'avatar_url',
          'role',
          'timezone',
          'coin_balance',
          'email_verified_at',
          'status',
          'created_at',
        ])
        .executeTakeFirst();

      if (!row) {
        throw new NotFoundException({
          error: { code: 'NOT_FOUND', message: 'Pengguna tidak ditemukan', details: {} },
        });
      }

      if (set.timezone !== undefined) {
        // Lihat catatan kelas: `streaks.timezone` yang dibaca seluruh
        // perhitungan hari lokal, bukan `users.timezone`.
        await trx
          .updateTable('streaks')
          .set({ timezone: set.timezone, updated_at: new Date() })
          .where('user_id', '=', userId)
          .execute();
      }

      return serialize(row);
    });
  }
}

function bacaDisplayName(nilai: unknown): string {
  if (typeof nilai !== 'string') {
    throw new BadRequestException({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'display_name harus berupa teks',
        details: { field: 'display_name' },
      },
    });
  }
  const bersih = nilai.trim();
  if (bersih.length === 0 || bersih.length > DISPLAY_NAME_MAX) {
    throw new BadRequestException({
      error: {
        code: 'VALIDATION_ERROR',
        message: `display_name harus 1–${DISPLAY_NAME_MAX} karakter`,
        details: { field: 'display_name', max: DISPLAY_NAME_MAX },
      },
    });
  }
  return bersih;
}

/**
 * `null` mengosongkan avatar. Selain itu **hanya `http`/`https`**.
 *
 * Kolomnya `text`, jadi tanpa pemeriksaan ini `javascript:alert(1)` tersimpan
 * apa adanya — lalu dipasang klien sebagai `href` avatar, dan setiap orang
 * yang melihat leaderboard mengeksekusinya. `data:` sama berbahayanya
 * (`data:text/html,…`). Yang menahannya harus di sisi tulis: klien yang
 * menyaringnya sendiri hanya menahan klien itu.
 */
function bacaAvatarUrl(nilai: unknown): string | null {
  if (nilai === null) return null;
  if (typeof nilai !== 'string') {
    throw new BadRequestException({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'avatar_url harus berupa URL atau null',
        details: { field: 'avatar_url' },
      },
    });
  }
  let parsed: URL;
  try {
    parsed = new URL(nilai);
  } catch {
    throw new BadRequestException({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'avatar_url bukan URL yang sah',
        details: { field: 'avatar_url' },
      },
    });
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new BadRequestException({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'avatar_url harus http atau https',
        details: { field: 'avatar_url', protocol: parsed.protocol },
      },
    });
  }
  return parsed.toString();
}

function serialize(row: {
  id: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
  role: string;
  timezone: string;
  coin_balance: number;
  email_verified_at: Date | null;
  status: string;
  created_at: Date;
}): MyProfile {
  return {
    id: row.id,
    email: row.email,
    display_name: row.display_name,
    avatar_url: row.avatar_url,
    role: row.role as MyProfile['role'],
    timezone: row.timezone,
    coin_balance: row.coin_balance,
    // Tanggalnya sendiri tidak dikirim: klien cuma butuh tahu sudah atau
    // belum, dan AU-8 memblokir top-up berdasarkan itu.
    email_verified: row.email_verified_at !== null,
    status: row.status,
    created_at: row.created_at,
  };
}
