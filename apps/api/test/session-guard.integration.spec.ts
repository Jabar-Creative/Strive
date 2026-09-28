import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase, type DB } from '../src/infra/kysely';
import { RolesGuard, SessionGuard } from '../src/common/guards';
import { createAuth, type StriveAuth } from '../src/modules/auth';

/**
 * `SessionGuard` terhadap DATABASE NYATA.
 *
 * Yang diuji di sini tidak bisa dibuktikan unit test: sesi yang benar-benar
 * dibuat Better-Auth, kedaluwarsa yang dibandingkan Postgres, dan peran yang
 * dibaca dari baris `users` — bukan dari objek yang kita karang sendiri.
 *
 * Matriks aksesnya sendiri diuji terpisah di
 * `src/common/guards/access-matrix.spec.ts` (91 kasus, unit).
 */

const URL_DEV = 'postgres://strive:strive_dev_only@localhost:55432/strive';
const url = process.env['DATABASE_URL_TEST'] ?? process.env['DATABASE_URL'] ?? URL_DEV;

let db: Kysely<DB>;
let auth: StriveAuth;
let guard: SessionGuard;
let reachable = false;

const EMAIL = 'guard@uji.test';
const SANDI = 'kataSandiPanjang123';

function ctx(header?: string, tambahan?: Record<string, string>): ExecutionContext {
  const request: { headers: Record<string, string | undefined>; user?: unknown } = {
    headers: { ...(header ? { authorization: header } : {}), ...(tambahan ?? {}) },
  };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
}

const reqDari = (c: ExecutionContext) =>
  c.switchToHttp().getRequest<{ user?: { id: string; role: string } }>();

beforeAll(async () => {
  db = createDatabase(url);
  auth = createAuth({ connectionString: url, secret: 'rahasia-uji-yang-cukup-panjang-0123456789' });
  guard = new SessionGuard(db);
  try {
    await db.selectFrom('sessions').select('id').limit(1).execute();
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

async function sesiBaru() {
  const hasil = await auth.api.signUpEmail({
    body: { email: EMAIL, password: SANDI, name: 'Uji' },
  });
  const row = await db
    .selectFrom('sessions')
    .select('token')
    .where('user_id', '=', hasil.user.id)
    .executeTakeFirstOrThrow();
  return { userId: hasil.user.id, token: row.token };
}

describe('SessionGuard (database nyata)', () => {
  it('database siap dipakai', () => {
    expect(reachable, `DATABASE_URL tidak bisa dipakai (${url})`).toBe(true);
  });

  it('token sesi yang sah mengisi request.user dengan id dan peran dari database', async () => {
    if (!reachable) return;
    const { userId, token } = await sesiBaru();

    const c = ctx(`Bearer ${token}`);
    expect(await guard.canActivate(c)).toBe(true);
    // Perannya dibaca dari baris `users`, bukan dari apa pun yang dikirim
    // klien. Peran yang berasal dari token adalah peran yang bisa dipalsukan.
    expect(reqDari(c).user).toEqual({ id: userId, role: 'student' });
  });

  it('tanpa header Authorization → UNAUTHENTICATED', async () => {
    if (!reachable) return;
    await expect(guard.canActivate(ctx())).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('token yang tidak ada di tabel sessions → UNAUTHENTICATED', async () => {
    if (!reachable) return;
    await sesiBaru();
    await expect(guard.canActivate(ctx('Bearer token-karangan'))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('token KEDALUWARSA ditolak — dibandingkan Postgres, bukan jam Node', async () => {
    if (!reachable) return;
    const { token } = await sesiBaru();

    await db
      .updateTable('sessions')
      .set({ expires_at: sql`now() - interval '1 second'` })
      .where('token', '=', token)
      .execute();

    await expect(guard.canActivate(ctx(`Bearer ${token}`))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('pengguna yang ditangguhkan ditolak meski sesinya masih berlaku', async () => {
    if (!reachable) return;
    const { userId, token } = await sesiBaru();
    await db.updateTable('users').set({ status: 'suspended' }).where('id', '=', userId).execute();

    // Menangguhkan akun harus langsung menutup pintu. Kalau hanya sesinya yang
    // diperiksa, pengguna yang ditangguhkan tetap masuk sampai token
    // kedaluwarsa — sampai 30 hari.
    await expect(guard.canActivate(ctx(`Bearer ${token}`))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('peran dari database yang menentukan, bukan yang diminta klien', async () => {
    if (!reachable) return;
    const { userId, token } = await sesiBaru();
    await db.updateTable('users').set({ role: 'superadmin' }).where('id', '=', userId).execute();

    const c = ctx(`Bearer ${token}`);
    await guard.canActivate(c);
    expect(reqDari(c).user?.role).toBe('superadmin');

    // Dan superadmin tetap DITOLAK di rute student — dua guard, dua pertanyaan
    // berbeda. SessionGuard bilang "ini siapa", RolesGuard bilang "boleh tidak".
    const roles = new RolesGuard({
      getAllAndOverride: () => ['student', 'mentor'],
    } as never);
    expect(() => roles.canActivate(c)).toThrow(ForbiddenException);
  });

  // ── Keputusan #154 opsi (b): cookie sesi ikut diterima ────────────────────

  it('COOKIE sesi yang sah diterima, sama seperti Bearer', async () => {
    if (!reachable) return;
    const { userId, token } = await sesiBaru();

    // Bentuk cookie Better-Auth yang sungguhan: `<token>.<tanda-tangan>`.
    const c = ctx(undefined, {
      cookie: `__Secure-better-auth.session_token=${token}.tandaTanganApaPun%3D%3D`,
      origin: 'http://localhost:3000',
    });
    expect(await guard.canActivate(c)).toBe(true);
    expect(reqDari(c).user).toEqual({ id: userId, role: 'student' });
  });

  it('cookie dari asal ASING DIABAIKAN — inilah harga opsi (b) yang dibayar', async () => {
    if (!reachable) return;
    const { token } = await sesiBaru();

    // Sesi SAH, cookie SAH, tapi request dipicu situs lain. Diperlakukan
    // anonim: itu yang membuat cookie tidak bisa dipakai lintas situs.
    const c = ctx(undefined, {
      cookie: `__Secure-better-auth.session_token=${token}.sig`,
      origin: 'https://jahat.example',
    });
    await expect(guard.canActivate(c)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('BEARER dari asal asing TETAP jalan — header tidak terpasang sendiri', async () => {
    if (!reachable) return;
    const { token } = await sesiBaru();
    const c = ctx(`Bearer ${token}`, { origin: 'https://jahat.example' });
    expect(await guard.canActivate(c)).toBe(true);
  });

  it('cookie yang tokennya tidak ada di `sessions` tetap ditolak', async () => {
    if (!reachable) return;
    await expect(
      guard.canActivate(
        ctx(undefined, { cookie: '__Secure-better-auth.session_token=karangan.sig' }),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
