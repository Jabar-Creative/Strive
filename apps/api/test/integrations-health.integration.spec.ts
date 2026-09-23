import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Kysely, sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase, type DB } from '../src/infra/kysely';
import {
  AMBANG_LONJAKAN,
  AdminModule,
  IntegrationsHealthService,
  LANTAI_LONJAKAN_USD,
  TZ_OPS,
  type IntegrationsHealth,
} from '../src/modules/admin';
import { KyselyModule } from '../src/infra/kysely';

/**
 * `SA-03` terhadap database NYATA — PRD §10.3, `SA-6`.
 *
 * Dua acceptance criteria:
 *   1. Lonjakan biaya LLM terlihat di hari yang SAMA.
 *   2. Status tiap vendor (up/down/degraded) akurat.
 *
 * "Akurat" yang diuji di sini bukan "ada nilainya", melainkan bahwa nilainya
 * berubah sesuai keadaan — termasuk dua keadaan yang tidak disebut acceptance
 * criteria tapi tanpanya jawabannya akan bohong: kredensial kosong, dan nol
 * panggilan.
 */

const URL_DEV = 'postgres://strive:strive_dev_only@localhost:55432/strive';
const url = process.env['DATABASE_URL_TEST'] ?? process.env['DATABASE_URL'] ?? URL_DEV;

const SUPER = '00000000-0000-4000-8000-00000005a301';
const MURID = '00000000-0000-4000-8000-00000005a302';

let db: Kysely<DB>;
let app: INestApplication;
let base = '';
let svc: IntegrationsHealthService;
let reachable = false;
const envAsli: Record<string, string | undefined> = {};

const KUNCI_ENV = [
  'AI_SERVICE_TOKEN',
  'COPYLEAKS_API_KEY',
  'MIDTRANS_SERVER_KEY',
  'RESEND_API_KEY',
] as const;

async function sesi(userId: string): Promise<string> {
  const token = randomUUID();
  await db
    .insertInto('sessions')
    .values({ user_id: userId, token, expires_at: sql`now() + interval '1 day'` })
    .execute();
  return token;
}

/**
 * Satu baris `ai_jobs`.
 *
 * TANPA `offsetHari`/`jamLokal` ia dicap `now()` — itu yang dipakai test
 * KESEHATAN, yang jendelanya hanya 60 menit terakhir. Versi pertama helper ini
 * mencap semuanya pukul 12.00 lokal, dan tiga test kesehatan merah karena
 * jam 12.00 sudah di luar jendela sejak pukul 13.01. Test BIAYA yang butuh
 * jam lokal tertentu (batas tengah malam) mengisinya eksplisit.
 */
async function aiJob(p: {
  status: 'done' | 'failed' | 'queued';
  costUsd?: number;
  model?: string;
  offsetHari?: number;
  jamLokal?: string;
}): Promise<void> {
  const nilai = {
    user_id: SUPER,
    kind: 'ats_cv' as const,
    status: p.status,
    input: JSON.stringify({}),
    model: p.model ?? 'gpt-4o-mini',
    cost_usd: p.costUsd === undefined ? null : p.costUsd.toFixed(6),
  };
  const perluWaktuLokal = p.offsetHari !== undefined || p.jamLokal !== undefined;
  if (!perluWaktuLokal) {
    await db.insertInto('ai_jobs').values(nilai).execute();
    return;
  }

  const hari = p.offsetHari ?? 0;
  const jam = p.jamLokal ?? '12:00';
  await db
    .insertInto('ai_jobs')
    .values({
      ...nilai,
      // Dibentuk di POSTGRES dari tanggal lokal + jam lokal, lalu dikembalikan
      // ke timestamptz. Membentuknya di Node akan meleset persis sebanyak
      // selisih zona waktu mesin yang menjalankan test.
      created_at: sql`((now() AT TIME ZONE ${sql.lit(TZ_OPS)})::date + ${sql.lit(hari)} * interval '1 day' + ${jam}::time) AT TIME ZONE ${sql.lit(TZ_OPS)}`,
    })
    .execute();
}

beforeAll(async () => {
  db = createDatabase(url);
  try {
    await db.selectFrom('ai_jobs').select('id').limit(1).execute();
    reachable = true;
  } catch {
    reachable = false;
    return;
  }
  for (const k of KUNCI_ENV) envAsli[k] = process.env[k];
  process.env['DATABASE_URL'] = url;

  const moduleRef = await Test.createTestingModule({
    imports: [KyselyModule, AdminModule],
  }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });
  await app.listen(0, '127.0.0.1');
  const alamat = app.getHttpServer().address() as AddressInfo | null;
  if (!alamat) throw new Error('tidak mendapat port');
  base = `http://127.0.0.1:${alamat.port}`;
  svc = app.get(IntegrationsHealthService);
}, 30_000);

afterAll(async () => {
  for (const k of KUNCI_ENV) {
    if (envAsli[k] === undefined) delete process.env[k];
    else process.env[k] = envAsli[k];
  }
  if (app) await app.close();
  if (db) await db.destroy();
});

beforeEach(async () => {
  if (!reachable) return;
  for (const k of KUNCI_ENV) process.env[k] = 'terisi-untuk-uji';
  await sql`TRUNCATE users, plagiarism_scans, payments, notifications RESTART IDENTITY CASCADE`.execute(
    db,
  );
  await db
    .insertInto('users')
    .values([
      { id: SUPER, email: 'sa03-super@uji.test', display_name: 'Super', role: 'superadmin' },
      { id: MURID, email: 'sa03-murid@uji.test', display_name: 'Murid' },
    ])
    .execute();
});

async function ambil(token: string): Promise<{ status: number; body: IntegrationsHealth }> {
  const r = await fetch(`${base}/api/v1/admin/integrations/health`, {
    headers: { authorization: `Bearer ${token}` },
  });
  return { status: r.status, body: (await r.json()) as IntegrationsHealth };
}

function vendor(h: IntegrationsHealth, nama: string) {
  return h.integrations.find((x) => x.vendor === nama)!;
}

describe('SA-03 — GET /admin/integrations/health (database nyata)', () => {
  it('database siap dipakai', () => {
    expect(reachable, `DATABASE_URL tidak bisa dipakai (${url})`).toBe(true);
  });

  it('superadmin saja — student ditolak', async () => {
    if (!reachable) return;
    const r = await fetch(`${base}/api/v1/admin/integrations/health`, {
      headers: { authorization: `Bearer ${await sesi(MURID)}` },
    });
    expect(r.status).toBe(403);

    expect((await ambil(await sesi(SUPER))).status).toBe(200);
  });

  // ── AC 2: status vendor akurat ─────────────────────────────────────────

  it('kredensial kosong → not_configured, BUKAN down', async () => {
    if (!reachable) return;
    process.env['MIDTRANS_SERVER_KEY'] = '';
    const h = await svc.get();
    // `down` menyalahkan vendor untuk konfigurasi kita; `up` adalah kebohongan.
    expect(vendor(h, 'midtrans').status).toBe('not_configured');
    expect(vendor(h, 'midtrans').catatan).toContain('MIDTRANS_SERVER_KEY');
  });

  it('nol panggilan → unknown, BUKAN up', async () => {
    if (!reachable) return;
    const h = await svc.get();
    // Nol kegagalan dari nol percobaan bukan bukti sehat.
    expect(vendor(h, 'llm').status).toBe('unknown');
    expect(vendor(h, 'copyleaks').status).toBe('unknown');
  });

  it('semua berhasil → up', async () => {
    if (!reachable) return;
    await aiJob({ status: 'done', costUsd: 0.001 });
    await aiJob({ status: 'done', costUsd: 0.001 });
    const h = await svc.get();
    expect(vendor(h, 'llm')).toMatchObject({ status: 'up', ok: 2, gagal: 0 });
  });

  it('sebagian gagal (<50%) → degraded', async () => {
    if (!reachable) return;
    await aiJob({ status: 'done', costUsd: 0.001 });
    await aiJob({ status: 'done', costUsd: 0.001 });
    await aiJob({ status: 'failed' });
    const h = await svc.get();
    expect(vendor(h, 'llm')).toMatchObject({ status: 'degraded', ok: 2, gagal: 1 });
  });

  it('mayoritas gagal (>=50%) → down', async () => {
    if (!reachable) return;
    await aiJob({ status: 'done', costUsd: 0.001 });
    await aiJob({ status: 'failed' });
    await aiJob({ status: 'failed' });
    const h = await svc.get();
    expect(vendor(h, 'llm')).toMatchObject({ status: 'down', ok: 1, gagal: 2 });
  });

  it('job yang masih `queued` tidak dihitung sebagai berhasil maupun gagal', async () => {
    if (!reachable) return;
    await aiJob({ status: 'queued' });
    const h = await svc.get();
    // Menghitungnya sebagai sukses membuat antrean yang macet terlihat sehat.
    expect(vendor(h, 'llm')).toMatchObject({ status: 'unknown', ok: 0, gagal: 0 });
  });

  it('Midtrans dilihat dari `payments`, bukan dari order pending', async () => {
    if (!reachable) return;
    // Order `pending` yang menumpuk adalah pengguna yang menutup Snap, bukan
    // Midtrans yang sakit.
    const h = await svc.get();
    expect(vendor(h, 'midtrans').status).toBe('unknown');
  });

  // ── AC 1: lonjakan terlihat hari yang sama ─────────────────────────────

  it('biaya HARI INI dihitung menurut zona waktu ops, bukan UTC', async () => {
    if (!reachable) return;
    // 00.30 WIB hari ini = 17.30 UTC KEMARIN. Kalau batas harinya UTC, biaya
    // ini hilang dari laporan hari ini — dan lonjakan yang dimulai lewat
    // tengah malam tidak terlihat sampai besok.
    await aiJob({ status: 'done', costUsd: 1.5, jamLokal: '00:30' });
    // 23.30 WIB KEMARIN = 16.30 UTC kemarin: bukan hari ini, apa pun batasnya.
    await aiJob({ status: 'done', costUsd: 9, offsetHari: -1, jamLokal: '23:30' });

    const h = await svc.get();
    expect(h.timezone).toBe(TZ_OPS);
    expect(h.llm_cost.today_usd).toBe('1.500000');
  });

  it('AC: biaya per model hari ini, dan lonjakan 10× memicu alert', async () => {
    if (!reachable) return;
    // Enam hari sebelumnya rata-rata 1 USD.
    for (let d = 1; d <= 6; d++) await aiJob({ status: 'done', costUsd: 1, offsetHari: -d });
    // Hari ini sepuluh kali lipatnya, dua model.
    await aiJob({ status: 'done', costUsd: 6, model: 'gpt-4o' });
    await aiJob({ status: 'done', costUsd: 4, model: 'gpt-4o-mini' });

    const h = await svc.get();
    expect(h.llm_cost.today_usd).toBe('10.000000');
    expect(h.llm_cost.by_model).toEqual([
      { model: 'gpt-4o', cost_usd: '6.000000', jobs: 1 },
      { model: 'gpt-4o-mini', cost_usd: '4.000000', jobs: 1 },
    ]);

    // Satu angka sendirian tidak memperlihatkan lonjakan — yang dikirim
    // pembanding dan putusannya.
    expect(h.llm_cost.spike.baseline_usd).toBe('1.000000');
    expect(h.llm_cost.spike.ratio).toBe(10);
    expect(h.llm_cost.spike.alert).toBe(true);
  });

  it('hari yang biasa saja TIDAK memicu alert', async () => {
    if (!reachable) return;
    for (let d = 1; d <= 6; d++) await aiJob({ status: 'done', costUsd: 1, offsetHari: -d });
    await aiJob({ status: 'done', costUsd: 1.2 });

    const h = await svc.get();
    expect(h.llm_cost.spike.ratio).toBe(1.2);
    expect(h.llm_cost.spike.alert).toBe(false);
  });

  it('angka receh tidak memicu alert meski rasionya besar', async () => {
    if (!reachable) return;
    // 0,000001 → 0,000010 rasionya 10× dan artinya nol. Alarm palsu yang
    // sering berbunyi adalah alarm yang dimatikan orang.
    for (let d = 1; d <= 6; d++) await aiJob({ status: 'done', costUsd: 0.000001, offsetHari: -d });
    await aiJob({ status: 'done', costUsd: 0.00001 });

    const h = await svc.get();
    expect(h.llm_cost.spike.ratio).toBeGreaterThanOrEqual(AMBANG_LONJAKAN);
    expect(Number(h.llm_cost.today_usd)).toBeLessThan(LANTAI_LONJAKAN_USD);
    expect(h.llm_cost.spike.alert).toBe(false);
  });

  it('tujuh hari terakhir terurut, dan hari tanpa biaya tidak mengarang baris', async () => {
    if (!reachable) return;
    await aiJob({ status: 'done', costUsd: 2, offsetHari: -3 });
    await aiJob({ status: 'done', costUsd: 3 });

    const h = await svc.get();
    expect(h.llm_cost.last_7_days).toHaveLength(2);
    const tanggal = h.llm_cost.last_7_days.map((d) => d.date);
    expect([...tanggal].sort()).toEqual(tanggal);
    expect(h.llm_cost.last_7_days.at(-1)?.cost_usd).toBe('3.000000');
  });

  it('job TANPA biaya tidak masuk laporan biaya', async () => {
    if (!reachable) return;
    await aiJob({ status: 'failed' });
    const h = await svc.get();
    expect(h.llm_cost.today_usd).toBe('0.000000');
    expect(h.llm_cost.by_model).toEqual([]);
  });
});
