import { createHmac, randomUUID } from 'node:crypto';
import { Kysely, sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type INestApplication, ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { createDatabase, type DB } from '../src/infra/kysely';
import { KyselyModule } from '../src/infra/kysely';
import { StorageModule } from '../src/infra/storage';
import {
  CopyleaksProvider,
  PLAGIARISM_PROVIDER,
  ScanModule,
  ScanService,
} from '../src/modules/scan';
import type { ParsedWebhook, PlagiarismProvider } from '../src/modules/scan';

/**
 * `POST /webhooks/copyleaks` — `K-03`, lewat HTTP.
 *
 * ── Yang diuji, dan yang SENGAJA TIDAK ──
 *
 * Diuji: bahwa rutenya **gagal tertutup**, bahwa tanda tangan yang salah
 * ditolak sebelum apa pun menyentuh uang, dan bahwa hasil yang sah
 * benar-benar menyetel hold.
 *
 * TIDAK diuji: bahwa skema tanda tangan kita cocok dengan yang benar-benar
 * dikirim Copyleaks. Itu tidak bisa diuji tanpa akun sandbox (isu #90), dan
 * test yang memverifikasi tanda tangan terhadap payload karangan sendiri
 * hanya membuktikan kita konsisten dengan diri sendiri.
 */

const URL_DEV = 'postgres://strive:strive_dev_only@localhost:55432/strive';
const url = process.env['DATABASE_URL_TEST'] ?? process.env['DATABASE_URL'] ?? URL_DEV;

const ADMIN = '00000000-0000-4000-8000-0000000k3001'.replace(/k3/, 'ea');
const USER = '00000000-0000-4000-8000-0000000k3002'.replace(/k3/, 'ea');
const RAHASIA = 'rahasia-webhook-uji';

let db: Kysely<DB>;
let app: INestApplication;
let scans: ScanService;
let base: string;
let reachable = false;

/** Provider tiruan: tanda tangan HMAC yang kita kendalikan penuh. */
const provider: PlagiarismProvider = {
  name: 'copyleaks',
  submit: async () => ({ providerScanId: 'cl-uji' }),
  verifyWebhook(headers, rawBody) {
    const dikirim = headers['x-copyleaks-signature'];
    if (!dikirim) return false;
    return createHmac('sha256', RAHASIA).update(rawBody).digest('hex') === dikirim;
  },
  parseWebhook(body): ParsedWebhook {
    const b = body as { scanId: string; score?: number; reportUrl?: string; error?: string };
    if (b.error) return { scanId: b.scanId, error: b.error };
    return { scanId: b.scanId, score: b.score ?? 0, reportUrl: b.reportUrl ?? '' };
  },
};

async function kirim(badan: unknown, tandaTangan?: string) {
  const raw = JSON.stringify(badan);
  return fetch(`${base}/api/v1/webhooks/copyleaks`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(tandaTangan === undefined
        ? { 'x-copyleaks-signature': createHmac('sha256', RAHASIA).update(raw).digest('hex') }
        : tandaTangan === ''
          ? {}
          : { 'x-copyleaks-signature': tandaTangan }),
    },
    body: raw,
  });
}

const saldo = async () =>
  (
    await db
      .selectFrom('users')
      .select('coin_balance')
      .where('id', '=', USER)
      .executeTakeFirstOrThrow()
  ).coin_balance;

beforeAll(async () => {
  db = createDatabase(url);
  try {
    await db.selectFrom('plagiarism_scans').select('id').limit(1).execute();
    reachable = true;
  } catch {
    reachable = false;
    return;
  }

  process.env['DATABASE_URL'] = url;
  const moduleRef = await Test.createTestingModule({
    imports: [KyselyModule, StorageModule, ScanModule],
  })
    .overrideProvider(PLAGIARISM_PROVIDER)
    .useValue(provider)
    .compile();

  app = moduleRef.createNestApplication({ rawBody: true });
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });
  scans = moduleRef.get(ScanService);
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
  await sql`TRUNCATE users, pricing_config RESTART IDENTITY CASCADE`.execute(db);
  await db
    .insertInto('users')
    .values([
      {
        id: ADMIN,
        email: 'k3a@uji.test',
        display_name: 'A',
        role: 'superadmin',
      },
      {
        id: USER,
        email: 'k3u@uji.test',
        display_name: 'U',
        coin_balance: 10000,
      },
    ])
    .execute();
  await db
    .insertInto('coin_ledger')
    .values({ user_id: USER, entry_type: 'adjust', amount: 10000, balance_after: 10000 })
    .execute();
  await db
    .insertInto('pricing_config')
    .values({
      version: 1,
      coin_price_idr: 25,
      scan_cost_coins: 2400,
      scan_cached_cost_coins: 240,
      lesson_reward_coins: 20,
      cv_cost_coins: 400,
      interview_cost_coins: 300,
      statement_cost_coins: 500,
      prompt_run_cost_coins: 20,
      freeze_cost_coins: 200,
      packages: JSON.stringify([{ id: 's', name: 'S', coins: 1000, price_idr: 25000 }]),
      created_by: ADMIN,
    })
    .execute();
});

/** Scan `queued` dengan hold 2400 — jalur normal `K-02`. */
async function scanMenunggu(): Promise<string> {
  const r = await scans.submit({
    userId: USER,
    document: { filename: 's.pdf', buffer: Buffer.from(`%PDF-1.7\n% ${randomUUID()}\n%%EOF\n`) },
    idempotencyKey: randomUUID(),
  });
  return r.scanId;
}

describe('POST /webhooks/copyleaks (K-03)', () => {
  it('database siap dipakai', () => {
    expect(reachable, `DATABASE_URL tidak bisa dipakai (${url})`).toBe(true);
  });

  // ── Tanda tangan: yang menahan, bukan sesi ─────────────────────────────

  it('tanda tangan SALAH ditolak, dan uang TIDAK tersentuh', async () => {
    if (!reachable) return;
    const scanId = await scanMenunggu();
    const sebelum = await saldo();

    const res = await kirim({ scanId, score: 12, reportUrl: 'x' }, 'a'.repeat(64));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      'INVALID_SIGNATURE',
    );

    // Yang paling penting: hold-nya TIDAK disetel. Webhook palsu yang menyetel
    // hold adalah koin pengguna yang hilang atas perintah orang asing.
    expect(await saldo()).toBe(sebelum);
    const baris = await db
      .selectFrom('plagiarism_scans')
      .select('status')
      .where('id', '=', scanId)
      .executeTakeFirstOrThrow();
    expect(baris.status).toBe('queued');
  });

  it('TANPA header tanda tangan ditolak', async () => {
    if (!reachable) return;
    const scanId = await scanMenunggu();
    expect((await kirim({ scanId, score: 1, reportUrl: 'x' }, '')).status).toBe(400);
  });

  it('badan yang DIUBAH setelah ditandatangani ditolak', async () => {
    if (!reachable) return;
    const scanId = await scanMenunggu();
    const asli = JSON.stringify({ scanId, score: 5, reportUrl: 'x' });
    const ttd = createHmac('sha256', RAHASIA).update(asli).digest('hex');

    // Skor dinaikkan setelah tanda tangan dibuat. Inilah alasan tanda tangan
    // dihitung atas BADAN MENTAH: kalau ia dihitung ulang dari hasil parse,
    // perubahan ini tidak terlihat.
    const res = await fetch(`${base}/api/v1/webhooks/copyleaks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-copyleaks-signature': ttd },
      body: JSON.stringify({ scanId, score: 99, reportUrl: 'x' }),
    });
    expect(res.status).toBe(400);
  });

  // ── Jalur sah ──────────────────────────────────────────────────────────

  it('hasil SAH menyetel hold dan menandai scan done', async () => {
    if (!reachable) return;
    const scanId = await scanMenunggu();
    const sesudahHold = await saldo();

    const res = await kirim({ scanId, score: 18.5, reportUrl: 'https://vendor/r.pdf' });
    expect(res.status).toBe(201);

    const baris = await db
      .selectFrom('plagiarism_scans')
      .select(['status', 'similarity_score', 'report_key'])
      .where('id', '=', scanId)
      .executeTakeFirstOrThrow();
    expect(baris.status).toBe('done');
    expect(Number(baris.similarity_score)).toBe(18.5);
    // `report_key` adalah kunci di storage KITA. URL vendor berumur pendek dan
    // tidak bisa ditandatangani ulang untuk pengguna (KL-10) — mengunduhnya
    // butuh kredensial, jadi dibiarkan NULL. Kosong yang jujur.
    expect(baris.report_key, 'URL vendor disimpan sebagai report_key').toBeNull();

    // Settle tidak menulis entri ledger — hold sudah memotong.
    expect(await saldo()).toBe(sesudahHold);
  });

  it('KL-7: vendor melaporkan GAGAL → koin kembali penuh', async () => {
    if (!reachable) return;
    const scanId = await scanMenunggu();
    expect(await saldo()).toBe(10000 - 2400);

    const res = await kirim({ scanId, error: 'dokumen tidak bisa diekstrak' });
    expect(res.status).toBe(201);

    expect(await saldo(), 'koin tidak kembali setelah vendor melaporkan gagal').toBe(10000);
    const baris = await db
      .selectFrom('plagiarism_scans')
      .select(['status', 'error_message'])
      .where('id', '=', scanId)
      .executeTakeFirstOrThrow();
    expect(baris.status).toBe('failed');
    expect(baris.error_message).toContain('diekstrak');
  });

  it('webhook yang sama dikirim DUA KALI tetap satu efek', async () => {
    if (!reachable) return;
    const scanId = await scanMenunggu();
    const badan = { scanId, score: 7, reportUrl: 'x' };
    await kirim(badan);
    const sesudah = await saldo();
    const kedua = await kirim(badan);

    expect(kedua.status).toBe(201);
    expect(await saldo()).toBe(sesudah);
  });
});

describe('CopyleaksProvider — GAGAL TERTUTUP tanpa kredensial (isu #90)', () => {
  const asli = process.env['COPYLEAKS_WEBHOOK_SECRET'];
  const p = new CopyleaksProvider();

  afterAll(() => {
    if (asli === undefined) delete process.env['COPYLEAKS_WEBHOOK_SECRET'];
    else process.env['COPYLEAKS_WEBHOOK_SECRET'] = asli;
  });

  it('tanpa COPYLEAKS_WEBHOOK_SECRET, SETIAP webhook ditolak', () => {
    delete process.env['COPYLEAKS_WEBHOOK_SECRET'];
    const badan = Buffer.from('{}');
    // Termasuk yang tanda tangannya "benar" menurut skema mana pun — tanpa
    // rahasia, tidak ada yang bisa diverifikasi, jadi jawabannya BUKAN
    // "belum diimplementasikan" tapi "tidak sah".
    expect(p.verifyWebhook({ 'x-copyleaks-signature': 'a'.repeat(64) }, badan)).toBe(false);
    expect(p.verifyWebhook({}, badan)).toBe(false);
  });

  it('dengan rahasia: tanda tangan benar diterima, salah ditolak', () => {
    process.env['COPYLEAKS_WEBHOOK_SECRET'] = 'rahasia';
    const badan = Buffer.from('{"a":1}');
    const benar = createHmac('sha256', 'rahasia').update(badan).digest('hex');

    expect(p.verifyWebhook({ 'x-copyleaks-signature': benar }, badan)).toBe(true);
    expect(p.verifyWebhook({ 'x-copyleaks-signature': 'b'.repeat(64) }, badan)).toBe(false);
    // Panjang berbeda diperiksa DULU: `timingSafeEqual` MELEMPAR kalau
    // panjangnya tidak sama, dan melempar dari jalur verifikasi tanda tangan
    // berarti 500 untuk request yang jelas tidak sah.
    expect(() => p.verifyWebhook({ 'x-copyleaks-signature': 'pendek' }, badan)).not.toThrow();
    expect(p.verifyWebhook({ 'x-copyleaks-signature': 'pendek' }, badan)).toBe(false);
  });

  it('submit() MELEMPAR, tidak mengembalikan id karangan', async () => {
    // Mengembalikan `{ providerScanId: 'stub' }` akan membuat scan tercatat
    // terkirim ke vendor yang tidak pernah menerimanya — dan hold-nya
    // menggantung sampai reaper, tanpa ada yang tahu kenapa.
    // Pesannya ada di BADAN respons, bukan di `.message` — `.message`
    // exception Nest berisi teks HTTP generik ("Service Unavailable
    // Exception"), dan assert atas itu tidak membuktikan apa pun.
    let galat: unknown;
    try {
      await p.submit({ scanId: 'x', documentUrl: 'https://x', filename: 'a.pdf' });
    } catch (e) {
      galat = e;
    }
    expect(galat).toBeInstanceOf(ServiceUnavailableException);
    const badan = (galat as ServiceUnavailableException).getResponse() as {
      error: { code: string; message: string };
    };
    expect(badan.error.code).toBe('PROVIDER_UNAVAILABLE');
    expect(badan.error.message).toMatch(/belum tersambung/);
  });
});
