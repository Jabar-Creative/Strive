import { Kysely, sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase, type DB } from '../src/infra/kysely';
import { AuthService, createAuth, type StriveAuth } from '../src/modules/auth';

/**
 * Test integrasi auth terhadap DATABASE NYATA.
 *
 * Empat dari yang diuji di sini hidup di luar TypeScript dan tidak bisa
 * dibuktikan dengan mock: bentuk hash yang benar-benar tersimpan, trigger AU-6,
 * pencabutan sesi, dan bahwa `users.password_hash` TIDAK pernah tersentuh.
 *
 * Yang paling penting di berkas ini bukan "apakah login jalan" — itu tanggung
 * jawab Better-Auth. Yang diuji adalah **batas antara Better-Auth dan skema
 * kita**, tempat keputusan isu #18 bisa bocor tanpa suara.
 */

const URL_DEV = 'postgres://strive:strive_dev_only@localhost:55432/strive';
const url = process.env['DATABASE_URL_TEST'] ?? process.env['DATABASE_URL'] ?? URL_DEV;

let db: Kysely<DB>;
let auth: StriveAuth;
let svc: AuthService;
let reachable = false;

const EMAIL = 'au1@uji.test';
const SANDI = 'kataSandiPanjang123';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function daftar(email = EMAIL, nama = 'Uji Auth') {
  return auth.api.signUpEmail({ body: { email, password: SANDI, name: nama } });
}

beforeAll(async () => {
  db = createDatabase(url);
  auth = createAuth({ connectionString: url, secret: 'rahasia-uji-yang-cukup-panjang-0123456789' });
  svc = new AuthService(db);
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
});

describe('Auth (database nyata)', () => {
  it('database siap dipakai', () => {
    expect(
      reachable,
      `DATABASE_URL tidak bisa dipakai (${url}). Jalankan: docker compose up -d && pnpm db:migrate`,
    ).toBe(true);
  });

  // ── AC-AU-1 ───────────────────────────────────────────────────────────────
  it('AC-AU-1: registrasi membuat akun + streaks + reviewer_weights + sesi', async () => {
    if (!reachable) return;
    const hasil = await daftar();

    expect(hasil.user.id).toMatch(uuid);
    expect(hasil.token).toBeTruthy();

    const u = await db
      .selectFrom('users')
      .selectAll()
      .where('email', '=', EMAIL)
      .executeTakeFirstOrThrow();

    // AU-6 — dan ini dijamin trigger, bukan kode aplikasi: Better-Auth punya
    // transaksinya sendiri dan tidak tahu apa-apa soal kedua tabel ini.
    const streak = await db
      .selectFrom('streaks')
      .selectAll()
      .where('user_id', '=', u.id)
      .executeTakeFirst();
    const bobot = await db
      .selectFrom('reviewer_weights')
      .selectAll()
      .where('user_id', '=', u.id)
      .executeTakeFirst();

    expect(streak, 'AU-6: baris streaks wajib ada setelah registrasi').toBeDefined();
    expect(bobot, 'AU-6: baris reviewer_weights wajib ada setelah registrasi').toBeDefined();
    expect(streak?.timezone).toBe(u.timezone);
  });

  it('id yang ditulis Better-Auth adalah UUID, bukan id bawaannya', async () => {
    if (!reachable) return;
    const hasil = await daftar();

    // `advanced.database.generateId` bawaan menghasilkan string base62 32
    // karakter yang TIDAK muat di kolom uuid. Nilai `false` — yang paling
    // terasa alami untuk "biar database yang bikin" — malah jatuh kembali ke
    // generator bawaan karena pemanggilnya menulis `generateId(...) ||
    // generateId()`. Yang benar hanya 'uuid'.
    expect(hasil.user.id).toMatch(uuid);

    const sesi = await db
      .selectFrom('sessions')
      .select('id')
      .where('user_id', '=', hasil.user.id)
      .executeTakeFirstOrThrow();
    expect(sesi.id).toMatch(uuid);
  });

  // ── AU-3 ──────────────────────────────────────────────────────────────────
  it('AU-3: password di-hash Argon2id, dan HANYA ada di auth_accounts', async () => {
    if (!reachable) return;
    await daftar();

    const u = await db
      .selectFrom('users')
      .selectAll()
      .where('email', '=', EMAIL)
      .executeTakeFirstOrThrow();

    // Versi lama test ini memastikan `users.password_hash` tetap NULL. Sejak
    // migrasi 007 kolomnya TIDAK ADA lagi, dan bentuk assert yang benar ikut
    // berubah: yang dijaga sekarang bukan "kolom itu kosong" tapi "tidak ada
    // tempat KEDUA yang mengklaim menyimpan password". Dua tempat selalu
    // berakhir dengan satu yang basi.
    expect(
      Object.keys(u).filter((k) => /password|secret|hash/i.test(k)),
      'ada kolom mirip-password di `users` — password hanya boleh di auth_accounts',
    ).toEqual([]);

    const akun = await db
      .selectFrom('auth_accounts')
      .selectAll()
      .where('user_id', '=', u.id)
      .executeTakeFirstOrThrow();

    expect(akun.provider_id).toBe('credential');
    // Bawaan Better-Auth adalah scrypt, bukan Argon2id. AU-3 mewajibkan
    // Argon2id, jadi hash/verify-nya ditimpa — dan bentuk hash inilah
    // buktinya, bukan konfigurasinya.
    expect(akun.password ?? '').toMatch(/^\$argon2id\$/);
  });

  it('AU-3: password yang benar diterima, yang salah ditolak', async () => {
    if (!reachable) return;
    await daftar();

    const masuk = await auth.api.signInEmail({ body: { email: EMAIL, password: SANDI } });
    expect(masuk.user.email).toBe(EMAIL);

    await expect(
      auth.api.signInEmail({ body: { email: EMAIL, password: 'sandiYangSalah123' } }),
    ).rejects.toBeTruthy();
  });

  // ── AU-8 ──────────────────────────────────────────────────────────────────
  it('AU-8: pengguna baru belum terverifikasi — email_verified false', async () => {
    if (!reachable) return;
    await daftar();
    const u = await db
      .selectFrom('users')
      .select('email_verified')
      .where('email', '=', EMAIL)
      .executeTakeFirstOrThrow();
    expect(u.email_verified).toBe(false);
  });

  // ── Pengganti AU-5 ────────────────────────────────────────────────────────
  it('pengganti AU-5 (1): setiap sesi tercatat di audit_log dengan ip & user-agent', async () => {
    if (!reachable) return;
    const hasil = await daftar();

    await svc.recordSession(hasil.user.id, {
      sessionId: (
        await db
          .selectFrom('sessions')
          .select('id')
          .where('user_id', '=', hasil.user.id)
          .executeTakeFirstOrThrow()
      ).id,
      ip: '203.0.113.7',
      userAgent: 'Uji/1.0',
    });

    const baris = await db
      .selectFrom('audit_log')
      .selectAll()
      .where('action', '=', 'auth.session_created')
      .where('subject_id', '=', hasil.user.id)
      .executeTakeFirst();

    // AU-5 dibuang (isu #18), jadi sesi ganda dari lokasi berbeda tidak lagi
    // terdeteksi otomatis. Catatan ini yang membuatnya masih bisa DILIHAT
    // manusia — pengurangan dampak, bukan pengganti deteksinya.
    expect(baris, 'sesi wajib tercatat — ini sisa satu-satunya dari AU-5').toBeDefined();
    // `jsonb` sudah di-parse driver pg — JSON.parse di atasnya akan meledak
    // dengan "[object Object]" is not valid JSON.
    const after = (baris?.after ?? {}) as { ip?: string; user_agent?: string };
    expect(after.ip).toBe('203.0.113.7');
    expect(after.user_agent).toBe('Uji/1.0');
  });

  it('pengganti AU-5 (2): ganti password mencabut SELURUH sesi pengguna itu', async () => {
    if (!reachable) return;
    const hasil = await daftar();

    // Tiga sesi dari tiga perangkat.
    await auth.api.signInEmail({ body: { email: EMAIL, password: SANDI } });
    await auth.api.signInEmail({ body: { email: EMAIL, password: SANDI } });

    const sebelum = await db
      .selectFrom('sessions')
      .select('id')
      .where('user_id', '=', hasil.user.id)
      .execute();
    expect(sebelum.length).toBeGreaterThanOrEqual(3);

    const dicabut = await svc.revokeAllSessions(hasil.user.id, 'password_changed');
    expect(dicabut).toBe(sebelum.length);

    const sesudah = await db
      .selectFrom('sessions')
      .select('id')
      .where('user_id', '=', hasil.user.id)
      .execute();
    expect(sesudah).toHaveLength(0);

    const audit = await db
      .selectFrom('audit_log')
      .selectAll()
      .where('action', '=', 'auth.sessions_revoked')
      .where('subject_id', '=', hasil.user.id)
      .executeTakeFirst();
    expect(audit, 'pencabutan wajib meninggalkan jejak').toBeDefined();
  });

  it('pengganti AU-5 (3): satu sesi bisa dicabut sendiri, sisanya tidak ikut', async () => {
    if (!reachable) return;
    const hasil = await daftar();
    await auth.api.signInEmail({ body: { email: EMAIL, password: SANDI } });

    const semua = await db
      .selectFrom('sessions')
      .select('id')
      .where('user_id', '=', hasil.user.id)
      .execute();
    expect(semua.length).toBeGreaterThanOrEqual(2);

    const dicabut = await svc.revokeSession(semua[0]!.id, 'dicabut_superadmin');
    expect(dicabut).toBe(true);

    const sisa = await db
      .selectFrom('sessions')
      .select('id')
      .where('user_id', '=', hasil.user.id)
      .execute();
    expect(sisa).toHaveLength(semua.length - 1);
  });

  it('mencabut sesi yang tidak ada mengembalikan false, bukan melempar', async () => {
    if (!reachable) return;
    // Reaper dan panel admin memanggil ini untuk banyak id sekaligus, dan
    // sebagian mungkin sudah kedaluwarsa duluan.
    expect(await svc.revokeSession('00000000-0000-4000-8000-00000000dead', 'uji')).toBe(false);
  });
});
