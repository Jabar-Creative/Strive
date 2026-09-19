import { Kysely, sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { createDatabase, type DB } from '../src/infra/kysely';
import { KyselyModule } from '../src/infra/kysely';
import { AuthModule } from '../src/modules/auth';
import { ResendMailerService } from '../src/modules/notification';

/**
 * Test integrasi mounting HTTP Better-Auth (A-03) terhadap database nyata.
 *
 * A-01 membangun instance Better-Auth dan membuktikannya lewat panggilan
 * `auth.api.*` langsung — sah untuk batas yang ia uji, tapi pengguna tidak
 * memanggil `auth.api`, pengguna memanggil HTTP. Berkas ini membuktikan
 * jembatan itu: prefiks /api/v1, cookie sesi, pemeriksaan origin, dan efek
 * samping database tetap menyala lewat jalur yang benar-benar dipakai web.
 *
 * PENTING: env di-set sebelum aplikasi dibangun di beforeAll, karena provider
 * AUTH membacanya saat factory dijalankan.
 */

const URL_DEV = 'postgres://strive:strive_dev_only@localhost:55432/strive';
const url = process.env['DATABASE_URL_TEST'] ?? process.env['DATABASE_URL'] ?? URL_DEV;

const WEB = 'http://localhost:3000';

let db: Kysely<DB>;
let app: INestApplication;
let base: string;
let reachable = false;

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SANDI = 'kataSandiPanjang123';

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

/** Cookie sesi dari sebuah respons, siap dikirim balik sebagai header Cookie. */
function cookieDari(res: Response): string {
  const mentah = res.headers.getSetCookie().map((c) => c.split(';')[0]!);
  expect(mentah.length, 'respons wajib membawa Set-Cookie sesi').toBeGreaterThan(0);
  return mentah.join('; ');
}

beforeAll(async () => {
  db = createDatabase(url);
  try {
    await db.selectFrom('users').select('id').limit(1).execute();
    reachable = true;
  } catch {
    reachable = false;
    return;
  }

  process.env['DATABASE_URL'] = url;
  process.env['AUTH_SECRET'] = 'rahasia-uji-yang-cukup-panjang-0123456789';
  process.env['APP_URL'] = WEB;

  const moduleRef = await Test.createTestingModule({
    imports: [KyselyModule, AuthModule],
  })
    // Sejak isu #65, `sendOnSignUp` menyala: SETIAP sign-up di berkas ini
    // memicu pengiriman email. Tanpa pengganti ini tiap test menembak jaringan
    // Resend sungguhan dengan kunci placeholder — lambat, dan lulus-gagalnya
    // jadi bergantung koneksi internet.
    .overrideProvider(ResendMailerService)
    .useValue({ send: async () => undefined })
    .compile();
  app = moduleRef.createNestApplication();
  // SAMA seperti main.ts: prefiks global + CORS credentials untuk web.
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });
  app.enableCors({ origin: WEB, credentials: true });
  const server = await app.listen(0);
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('tidak mendapat port listen');
  base = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  if (app) await app.close();
  if (db) await db.destroy();
});

beforeEach(async () => {
  if (!reachable) return;
  await sql`TRUNCATE users RESTART IDENTITY CASCADE`.execute(db);
});

describe('Auth HTTP (database nyata)', () => {
  it('database siap dipakai', () => {
    expect(
      reachable,
      `DATABASE_URL tidak bisa dipakai (${url}). Jalankan: docker compose up -d && pnpm db:migrate`,
    ).toBe(true);
  });

  it('POST /api/v1/auth/sign-up/email: 200, Set-Cookie sesi, AU-6 tetap menyala lewat HTTP', async () => {
    if (!reachable) return;

    const res = await post(
      '/api/v1/auth/sign-up/email',
      { email: 'http1@uji.test', password: SANDI, name: 'Uji HTTP' },
      { origin: WEB },
    );
    expect(res.status).toBe(200);

    const body = (await res.json()) as { user: { id: string; email: string } };
    expect(body.user.id).toMatch(uuid);
    expect(body.user.email).toBe('http1@uji.test');
    expect(res.headers.getSetCookie().length).toBeGreaterThan(0);

    // Efek samping yang dulu hanya dibuktikan lewat auth.api kini lewat HTTP.
    const streak = await db
      .selectFrom('streaks')
      .select('timezone')
      .where('user_id', '=', body.user.id)
      .executeTakeFirstOrThrow();
    // Q8 + AU-7: tanpa zona waktu dari klien, default Asia/Jakarta.
    expect(streak.timezone).toBe('Asia/Jakarta');

    const bobot = await db
      .selectFrom('reviewer_weights')
      .select('user_id')
      .where('user_id', '=', body.user.id)
      .executeTakeFirstOrThrow();
    expect(bobot.user_id).toBe(body.user.id);
  });

  it('AU-2 lewat HTTP: password 9 karakter ditolak 4xx', async () => {
    if (!reachable) return;
    const res = await post(
      '/api/v1/auth/sign-up/email',
      { email: 'http2@uji.test', password: 'sembilan1', name: 'Uji' },
      { origin: WEB },
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it('sign-in salah ditolak, yang benar mengembalikan cookie sesi', async () => {
    if (!reachable) return;
    await post(
      '/api/v1/auth/sign-up/email',
      { email: 'http3@uji.test', password: SANDI, name: 'Uji' },
      { origin: WEB },
    );

    const salah = await post(
      '/api/v1/auth/sign-in/email',
      { email: 'http3@uji.test', password: 'sandiYangSalah123' },
      { origin: WEB },
    );
    expect(salah.status).toBeGreaterThanOrEqual(400);
    expect(salah.status).toBeLessThan(500);

    const benar = await post(
      '/api/v1/auth/sign-in/email',
      { email: 'http3@uji.test', password: SANDI },
      { origin: WEB },
    );
    expect(benar.status).toBe(200);
    cookieDari(benar);
  });

  it('AC A-03 inti: get-session dengan cookie mengenal pengguna, tanpa cookie null', async () => {
    if (!reachable) return;
    await post(
      '/api/v1/auth/sign-up/email',
      { email: 'http3@uji.test', password: SANDI, name: 'Uji' },
      { origin: WEB },
    );
    const sesiRes = await post(
      '/api/v1/auth/sign-in/email',
      { email: 'http3@uji.test', password: SANDI },
      { origin: WEB },
    );
    expect(sesiRes.status).toBe(200);
    const cookie = cookieDari(sesiRes);

    const dengan = await fetch(`${base}/api/v1/auth/get-session`, {
      headers: { cookie },
    });
    expect(dengan.status).toBe(200);
    const isi = (await dengan.json()) as { user?: { email: string } } | null;
    expect(isi?.user?.email).toBe('http3@uji.test');

    const tanpa = await fetch(`${base}/api/v1/auth/get-session`);
    expect(tanpa.status).toBe(200);
    expect(await tanpa.json()).toBeNull();
  });

  it('origin web dipercaya untuk POST bersendi cookie; origin asing ditolak 403', async () => {
    if (!reachable) return;
    const daftar = await post(
      '/api/v1/auth/sign-up/email',
      { email: 'http4@uji.test', password: SANDI, name: 'Uji' },
      { origin: WEB },
    );
    const cookie = cookieDari(daftar);

    // Uji penolakan DULU: sign-out yang sah di bawah akan menghancurkan sesinya.
    const asing = await post(
      '/api/v1/auth/sign-out',
      {},
      {
        origin: 'http://jahat.example',
        cookie,
      },
    );
    expect(asing.status).toBe(403);

    const sah = await post('/api/v1/auth/sign-out', {}, { origin: WEB, cookie });
    expect(sah.status).toBeLessThan(400);
  });

  it('request-password-reset TIDAK LAGI RESET_PASSWORD_DISABLED — callback terpasang (isu #65)', async () => {
    if (!reachable) return;
    // Test ini dulu MEMATOK keadaan rusak: 400 RESET_PASSWORD_DISABLED, dengan
    // catatan "sampai callback email terpasang". Callback-nya sekarang
    // terpasang (isu #65 poin 1), jadi tripwire-nya menyala — persis fungsinya.
    // Bukti perilaku barunya yang lengkap ada di
    // `auth-email-timezone.integration.spec.ts`.
    const res = await post(
      '/api/v1/auth/request-password-reset',
      { email: 'http6@uji.test', redirectTo: `${WEB}/reset/finish` },
      { origin: WEB },
    );
    expect(res.status).toBe(200);
  });
});
