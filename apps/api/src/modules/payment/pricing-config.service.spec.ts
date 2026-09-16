import { randomUUID } from 'node:crypto';

import { BadRequestException } from '@nestjs/common';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DB } from '../../infra/kysely';
import type { PublishPricingInput } from './pricing-config.service';
import { PricingConfigService } from './pricing-config.service';

/**
 * Test integrasi P-01 — MEMBUKTIKAN acceptance criteria backlog secara
 * harfiah (docs/BACKLOG.md P-01): "Order lama tetap bisa dibaca harganya
 * setelah harga berubah. Menerbitkan versi baru tidak menimpa yang lama."
 *
 * Butuh Postgres NYATA, bukan mock — jalur harga/uang selalu diuji dengan
 * database sungguhan (CLAUDE.md §Test). Repo ini belum punya testcontainers
 * (lihat catatan di apps/api/test/setup.ts yang mengasumsikannya), jadi test
 * ini memakai stack dev biasa:
 *
 *   docker compose up -d && node scripts/db-migrate.mjs
 *
 * Kalau Postgres dev tidak terjangkau (mis. Docker tidak berjalan di sandbox
 * CI/agent), SELURUH describe di bawah DILEWATI dengan peringatan eksplisit
 * lewat `dbAvailable` — bukan dianggap lulus diam-diam.
 *
 * CATATAN GAP INFRA (bukan scope P-01, dilaporkan apa adanya): job CI `node`
 * (.github/workflows/ci.yml) yang menjalankan `pnpm test` TIDAK menyediakan
 * service Postgres — hanya job `migrations` yang punya. Karena describe di
 * bawah auto-skip tanpa DB, test ini tidak membuat job `node` merah, tapi
 * juga tidak benar-benar tereksekusi di sana. Sampai ada keputusan
 * arsitektur test (testcontainers, atau menambah service Postgres ke job
 * `node`), test ini efektif hanya berjalan di mesin developer yang
 * menjalankan `docker compose up -d` sendiri.
 */
const TEST_DATABASE_URL =
  process.env['PRICING_TEST_DATABASE_URL'] ?? 'postgres://strive:strive_dev_only@127.0.0.1:55432/strive';

async function pingDatabase(connectionString: string): Promise<boolean> {
  const probe = new Pool({ connectionString, connectionTimeoutMillis: 1500 });
  try {
    await probe.query('select 1');
    return true;
  } catch {
    return false;
  } finally {
    await probe.end().catch(() => undefined);
  }
}

// 3 paket top-up PERSIS docs/PRD.md §6.3 — sumber kebenaran produk, bukan
// angka ilustrasi. "Efektif" (Rp/koin) sengaja tidak disimpan: itu nilai
// turunan (price_idr / coins), dihitung di client, bukan data.
const PRICING_V1_PACKAGES = [
  { id: 'starter', name: 'Starter', coins: 1000, price_idr: 25000 },
  { id: 'reguler', name: 'Reguler', coins: 2200, price_idr: 50000 },
  { id: 'skripsi', name: 'Skripsi', coins: 4800, price_idr: 100000 },
];

// Nilai persis docs/PRD.md §5 (Delapan keputusan produk, TERKUNCI 14 Sep 2026)
// dan db/seeds/README.md — sama seperti yang akan dipakai `pnpm seed` (F-04)
// nanti untuk versi 1 produksi.
const basePayload: Omit<PublishPricingInput, 'packages'> = {
  coinPriceIdr: 25,
  scanCostCoins: 2400,
  scanCachedCostCoins: 240,
  lessonRewardCoins: 20,
  cvCostCoins: 400,
  interviewCostCoins: 300,
  statementCostCoins: 500,
  promptRunCostCoins: 20,
  freezeCostCoins: 200,
};

describe('PricingConfigService (integrasi database nyata)', () => {
  let dbAvailable = false;
  let db: Kysely<DB>;
  let service: PricingConfigService;
  let actorId: string;
  const publishedVersions: number[] = [];

  /**
   * `beforeAll` di sini SENGAJA tidak pernah `throw` kalau DB tidak
   * terjangkau — kalau `throw`, Vitest menandai SELURUH test di describe ini
   * GAGAL, padahal yang benar adalah DILEWATI (tidak ada bukti test-nya
   * salah, cuma lingkungannya tidak punya Postgres). `tsc` (module CommonJS,
   * lihat apps/api/tsconfig.json) menolak top-level `await`, jadi
   * pengecekan async ini tidak bisa dipakai untuk `describe.skipIf` yang
   * butuh boolean sinkron — makanya setiap `it` men-skip dirinya sendiri
   * lewat `ctx.skip()` di baris pertama kalau `dbAvailable` masih `false`.
   */
  beforeAll(async () => {
    dbAvailable = await pingDatabase(TEST_DATABASE_URL);
    if (!dbAvailable) {
      console.warn(
        `[pricing-config.service.spec] Postgres dev di ${TEST_DATABASE_URL} tidak terjangkau — ` +
          'seluruh test integrasi di file ini DILEWATI. Jalankan `docker compose up -d` lalu ' +
          '`node scripts/db-migrate.mjs` sebelum `pnpm test` untuk benar-benar menjalankannya.',
      );
      return;
    }

    db = new Kysely<DB>({
      dialect: new PostgresDialect({ pool: new Pool({ connectionString: TEST_DATABASE_URL }) }),
    });
    service = new PricingConfigService(db);

    // Baris `users` SUNGGUHAN, bukan UUID acak — kolom `pricing_config.created_by`
    // punya FK ke `users(id)`, jadi UUID yang tidak ada akan ditolak database.
    // Email @yopmail.com per konvensi data uji repo ini.
    const actor = await db
      .insertInto('users')
      .values({
        email: `strive-p01-pricing-test-${randomUUID()}@yopmail.com`,
        password_hash: 'test-only-not-a-real-hash',
        display_name: 'P-01 Pricing Test Actor',
        role: 'superadmin',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    actorId = actor.id;
  });

  afterAll(async () => {
    if (!dbAvailable) return;
    // Bersihkan jejak test dari database dev bersama — dibiarkan menumpuk
    // akan menabrak bootstrap versi 1 milik F-04/F-11 (version=1 sudah
    // terpakai) dan mengotori dev environment developer lain.
    if (publishedVersions.length > 0) {
      await db.deleteFrom('pricing_config').where('version', 'in', publishedVersions).execute();
    }
    if (actorId) {
      await db.deleteFrom('users').where('id', '=', actorId).execute();
    }
    await db.destroy();
  });

  it('AC P-01: publish versi baru TIDAK menimpa versi lama, dan versi aktif pindah ke yang baru', async (ctx) => {
    if (!dbAvailable) ctx.skip();

    const v1 = await service.publishNewVersion({ ...basePayload, packages: PRICING_V1_PACKAGES }, actorId);
    publishedVersions.push(v1.version);

    // Snapshot v1 SEBELUM v2 diterbitkan — dibandingkan lagi setelahnya.
    const v1BeforeSecondPublish = await service.getVersion(v1.version);
    expect(v1BeforeSecondPublish).toMatchObject({ version: v1.version, coin_price_idr: 25, scan_cost_coins: 2400 });

    // Terbitkan versi baru dengan HARGA BERBEDA — ini kasus yang jadi inti
    // acceptance criteria: harga berubah, order lama tidak boleh ikut berubah.
    const v2 = await service.publishNewVersion(
      { ...basePayload, coinPriceIdr: 30, packages: PRICING_V1_PACKAGES },
      actorId,
    );
    publishedVersions.push(v2.version);
    expect(v2.version).toBe(v1.version + 1);

    // AC-1: "Order lama tetap bisa dibaca harganya setelah harga berubah."
    // Baris versi lama (SELECT * FROM pricing_config WHERE version=v1) TIDAK
    // berubah sama sekali dibanding snapshot sebelum publish v2.
    const v1AfterSecondPublish = await service.getVersion(v1.version);
    expect(v1AfterSecondPublish).toEqual(v1BeforeSecondPublish);
    expect(v1AfterSecondPublish?.coin_price_idr).toBe(25);

    // AC-2: "Menerbitkan versi baru tidak menimpa yang lama" — versi AKTIF
    // sekarang adalah yang baru (v2), bukan v1.
    const current = await service.getCurrentVersion();
    expect(current?.version).toBe(v2.version);
    expect(current?.coin_price_idr).toBe(30);
  });

  it('menolak payload dengan angka bukan bilangan bulat positif', async (ctx) => {
    if (!dbAvailable) ctx.skip();

    const publish = service.publishNewVersion({ ...basePayload, coinPriceIdr: 0, packages: PRICING_V1_PACKAGES }, actorId);

    await expect(publish).rejects.toBeInstanceOf(BadRequestException);
    await publish.catch((error: BadRequestException) => {
      expect(error.getResponse()).toMatchObject({ code: 'INVALID_PRICING_PAYLOAD' });
    });
  });

  it('menolak packages kosong', async (ctx) => {
    if (!dbAvailable) ctx.skip();

    const publish = service.publishNewVersion({ ...basePayload, packages: [] }, actorId);

    await expect(publish).rejects.toBeInstanceOf(BadRequestException);
    await publish.catch((error: BadRequestException) => {
      expect(error.getResponse()).toMatchObject({ code: 'INVALID_PRICING_PAYLOAD' });
    });
  });

  it('dua publish bersamaan tidak pernah menghasilkan version yang sama (advisory lock)', async (ctx) => {
    if (!dbAvailable) ctx.skip();

    const [a, b] = await Promise.all([
      service.publishNewVersion({ ...basePayload, packages: PRICING_V1_PACKAGES }, actorId),
      service.publishNewVersion({ ...basePayload, packages: PRICING_V1_PACKAGES }, actorId),
    ]);
    publishedVersions.push(a.version, b.version);

    expect(a.version).not.toBe(b.version);
    // Keduanya tetap terbaca utuh oleh version masing-masing — bukti lain
    // bahwa tidak ada yang saling menimpa walau ditembak bersamaan.
    await expect(service.getVersion(a.version)).resolves.toMatchObject({ version: a.version });
    await expect(service.getVersion(b.version)).resolves.toMatchObject({ version: b.version });
  });
});
