import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase, type DB } from '../src/infra/kysely';
import { DISPLAY_NAME_MAX, ProfileService } from '../src/modules/users';

/**
 * `A-05` terhadap DATABASE NYATA — PRD §10.3.
 *
 * Dua hal yang diuji di sini lebih penting daripada "profilnya kembali":
 *
 * 1. **`PATCH /me` tidak bisa dipakai menaikkan peran atau saldo.** Keduanya
 *    kolom di tabel yang sama dengan `display_name`.
 * 2. **`users.timezone` dan `streaks.timezone` tidak boleh menyimpang.**
 *    Seluruh perhitungan hari lokal membaca yang KEDUA.
 */

const URL_DEV = 'postgres://strive:strive_dev_only@localhost:55432/strive';
const url = process.env['DATABASE_URL_TEST'] ?? process.env['DATABASE_URL'] ?? URL_DEV;

const AKU = '00000000-0000-4000-8000-0000000a0501';
const ORANG_LAIN = '00000000-0000-4000-8000-0000000a0502';

let db: Kysely<DB>;
let profil: ProfileService;
let reachable = false;

const baris = async (id: string) =>
  db
    .selectFrom('users')
    .select(['role', 'coin_balance', 'email', 'timezone', 'display_name', 'avatar_url', 'status'])
    .where('id', '=', id)
    .executeTakeFirstOrThrow();

const zonaStreak = async (id: string) =>
  await db
    .selectFrom('streaks')
    .select(['timezone', 'last_activity_date'])
    .where('user_id', '=', id)
    .executeTakeFirstOrThrow();

beforeAll(async () => {
  db = createDatabase(url);
  profil = new ProfileService(db);
  try {
    await db.selectFrom('users').select('id').limit(1).execute();
    reachable = true;
  } catch {
    reachable = false;
  }
});

afterAll(async () => {
  if (db) await db.destroy();
});

beforeEach(async () => {
  if (!reachable) return;
  await sql`TRUNCATE users RESTART IDENTITY CASCADE`.execute(db);
  await db
    .insertInto('users')
    .values([
      {
        id: AKU,
        email: 'a05-aku@uji.test',
        password_hash: 'x',
        display_name: 'Aku',
        timezone: 'Asia/Jakarta',
        coin_balance: 500,
      },
      {
        id: ORANG_LAIN,
        email: 'a05-lain@uji.test',
        password_hash: 'x',
        display_name: 'Orang Lain',
        role: 'mentor',
      },
    ])
    .execute();
  await db
    .insertInto('coin_ledger')
    .values({ user_id: AKU, entry_type: 'adjust', amount: 500, balance_after: 500 })
    .execute();
});

describe('A-05 — GET /me + PATCH /me (database nyata)', () => {
  it('database siap dipakai', () => {
    expect(reachable, `DATABASE_URL tidak bisa dipakai (${url})`).toBe(true);
  });

  it('AC: satu request memberi profil, peran, saldo, dan zona waktu', async () => {
    if (!reachable) return;
    const me = await profil.me(AKU);

    expect(me).toMatchObject({
      id: AKU,
      email: 'a05-aku@uji.test',
      display_name: 'Aku',
      role: 'student',
      timezone: 'Asia/Jakarta',
      coin_balance: 500,
      email_verified: false,
      status: 'active',
    });
    expect(me.created_at).toBeInstanceOf(Date);
  });

  it('tanggal verifikasi TIDAK dikirim — hanya sudah/belum', async () => {
    if (!reachable) return;
    await db
      .updateTable('users')
      .set({ email_verified_at: new Date() })
      .where('id', '=', AKU)
      .execute();

    const me = await profil.me(AKU);
    expect(me.email_verified).toBe(true);
    expect(me).not.toHaveProperty('email_verified_at');
    // Hash password tidak pernah ikut, bahkan ke pemiliknya sendiri.
    expect(me).not.toHaveProperty('password_hash');
  });

  // ── Daftar putih: ini bagian yang paling mahal kalau salah ─────────────

  it('AC: field lain DIABAIKAN, bukan error — termasuk role dan coin_balance', async () => {
    if (!reachable) return;
    const hasil = await profil.updateMe(AKU, {
      display_name: 'Nama Baru',
      // Semuanya kolom SUNGGUHAN di tabel `users`, jadi bukan sekadar field
      // asing yang toh akan ditolak database.
      role: 'superadmin',
      coin_balance: 999999,
      email: 'pembajak@jahat.test',
      status: 'deleted',
      password_hash: 'ditimpa',
      id: ORANG_LAIN,
    } as never);

    expect(hasil.display_name).toBe('Nama Baru');

    const b = await baris(AKU);
    expect(b.role, 'PATCH /me menaikkan peran').toBe('student');
    expect(b.coin_balance, 'PATCH /me mengubah saldo — aturan 2 & 3 dilanggar').toBe(500);
    expect(b.email).toBe('a05-aku@uji.test');
    expect(b.status).toBe('active');
    // `id` diabaikan berarti profil orang lain tidak tersentuh sama sekali.
    expect((await baris(ORANG_LAIN)).display_name).toBe('Orang Lain');
  });

  it('saldo tetap sama dengan ledger setelah PATCH (aturan 2)', async () => {
    if (!reachable) return;
    await profil.updateMe(AKU, { display_name: 'X', coin_balance: 1 } as never);

    const r = await sql<{ cache: number; ledger: string }>`
      SELECT u.coin_balance AS cache, COALESCE(SUM(l.amount), 0)::text AS ledger
      FROM users u LEFT JOIN coin_ledger l ON l.user_id = u.id
      WHERE u.id = ${AKU} GROUP BY u.coin_balance
    `.execute(db);
    expect(r.rows[0]!.cache).toBe(Number(r.rows[0]!.ledger));
  });

  // ── Zona waktu: AU-7, dan dua tabel yang wajib sepakat ─────────────────

  it('AC: zona waktu tidak dikenal DITOLAK, bukan jadi Asia/Jakarta', async () => {
    if (!reachable) return;
    await db
      .updateTable('users')
      .set({ timezone: 'Asia/Jayapura' })
      .where('id', '=', AKU)
      .execute();

    for (const busuk of ['Mars/Olympus', 'GMT+7', '', 'asia/jakartaa', 7, null]) {
      await expect(profil.updateMe(AKU, { timezone: busuk })).rejects.toMatchObject({
        response: { error: { code: 'VALIDATION_ERROR', details: { field: 'timezone' } } },
      });
    }
    // Yang lama TETAP — bukan diam-diam dipindah ke default.
    expect((await baris(AKU)).timezone).toBe('Asia/Jayapura');
  });

  it('zona waktu disimpan dalam bentuk KANONIK', async () => {
    if (!reachable) return;
    const hasil = await profil.updateMe(AKU, { timezone: 'asia/jayapura' });

    expect(hasil.timezone).toBe('Asia/Jayapura');
    expect((await baris(AKU)).timezone).toBe('Asia/Jayapura');
  });

  it('UTC diterima — daftar ICU tidak memuatnya, dan itu jebakan yang sudah tercatat', async () => {
    if (!reachable) return;
    const hasil = await profil.updateMe(AKU, { timezone: 'UTC' });
    expect(hasil.timezone).toBe('UTC');
  });

  it('`streaks.timezone` ikut berubah — dua tabel, satu fakta', async () => {
    if (!reachable) return;
    // Trigger AU-6 menyalinnya saat registrasi, lalu tidak ada lagi yang
    // menyinkronkan. Seluruh perhitungan hari lokal membaca yang INI.
    expect((await zonaStreak(AKU)).timezone).toBe('Asia/Jakarta');

    await profil.updateMe(AKU, { timezone: 'Pacific/Kiritimati' });

    expect((await baris(AKU)).timezone).toBe('Pacific/Kiritimati');
    expect(
      (await zonaStreak(AKU)).timezone,
      'streaks.timezone tertinggal — streak putus di jam zona lama',
    ).toBe('Pacific/Kiritimati');
  });

  it('perubahan zona waktu TIDAK retroaktif (PRD §5 Q8)', async () => {
    if (!reachable) return;
    await sql`
      UPDATE streaks SET last_activity_date = (now() AT TIME ZONE timezone)::date - 1,
                         current_streak = 5, longest_streak = 5
      WHERE user_id = ${AKU}
    `.execute(db);
    const sebelum = (await zonaStreak(AKU)).last_activity_date;

    await profil.updateMe(AKU, { timezone: 'Pacific/Honolulu' });

    expect(
      (await zonaStreak(AKU)).last_activity_date,
      'tanggal lama dihitung ulang — PRD bilang tidak retroaktif',
    ).toBe(sebelum);
  });

  // ── Sisanya ────────────────────────────────────────────────────────────

  it('display_name dipangkas, dan yang kosong atau kepanjangan ditolak', async () => {
    if (!reachable) return;
    const hasil = await profil.updateMe(AKU, { display_name: '  Budi  ' });
    expect(hasil.display_name).toBe('Budi');

    for (const busuk of ['', '   ', 'x'.repeat(DISPLAY_NAME_MAX + 1), 42, { a: 1 }]) {
      await expect(profil.updateMe(AKU, { display_name: busuk })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    }
    expect((await baris(AKU)).display_name).toBe('Budi');
  });

  it('avatar_url: `javascript:` dan `data:` ditolak, `null` mengosongkan', async () => {
    if (!reachable) return;
    // Kolomnya `text`. Tanpa pemeriksaan ini, nilainya tersimpan apa adanya
    // lalu dipasang klien di leaderboard — untuk SETIAP orang yang melihatnya.
    for (const jahat of [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'file:///etc/passwd',
      'bukan url sama sekali',
      12,
    ]) {
      await expect(profil.updateMe(AKU, { avatar_url: jahat })).rejects.toMatchObject({
        response: { error: { code: 'VALIDATION_ERROR', details: { field: 'avatar_url' } } },
      });
    }

    const ok = await profil.updateMe(AKU, { avatar_url: 'https://cdn.uji.test/a.png' });
    expect(ok.avatar_url).toBe('https://cdn.uji.test/a.png');

    const kosong = await profil.updateMe(AKU, { avatar_url: null });
    expect(kosong.avatar_url).toBeNull();
  });

  it('patch kosong bukan kegagalan — profilnya kembali apa adanya', async () => {
    if (!reachable) return;
    expect(await profil.updateMe(AKU, {})).toMatchObject({ display_name: 'Aku' });
    // Hanya field yang diabaikan: hasilnya sama.
    expect(await profil.updateMe(AKU, { role: 'superadmin' } as never)).toMatchObject({
      display_name: 'Aku',
      role: 'student',
    });
  });

  it('`undefined` eksplisit diperlakukan sama dengan tidak dikirim', async () => {
    if (!reachable) return;
    // `JSON.parse('{"timezone":null}')` memberi null (ditolak), tapi klien TS
    // yang menulis `{ timezone: undefined }` bermaksud "jangan diubah".
    const hasil = await profil.updateMe(AKU, { timezone: undefined, display_name: 'Tetap' });
    expect(hasil.timezone).toBe('Asia/Jakarta');
    expect(hasil.display_name).toBe('Tetap');
  });

  it('pengguna yang barisnya hilang di tengah sesi → NOT_FOUND, bukan 500', async () => {
    if (!reachable) return;
    const hantu = '00000000-0000-4000-8000-0000000a05ff';
    await expect(profil.me(hantu)).rejects.toBeInstanceOf(NotFoundException);
    await expect(profil.updateMe(hantu, { display_name: 'X' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
