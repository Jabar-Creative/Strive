import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { Controller, Get, NotFoundException, type INestApplication } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { Kysely, sql } from 'kysely';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AllExceptionsFilter } from '../src/common/filters';
import {
  HEADER_REQUEST_ID,
  LoggingErrorTracker,
  PELACAK_GALAT,
  RequestLogInterceptor,
} from '../src/common/observability';
import { createDatabase, type DB } from '../src/infra/kysely';
import { MetricsService, type Metrik } from '../src/workers';

/**
 * `R-04` — log terstruktur, bentuk respons galat, dan evaluasi metrik §17.2.
 *
 * Yang diuji bukan "logger-nya bisa dipanggil" melainkan tiga hal yang
 * acceptance criteria-nya bergantung padanya: kelima bidang wajib §17.1 benar
 * ada, respons 500 mematuhi §10.1, dan ambang §17.2 benar-benar menyala.
 */

const URL_DEV = 'postgres://strive:strive_dev_only@localhost:55432/strive';
const url = process.env['DATABASE_URL_TEST'] ?? process.env['DATABASE_URL'] ?? URL_DEV;

/** Controller kecil supaya jalur galat bisa dipicu tanpa modul sungguhan. */
@Controller('uji')
class UjiController {
  @Get('ok')
  ok(): { ok: true } {
    return { ok: true };
  }

  @Get('meledak')
  meledak(): never {
    throw new Error('rahasia bocor: postgres://user:sandi@host/db');
  }

  @Get('hilang')
  hilang(): never {
    throw new NotFoundException('tidak ketemu');
  }
}

let app: INestApplication;
let base = '';
let db: Kysely<DB>;
let reachable = false;
const formatAsli = process.env['LOG_FORMAT'];

/** Menangkap stdout/stderr selama satu blok, lalu mengembalikannya. */
async function tangkap<T>(jalankan: () => Promise<T>): Promise<{ hasil: T; baris: string[] }> {
  const baris: string[] = [];
  const outAsli = process.stdout.write.bind(process.stdout);
  const errAsli = process.stderr.write.bind(process.stderr);
  const rekam = (chunk: unknown): boolean => {
    baris.push(String(chunk));
    return true;
  };
  process.stdout.write = rekam as typeof process.stdout.write;
  process.stderr.write = rekam as typeof process.stderr.write;
  try {
    const hasil = await jalankan();
    return { hasil, baris: baris.join('').split('\n').filter(Boolean) };
  } finally {
    process.stdout.write = outAsli;
    process.stderr.write = errAsli;
  }
}

function jsonBaris(baris: string[], cocok: (o: Record<string, unknown>) => boolean) {
  for (const b of baris) {
    try {
      const o = JSON.parse(b) as Record<string, unknown>;
      if (cocok(o)) return o;
    } catch {
      /* baris non-JSON diabaikan — di test ini justru itu yang tidak boleh ada */
    }
  }
  return undefined;
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

  const moduleRef = await Test.createTestingModule({
    controllers: [UjiController],
    providers: [
      { provide: PELACAK_GALAT, useClass: LoggingErrorTracker },
      { provide: APP_INTERCEPTOR, useClass: RequestLogInterceptor },
      { provide: APP_FILTER, useClass: AllExceptionsFilter },
    ],
  }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  await app.listen(0, '127.0.0.1');
  const alamat = app.getHttpServer().address() as AddressInfo | null;
  if (!alamat) throw new Error('tidak mendapat port');
  base = `http://127.0.0.1:${alamat.port}`;
}, 30_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await db.destroy();
});

beforeEach(() => {
  process.env['LOG_FORMAT'] = 'json';
});
afterEach(() => {
  if (formatAsli === undefined) delete process.env['LOG_FORMAT'];
  else process.env['LOG_FORMAT'] = formatAsli;
});

describe('R-04 — log per-request (PRD §17.1)', () => {
  it('lingkungan siap', () => {
    expect(reachable, `DATABASE_URL tidak bisa dipakai (${url})`).toBe(true);
  });

  it('kelima bidang wajib ada di satu baris JSON', async () => {
    if (!reachable) return;
    const { baris } = await tangkap(async () => fetch(`${base}/api/v1/uji/ok`));
    const log = jsonBaris(baris, (o) => o['msg'] === 'http');

    expect(log, 'tidak ada baris log http').toBeDefined();
    // §17.1 menyebut kelimanya tanpa syarat; tanpa salah satunya, §17.2 tidak
    // bisa dihitung sama sekali.
    expect(typeof log!['request_id']).toBe('string');
    expect(log!).toHaveProperty('user_id');
    expect(log!['route']).toContain('/uji/ok');
    expect(log!['status']).toBe(200);
    expect(typeof log!['duration_ms']).toBe('number');
  });

  it('request_id diteruskan dari header, bukan dibuat baru', async () => {
    if (!reachable) return;
    const id = randomUUID();
    const { hasil, baris } = await tangkap(async () =>
      fetch(`${base}/api/v1/uji/ok`, { headers: { [HEADER_REQUEST_ID]: id } }),
    );

    // Membuat id baru di sini memutus rantai penelusuran lintas layanan tepat
    // di tempat yang paling dibutuhkan.
    expect(hasil.headers.get(HEADER_REQUEST_ID)).toBe(id);
    expect(jsonBaris(baris, (o) => o['msg'] === 'http')?.['request_id']).toBe(id);
  });

  it('request yang GAGAL tetap tercatat, dengan level error', async () => {
    if (!reachable) return;
    // Baris request yang hanya muncul saat berhasil membuat error rate 5xx
    // mustahil dihitung — dan yang tersisa terlihat seperti sistem sehat.
    const { baris } = await tangkap(async () => fetch(`${base}/api/v1/uji/meledak`));
    const log = jsonBaris(baris, (o) => o['msg'] === 'http');

    expect(log?.['status']).toBe(500);
    expect(log?.['level']).toBe('error');
  });

  it('route, bukan URL mentah — id sumber daya tidak masuk log', async () => {
    if (!reachable) return;
    const { baris } = await tangkap(async () => fetch(`${base}/api/v1/uji/ok?rahasia=abc`));
    const log = jsonBaris(baris, (o) => o['msg'] === 'http');
    expect(String(log?.['route'])).not.toContain('rahasia');
  });
});

describe('R-04 — bentuk respons galat (PRD §10.1, temuan R-03 T-2)', () => {
  it('500 memakai bentuk §10.1 dengan code INTERNAL_ERROR', async () => {
    if (!reachable) return;
    const { hasil } = await tangkap(async () => fetch(`${base}/api/v1/uji/meledak`));
    expect(hasil.status).toBe(500);

    const badan = (await hasil.json()) as { error?: { code?: string; details?: unknown } };
    // Sebelum R-04, Nest menjawab {"statusCode":500,"message":"..."} — klien
    // yang mencabang pada `error.code` mendapat undefined saat server gagal.
    expect(badan.error?.code).toBe('INTERNAL_ERROR');
    expect(badan.error?.details).toEqual({});
  });

  it('500 TIDAK membocorkan pesan galat aslinya maupun stack', async () => {
    if (!reachable) return;
    const { hasil } = await tangkap(async () => fetch(`${base}/api/v1/uji/meledak`));
    const teks = await hasil.text();

    expect(teks).not.toContain('postgres://');
    expect(teks).not.toContain('rahasia bocor');
    expect(teks).not.toContain('at Object.');
  });

  it('stack TETAP masuk log — dibuang dari respons, bukan dari penelusuran', async () => {
    if (!reachable) return;
    const { baris } = await tangkap(async () => fetch(`${base}/api/v1/uji/meledak`));
    const log = jsonBaris(baris, (o) => typeof o['stack'] === 'string');

    expect(log, 'galat 500 tidak dilaporkan ke pelacak').toBeDefined();
    expect(String(log!['stack'])).toContain('meledak');
    expect(log!['status']).toBe(500);
    // Dikorelasikan dengan baris request lewat id yang sama.
    expect(typeof log!['request_id']).toBe('string');
  });

  it('404 dari router juga dipetakan ke bentuk §10.1', async () => {
    if (!reachable) return;
    const { hasil } = await tangkap(async () => fetch(`${base}/api/v1/uji/hilang`));
    const badan = (await hasil.json()) as { error?: { code?: string } };
    // Satu API tidak boleh menjawab dua bentuk galat berbeda.
    expect(hasil.status).toBe(404);
    expect(badan.error?.code).toBe('NOT_FOUND');
  });

  it('rute yang tidak ada sama sekali juga berbentuk §10.1', async () => {
    if (!reachable) return;
    const { hasil } = await tangkap(async () => fetch(`${base}/api/v1/tidak-ada-${randomUUID()}`));
    const badan = (await hasil.json()) as { error?: { code?: string } };
    expect(badan.error?.code).toBe('NOT_FOUND');
  });
});

describe('R-04 — metrik §17.2', () => {
  const antreanKosong = {
    getJobCounts: () => Promise.resolve({ waiting: 0, delayed: 0, prioritized: 0 }),
  };
  const kesehatanTenang = {
    get: () =>
      Promise.resolve({
        llm_cost: {
          today_usd: '0.000000',
          spike: { alert: false, ratio: null, baseline_usd: '0' },
        },
      }),
  };

  function metrics(antrean: unknown = antreanKosong, kesehatan: unknown = kesehatanTenang) {
    return new MetricsService(db, antrean as never, kesehatan as never);
  }

  function ambil(hasil: Metrik[], nama: string): Metrik {
    return hasil.find((m) => m.metric === nama)!;
  }

  it('dua metrik yang butuh agregator dilaporkan apa adanya, BUKAN ok', async () => {
    if (!reachable) return;
    const hasil = await metrics().evaluate();
    // Metrik yang melaporkan sehat karena tidak punya datanya adalah
    // kebohongan yang paling mahal: ia dipercaya justru saat insiden.
    expect(ambil(hasil, 'error_rate_5xx').status).toBe('butuh_agregator');
    expect(ambil(hasil, 'p95_latency_hub').status).toBe('butuh_agregator');
  });

  it('antrean BullMQ di atas 100 job memicu', async () => {
    if (!reachable) return;
    const penuh = { getJobCounts: () => Promise.resolve({ waiting: 101, delayed: 0 }) };
    const hasil = await metrics(penuh).evaluate();
    expect(ambil(hasil, 'bullmq_queue_depth')).toMatchObject({ status: 'breached', value: 101 });

    const pas = { getJobCounts: () => Promise.resolve({ waiting: 100, delayed: 0 }) };
    expect(
      (await metrics(pas).evaluate()).find((m) => m.metric === 'bullmq_queue_depth')?.status,
    ).toBe('ok');
  });

  it('hold menggantung > 30 menit memicu pada baris PERTAMA', async () => {
    if (!reachable) return;
    await sql`TRUNCATE users RESTART IDENTITY CASCADE`.execute(db);
    const uid = '00000000-0000-4000-8000-0000000r0401'.replace('r', 'a');
    await db
      .insertInto('users')
      .values({ id: uid, email: 'r04@uji.test', display_name: 'R04' })
      .execute();

    expect(ambil(await metrics().evaluate(), 'stale_holds').status).toBe('ok');

    await db
      .insertInto('plagiarism_scans')
      .values({
        user_id: uid,
        status: 'running',
        document_key: 'k',
        document_sha256: 'a'.repeat(64),
        filename: 'x.pdf',
        cost_coins: 2400,
        created_at: sql`now() - interval '31 minutes'`,
      })
      .execute();

    // Ambangnya NOL: hold yang menggantung berarti koin pengguna terkunci.
    expect(ambil(await metrics().evaluate(), 'stale_holds')).toMatchObject({
      status: 'breached',
      value: 1,
      threshold: 0,
    });
  });

  it('selisih rekonsiliasi koin memicu pada SATU pengguna yang menyimpang', async () => {
    if (!reachable) return;
    // Satu-satunya metrik §17.2 yang ambangnya NOL, dan yang paling mahal
    // kalau diam: cache saldo yang menyimpang berarti ada kode yang menulis
    // di luar `CoinLedgerService` (aturan keras 2 & 3).
    //
    // Ia juga yang paling mudah diam tanpa ketahuan — query-nya memakai
    // `groupBy` + `having` + `count(*)`, dan hasilnya dibaca dari
    // `rows.length`, bukan dari `count(*)`-nya. Kalau suatu saat seseorang
    // "merapikan" itu jadi membaca `n`, metriknya akan melaporkan jumlah
    // BARIS LEDGER pengguna pertama alih-alih jumlah pengguna menyimpang.
    await sql`TRUNCATE users RESTART IDENTITY CASCADE`.execute(db);
    const uid = '00000000-0000-4000-8000-0000000d4101';
    await db
      .insertInto('users')
      .values({ id: uid, email: 'drift-r04@uji.test', display_name: 'Drift', coin_balance: 0 })
      .execute();

    // Saldo nol tanpa ledger BUKAN penyimpangan — 0 = coalesce(sum, 0).
    expect(ambil(await metrics().evaluate(), 'coin_reconcile_drift')).toMatchObject({
      status: 'ok',
      value: 0,
      threshold: 0,
    });

    // Cache ditulis tanpa ledger — persis bentuk bug yang dijaga aturan 2.
    await db.updateTable('users').set({ coin_balance: 999 }).where('id', '=', uid).execute();

    expect(ambil(await metrics().evaluate(), 'coin_reconcile_drift')).toMatchObject({
      status: 'breached',
      value: 1,
    });
  });

  it('kegagalan webhook payment > 3 dalam sejam memicu', async () => {
    if (!reachable) return;
    await sql`TRUNCATE audit_log RESTART IDENTITY CASCADE`.execute(db);
    for (let i = 0; i < 3; i++) {
      await db
        .insertInto('audit_log')
        .values({ actor_id: null, action: 'payment.bad_signature', subject_type: 'order' })
        .execute();
    }
    expect(ambil(await metrics().evaluate(), 'payment_webhook_failures').status).toBe('ok');

    await db
      .insertInto('audit_log')
      .values({ actor_id: null, action: 'payment.bad_signature', subject_type: 'order' })
      .execute();
    expect(ambil(await metrics().evaluate(), 'payment_webhook_failures')).toMatchObject({
      status: 'breached',
      value: 4,
    });
  });

  it('lonjakan biaya LLM memakai definisi yang SAMA dengan SA-03', async () => {
    if (!reachable) return;
    const melonjak = {
      get: () =>
        Promise.resolve({
          llm_cost: {
            today_usd: '9.000000',
            spike: { alert: true, ratio: 9, baseline_usd: '1.000000' },
          },
        }),
    };
    expect(
      ambil(await metrics(antreanKosong, melonjak).evaluate(), 'llm_daily_cost'),
    ).toMatchObject({ status: 'breached', value: 9 });
  });

  it('runOnce menulis baris alert terstruktur untuk tiap ambang terlampaui', async () => {
    if (!reachable) return;
    process.env['LOG_FORMAT'] = 'json';
    const penuh = { getJobCounts: () => Promise.resolve({ waiting: 500, delayed: 0 }) };
    const { baris } = await tangkap(async () => metrics(penuh).runOnce());

    // Baris inilah alert-nya sampai ada agregator: apa pun yang membaca log
    // bisa memicu notifikasi dari `level: error` + `alert: true`.
    const alert = jsonBaris(
      baris,
      (o) => o['alert'] === true && o['metric'] === 'bullmq_queue_depth',
    );
    expect(alert, 'tidak ada baris alert').toBeDefined();
    expect(alert!['level']).toBe('error');
    expect(alert!['value']).toBe(500);
  });
});
