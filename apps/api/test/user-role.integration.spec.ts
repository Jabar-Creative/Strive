import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { UserRoleService } from '../src/modules/admin';
import { createDatabase, type DB } from '../src/infra/kysely';

/**
 * `SA-05` terhadap DATABASE NYATA — PRD §5 Q6, §10.3.
 *
 * Endpoint ini satu-satunya jalur sah menunjuk mentor, dan itu yang membuat
 * kegagalannya mahal: kalau ia bisa menyisakan nol superadmin, tidak ada
 * jalan kembali lewat aplikasi sama sekali.
 */

const URL_DEV = 'postgres://strive:strive_dev_only@localhost:55432/strive';
const url = process.env['DATABASE_URL_TEST'] ?? process.env['DATABASE_URL'] ?? URL_DEV;

const SA1 = '00000000-0000-4000-8000-0000000a5001';
const SA2 = '00000000-0000-4000-8000-0000000a5002';
const SISWA = '00000000-0000-4000-8000-0000000a5003';

let db: Kysely<DB>;
let roles: UserRoleService;
let reachable = false;

const peran = async (id: string) =>
  (await db.selectFrom('users').select('role').where('id', '=', id).executeTakeFirstOrThrow()).role;

const jumlahSuperadmin = async () =>
  Number(
    (
      await db
        .selectFrom('users')
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .where('role', '=', 'superadmin')
        .executeTakeFirstOrThrow()
    ).n,
  );

const jejak = async () =>
  db
    .selectFrom('audit_log')
    .select(['actor_id', 'action', 'subject_type', 'subject_id', 'before', 'after'])
    .where('action', '=', 'user.role.change')
    .orderBy('id')
    .execute();

beforeAll(async () => {
  db = createDatabase(url);
  roles = new UserRoleService(db);
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
  await sql`TRUNCATE users, audit_log RESTART IDENTITY CASCADE`.execute(db);
  await db
    .insertInto('users')
    .values([
      {
        id: SA1,
        email: 'a5-1@uji.test',
        password_hash: 'x',
        display_name: 'SA1',
        role: 'superadmin',
      },
      {
        id: SA2,
        email: 'a5-2@uji.test',
        password_hash: 'x',
        display_name: 'SA2',
        role: 'superadmin',
      },
      { id: SISWA, email: 'a5-3@uji.test', password_hash: 'x', display_name: 'Siswa' },
    ])
    .execute();
});

describe('SA-05 — PATCH /admin/users/:id/role (database nyata)', () => {
  it('database siap dipakai', () => {
    expect(reachable, `DATABASE_URL tidak bisa dipakai (${url})`).toBe(true);
  });

  it('AC: menunjuk mentor, tercatat di audit_log dengan PELAKU dan peran LAMA', async () => {
    if (!reachable) return;
    const r = await roles.changeRole({ targetUserId: SISWA, role: 'mentor', actorId: SA1 });

    expect(r).toMatchObject({ role: 'mentor', previousRole: 'student', changed: true });
    expect(await peran(SISWA)).toBe('mentor');

    const [baris, ...sisa] = await jejak();
    expect(sisa, 'lebih dari satu baris audit untuk satu perubahan').toHaveLength(0);
    expect(baris).toMatchObject({
      actor_id: SA1, // dari guard, tidak pernah dari body
      subject_type: 'user',
      subject_id: SISWA,
    });
    // Peran LAMA yang membuat jejaknya berguna: "naik dari apa" adalah
    // pertanyaan pertama, dan menjawabnya butuh dua nilai.
    expect(baris?.before).toEqual({ role: 'student' });
    expect(baris?.after).toEqual({ role: 'mentor' });
  });

  it('AC: superadmin tidak bisa mengubah peran DIRI SENDIRI', async () => {
    if (!reachable) return;
    await expect(
      roles.changeRole({ targetUserId: SA1, role: 'student', actorId: SA1 }),
    ).rejects.toMatchObject({
      response: { error: { code: 'ROLE_CHANGE_FORBIDDEN', details: { reason: 'self' } } },
    });

    expect(await peran(SA1)).toBe('superadmin');
    expect(await jejak(), 'perubahan yang ditolak ikut tercatat').toHaveLength(0);
  });

  it('superadmin LAIN tetap bisa menurunkannya — larangan (1) soal diri, bukan soal peran', async () => {
    if (!reachable) return;
    const r = await roles.changeRole({ targetUserId: SA1, role: 'student', actorId: SA2 });

    expect(r).toMatchObject({ previousRole: 'superadmin', role: 'student', changed: true });
    expect(await jumlahSuperadmin()).toBe(1);
  });

  // ── Invarian yang tidak ada di acceptance criteria, dan tetap wajib ─────

  it('superadmin TERAKHIR tidak bisa diturunkan', async () => {
    if (!reachable) return;
    await roles.changeRole({ targetUserId: SA1, role: 'student', actorId: SA2 });
    expect(await jumlahSuperadmin()).toBe(1);

    // SA2 satu-satunya yang tersisa. Ia tidak bisa menurunkan dirinya (larangan
    // 'self'), jadi yang mencobanya harus pihak lain — dan setelah diturunkan,
    // SISWA yang kini mentor pun tidak bisa memulihkannya: rute ini superadmin
    // saja. Nol superadmin = tidak ada jalan kembali lewat aplikasi.
    await expect(
      roles.changeRole({ targetUserId: SA2, role: 'mentor', actorId: SA1 }),
    ).rejects.toMatchObject({
      response: {
        error: { code: 'ROLE_CHANGE_FORBIDDEN', details: { reason: 'last_superadmin' } },
      },
    });

    expect(await jumlahSuperadmin()).toBe(1);
  });

  it('dua superadmin saling menurunkan BERSAMAAN — satu tetap berdiri', async () => {
    if (!reachable) return;
    // Inilah yang tidak bisa dijaga larangan 'self' sendirian: keduanya benar
    // saat memeriksa "bukan diriku", dan tanpa serialisasi keduanya juga benar
    // saat menghitung "masih ada satu lagi" — karena yang satu lagi itu justru
    // sedang diturunkan oleh transaksi sebelah.
    let buka!: () => void;
    const gerbang = new Promise<void>((r) => {
      buka = r;
    });
    const penahan = db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(hashtext('users:role-change')::bigint)`.execute(trx);
      await gerbang;
    });
    await new Promise((r) => setTimeout(r, 200));

    const p1 = roles.changeRole({ targetUserId: SA2, role: 'student', actorId: SA1 });
    const p2 = roles.changeRole({ targetUserId: SA1, role: 'student', actorId: SA2 });
    await new Promise((r) => setTimeout(r, 300)); // keduanya menumpuk di kunci

    expect(await jumlahSuperadmin(), 'perubahan menembus kunci advisory').toBe(2);

    buka();
    await penahan;
    const hasil = await Promise.allSettled([p1, p2]);

    // ── Diverifikasi MERAH dengan advisory lock-nya dicabut dari service ──
    //
    // Yang gagal saat dicabut justru assert DI ATAS, dan itu menunjukkan
    // seberapa terbuka lubangnya: kedua transaksi sudah selesai sebelum
    // gerbang dibuka sama sekali, dan hitungan superadmin sudah **nol** di
    // tengah jendela. Bukan satu lolos — DUA, tanpa galat apa pun, dan tanpa
    // jalan kembali lewat aplikasi.
    expect(await jumlahSuperadmin(), 'nol superadmin tersisa').toBe(1);
    expect(hasil.filter((h) => h.status === 'fulfilled')).toHaveLength(1);

    const ditolak = hasil.find((h) => h.status === 'rejected');
    expect((ditolak as PromiseRejectedResult).reason).toMatchObject({
      response: {
        error: { code: 'ROLE_CHANGE_FORBIDDEN', details: { reason: 'last_superadmin' } },
      },
    });
    expect(await jejak(), 'perubahan yang ditolak ikut tercatat').toHaveLength(1);
  });

  // ── Penolakan yang tidak menulis apa pun ───────────────────────────────

  it('peran karangan ditolak, tidak ada yang tersentuh', async () => {
    if (!reachable) return;
    await expect(
      roles.changeRole({ targetUserId: SISWA, role: 'admin', actorId: SA1 }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(await peran(SISWA)).toBe('student');
    expect(await jejak()).toHaveLength(0);
  });

  it('role yang bukan string sama sekali ditolak sebagai VALIDATION_ERROR', async () => {
    if (!reachable) return;
    // Body datang dari klien: `{ role: { toString: … } }` dan `{ role: null }`
    // sama mungkinnya dengan string. Yang menolaknya harus bentuknya, bukan
    // kebetulan bahwa enum Postgres nanti akan melempar 500.
    for (const busuk of [null, 42, { role: 'mentor' }, ['mentor']]) {
      await expect(
        roles.changeRole({ targetUserId: SISWA, role: busuk, actorId: SA1 }),
      ).rejects.toMatchObject({ response: { error: { code: 'VALIDATION_ERROR' } } });
    }
    expect(await peran(SISWA)).toBe('student');
  });

  it('pengguna yang tidak ada → NOT_FOUND', async () => {
    if (!reachable) return;
    await expect(
      roles.changeRole({
        targetUserId: '00000000-0000-4000-8000-0000000a50ff',
        role: 'mentor',
        actorId: SA1,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(await jejak()).toHaveLength(0);
  });

  it('peran yang sudah benar: bukan galat, dan bukan pula baris audit', async () => {
    if (!reachable) return;
    const r = await roles.changeRole({ targetUserId: SISWA, role: 'student', actorId: SA1 });

    expect(r).toMatchObject({ role: 'student', previousRole: 'student', changed: false });
    // `audit_log` mencatat PERUBAHAN. Baris "dari student ke student" hanya
    // menambah derau ke satu-satunya tempat yang dibaca saat ada yang aneh.
    expect(await jejak()).toHaveLength(0);
  });

  it('`self` diperiksa sebelum apa pun — termasuk untuk pengguna yang tidak ada', async () => {
    if (!reachable) return;
    // Urutan pemeriksaan ikut jadi kontrak: kalau NOT_FOUND didahulukan,
    // endpoint ini membocorkan ada-tidaknya sebuah id ke siapa pun yang boleh
    // memanggilnya. Di sini pemanggilnya superadmin, jadi taruhannya kecil —
    // tapi urutan yang benar tidak lebih mahal.
    await expect(
      roles.changeRole({ targetUserId: SA1, role: 'mentor', actorId: SA1 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
