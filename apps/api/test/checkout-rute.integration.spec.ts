import { Kysely, sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { createDatabase, type DB } from '../src/infra/kysely';
import { KyselyModule } from '../src/infra/kysely';
import { PaymentModule } from '../src/modules/payment';

/**
 * `POST /api/v1/payments/checkout` lewat HTTP — isu #233.
 *
 * **Kenapa berkas ini ada padahal `checkout.integration.spec.ts` sudah
 * menguji seluruh perilakunya.** Berkas itu memanggil SERVICE langsung, dan
 * karena itu ia hijau penuh selama berminggu-minggu sementara rutenya
 * menjawab **404**. `ACCESS_MATRIX` pun mendaftarkan rutenya, jadi 91 test
 * matriks akses ikut hijau untuk rute yang tidak ada. Tidak ada satu pun
 * gerbang di repo ini yang bisa membedakan "service benar" dari "service
 * benar dan terpasang" — yang membedakannya Dev B yang mencoba memakainya.
 *
 * Jadi yang diuji di sini bukan logika checkout, melainkan **keberadaan dan
 * gerbang rutenya**: 404-nya hilang, header ⚡ ditegakkan, badan divalidasi,
 * dan peran yang salah ditolak.
 *
 * Midtrans TIDAK dipanggil: tanpa kredensial `SnapClient` menolak, dan itu
 * memang perilakunya (#57). Karena itu assert-nya berhenti di "bukan 404 dan
 * bukan 401" untuk jalur sukses — bentuk kegagalan vendor diuji di
 * `checkout.integration.spec.ts`, bukan di sini.
 */

const URL_DEV = 'postgres://strive:strive_dev_only@localhost:55432/strive';
const url = process.env['DATABASE_URL_TEST'] ?? process.env['DATABASE_URL'] ?? URL_DEV;

const uuid = (n: number) => `00000000-0000-4000-8000-c33${String(n).padStart(9, '0')}`;
const SISWA = uuid(1);
const ADMIN = uuid(2);

const token = (id: string) => `c33-${id.slice(-6)}`;

let db: Kysely<DB>;
let app: INestApplication;
let base: string;
let reachable = false;

async function post(path: string, sebagai?: string, body?: unknown, idem?: string) {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(sebagai ? { authorization: `Bearer ${token(sebagai)}` } : {}),
      ...(idem ? { 'idempotency-key': idem } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
}

beforeAll(async () => {
  db = createDatabase(url);
  try {
    await db.selectFrom('orders').select('id').limit(1).execute();
    reachable = true;
  } catch {
    reachable = false;
    return;
  }

  process.env['DATABASE_URL'] = url;
  const moduleRef = await Test.createTestingModule({
    imports: [KyselyModule, PaymentModule],
  }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });
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
  await sql`TRUNCATE users, orders, pricing_config RESTART IDENTITY CASCADE`.execute(db);

  await db
    .insertInto('users')
    .values([
      {
        id: SISWA,
        email: 'c233siswa@uji.test',
        display_name: 'Siswa',
        role: 'student',
        email_verified: true,
      },
      {
        id: ADMIN,
        email: 'c233admin@uji.test',
        display_name: 'Admin',
        role: 'superadmin',
        email_verified: true,
      },
    ])
    .execute();

  await db
    .insertInto('sessions')
    .values([
      { user_id: SISWA, token: token(SISWA), expires_at: sql`now() + interval '1 day'` },
      { user_id: ADMIN, token: token(ADMIN), expires_at: sql`now() + interval '1 day'` },
    ])
    .execute();

  await db
    .insertInto('pricing_config')
    .values({
      version: 1,
      coin_price_idr: 25,
      scan_cost_coins: 2400,
      scan_cached_cost_coins: 1200,
      lesson_reward_coins: 10,
      cv_cost_coins: 1500,
      interview_cost_coins: 2000,
      statement_cost_coins: 2000,
      prompt_run_cost_coins: 300,
      freeze_cost_coins: 200,
      packages: JSON.stringify([{ id: 'starter', name: 'Starter', coins: 1000, price_idr: 25000 }]),
      created_by: SISWA,
    })
    .execute();
});

describe('POST /payments/checkout (rute — isu #233)', () => {
  it('database siap dipakai', () => {
    expect(reachable, `DATABASE_URL tidak bisa dipakai (${url})`).toBe(true);
  });

  it('RUTENYA ADA — bukan 404, yang selama ini jawabannya', async () => {
    if (!reachable) return;
    const res = await post('/api/v1/payments/checkout', SISWA, { package_id: 'starter' }, 'k-ada');
    // Inilah assert yang seluruh isu #233 soal itu. Nilai pastinya bisa
    // 200 (Snap terkonfigurasi) atau 5xx dari SnapClient tanpa kredensial —
    // yang TIDAK boleh adalah 404, dan sebelum PR ini ia selalu 404.
    expect(res.status).not.toBe(404);
  });

  it('baris orders sungguhan tertulis dari jalur HTTP, bukan hanya dari service', async () => {
    if (!reachable) return;
    await post('/api/v1/payments/checkout', SISWA, { package_id: 'starter' }, 'k-baris');
    const baris = await db.selectFrom('orders').selectAll().execute();
    // Snap bisa gagal SETELAH baris ditulis — itu urutan yang disengaja
    // (lihat checkout.service.ts). Jadi yang dibuktikan di sini: request HTTP
    // benar-benar sampai ke service, bukan berhenti di router.
    expect(baris).toHaveLength(1);
    expect(baris[0]?.user_id).toBe(SISWA);
    expect(baris[0]?.coins).toBe(1000);
    expect(baris[0]?.amount_idr).toBe(25000);
    expect(baris[0]?.idempotency_key).toBe('k-baris');
  });

  it('⚡ tanpa Idempotency-Key ditolak 400 VALIDATION_ERROR, dan NOL order tertulis', async () => {
    if (!reachable) return;
    const res = await post('/api/v1/payments/checkout', SISWA, { package_id: 'starter' });
    expect(res.status).toBe(400);
    const isi = (await res.json()) as { error?: { code?: string } };
    expect(isi.error?.code).toBe('VALIDATION_ERROR');
    expect(await db.selectFrom('orders').selectAll().execute()).toHaveLength(0);
  });

  it('package_id kosong/bukan string ditolak 400, bukan dilanjutkan sebagai undefined', async () => {
    if (!reachable) return;
    for (const badan of [{}, { package_id: '' }, { package_id: 7 }]) {
      const res = await post('/api/v1/payments/checkout', SISWA, badan, 'k-badan');
      expect(res.status, JSON.stringify(badan)).toBe(400);
    }
    expect(await db.selectFrom('orders').selectAll().execute()).toHaveLength(0);
  });

  it('package_id yang tidak ada di harga aktif → 400, dan NOL order tertulis', async () => {
    if (!reachable) return;
    const res = await post('/api/v1/payments/checkout', SISWA, { package_id: 'hantu' }, 'k-hantu');
    expect(res.status).toBe(400);
    expect(await db.selectFrom('orders').selectAll().execute()).toHaveLength(0);
  });

  it('tanpa sesi → 401', async () => {
    if (!reachable) return;
    const res = await post(
      '/api/v1/payments/checkout',
      undefined,
      { package_id: 'starter' },
      'k-tamu',
    );
    expect(res.status).toBe(401);
  });

  it('superadmin DITOLAK 403 — panel admin tidak punya dompet (PRD §2.4)', async () => {
    if (!reachable) return;
    const res = await post(
      '/api/v1/payments/checkout',
      ADMIN,
      { package_id: 'starter' },
      'k-admin',
    );
    expect(res.status).toBe(403);
    expect(await db.selectFrom('orders').selectAll().execute()).toHaveLength(0);
  });
});
