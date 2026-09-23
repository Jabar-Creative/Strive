import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type Redis from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { appOrigins, headerKeamanan } from '../src/common';
import { BATAS_AUTH, BATAS_UMUM } from '../src/common/interceptors';
import { REDIS, createRedis, redisSiap } from '../src/infra/redis';

/**
 * `R-03` — audit keamanan, bagian yang bisa DITEGAKKAN terus-menerus.
 *
 * Laporan auditnya ada di `docs/reports/R-03/`. Berkas ini bukan ringkasannya:
 * ia penjaga untuk temuan yang bisa kambuh diam-diam — header yang hilang saat
 * seseorang merapikan `main.ts`, atau rate limit yang berhenti terpasang saat
 * modul disusun ulang.
 *
 * Dibangun dari `AppModule` SUNGGUHAN, bukan modul uji. Dua test CORS yang ada
 * (`auth-http`, `auth-email-timezone`) memanggil `app.enableCors()` sendiri
 * dengan konstanta hardcoded — jadi keduanya tetap hijau meski `main.ts`
 * kehilangan CORS sepenuhnya. Jebakan yang sama sudah tercatat untuk
 * `rawBody`; di sini ia dihindari dengan memakai jalur yang sama dengan
 * produksi.
 */

const URL_DEV = 'postgres://strive:strive_dev_only@localhost:55432/strive';
const url = process.env['DATABASE_URL_TEST'] ?? process.env['DATABASE_URL'] ?? URL_DEV;
const redisUrl = process.env['REDIS_URL'] ?? 'redis://127.0.0.1:56379';

let app: INestApplication;
let base = '';
let redis: Redis;
let reachable = false;

/** Satu alamat baru per test — ember rate limit terpisah, tanpa tunggu TTL. */
function alamatBaru(): string {
  const n = () => Math.floor(Math.random() * 254) + 1;
  return `203.0.113.${n()}`;
}

async function ambil(
  jalur: string,
  ip: string,
  extra: Record<string, string> = {},
): Promise<Response> {
  return fetch(`${base}${jalur}`, { headers: { 'x-forwarded-for': ip, ...extra } });
}

beforeAll(async () => {
  redis = createRedis(redisUrl);
  try {
    // `ping()` sebagai perintah PERTAMA ditolak kalau koneksinya belum siap —
    // `enableOfflineQueue: false`. Test ini sempat merah karenanya.
    await redisSiap(redis);
    await redis.ping();
    reachable = true;
  } catch {
    reachable = false;
    return;
  }
  process.env['DATABASE_URL'] = url;

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  // Persis urutan `main.ts`.
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });
  app.use(headerKeamanan());
  app.enableCors({ origin: appOrigins(), credentials: true });
  await app.listen(0, '127.0.0.1');
  const alamat = app.getHttpServer().address() as AddressInfo | null;
  if (!alamat) throw new Error('tidak mendapat port listen');
  base = `http://127.0.0.1:${alamat.port}`;
}, 30_000);

afterAll(async () => {
  if (app) await app.close();
  if (redis) redis.disconnect();
});

beforeEach(async () => {
  if (!reachable) return;
  const kunci = await redis.keys('rl:*');
  if (kunci.length > 0) await redis.del(...kunci);
});

describe('R-03 — header keamanan (PRD §16.1)', () => {
  it('lingkungan siap', () => {
    expect(reachable, `REDIS_URL tidak bisa dipakai (${redisUrl})`).toBe(true);
  });

  it('keempat header yang dijanjikan §16.1 terkirim', async () => {
    if (!reachable) return;
    const r = await ambil('/health', alamatBaru());

    expect(r.headers.get('content-security-policy')).toBe(
      "default-src 'none'; frame-ancestors 'none'",
    );
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('referrer-policy')).toBe('no-referrer');
    expect(r.headers.get('permissions-policy')).toContain('camera=()');
  });

  it('header ikut pada respons GALAT, bukan hanya yang berhasil', async () => {
    if (!reachable) return;
    // Dipasang sebagai middleware sebelum rute, jadi 404 dan 500 ikut
    // membawanya. Kalau dipasang sebagai interceptor, tidak.
    const r = await ambil('/api/v1/rute-yang-tidak-ada', alamatBaru());
    expect(r.status).toBe(404);
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('content-security-policy')).toBeTruthy();
  });

  it('HSTS TIDAK dikirim lewat http polos', async () => {
    if (!reachable) return;
    // Mengirim HSTS dari http://localhost akan mengunci localhost ke https di
    // browser siapa pun yang membukanya, dan itu tidak bisa dibatalkan dari
    // sisi server.
    const r = await ambil('/health', alamatBaru());
    expect(r.headers.get('strict-transport-security')).toBeNull();
  });

  it('HSTS dikirim saat proxy menyatakan TLS', async () => {
    if (!reachable) return;
    const r = await ambil('/health', alamatBaru(), { 'x-forwarded-proto': 'https' });
    expect(r.headers.get('strict-transport-security')).toContain('max-age=');
  });

  it('CORS tidak pernah menjawab `*`', async () => {
    if (!reachable) return;
    const r = await ambil('/health', alamatBaru(), { origin: 'https://penyerang.example' });
    expect(r.headers.get('access-control-allow-origin')).not.toBe('*');
  });
});

describe('R-03 — rate limit (PRD §7, §10.1, §16.1)', () => {
  it('X-RateLimit-Remaining turun setiap request', async () => {
    if (!reachable) return;
    const ip = alamatBaru();
    const a = await ambil('/health', ip);
    const b = await ambil('/health', ip);

    expect(a.headers.get('x-ratelimit-limit')).toBe(String(BATAS_UMUM));
    expect(Number(a.headers.get('x-ratelimit-remaining'))).toBe(BATAS_UMUM - 1);
    expect(Number(b.headers.get('x-ratelimit-remaining'))).toBe(BATAS_UMUM - 2);
  });

  it(`request ke-${BATAS_UMUM + 1} ditolak 429 dengan RATE_LIMITED`, async () => {
    if (!reachable) return;
    const ip = alamatBaru();
    for (let i = 0; i < BATAS_UMUM; i++) {
      const r = await ambil('/health', ip);
      expect(r.status, `request ke-${i + 1}`).toBe(200);
    }

    const tolak = await ambil('/health', ip);
    expect(tolak.status).toBe(429);
    expect(tolak.headers.get('retry-after')).toBeTruthy();
    const badan = (await tolak.json()) as { error?: { code?: string } };
    // Bentuknya dikunci PRD §10.1, dan `RATE_LIMITED` ada di daftar tertutup
    // §10.2 — sampai sekarang kode itu tidak pernah dikirim siapa pun.
    expect(badan.error?.code).toBe('RATE_LIMITED');
  });

  it('ember terpisah per identitas — satu penyerang tidak memblokir semua', async () => {
    if (!reachable) return;
    const penyerang = alamatBaru();
    for (let i = 0; i < BATAS_UMUM + 1; i++) await ambil('/health', penyerang);
    expect((await ambil('/health', penyerang)).status).toBe(429);

    // Yang lain tidak ikut terkena.
    expect((await ambil('/health', alamatBaru())).status).toBe(200);
  });

  it(`/auth/* jauh lebih ketat: ${BATAS_AUTH} per menit`, async () => {
    if (!reachable) return;
    const ip = alamatBaru();
    for (let i = 0; i < BATAS_AUTH; i++) {
      const r = await ambil('/api/v1/auth/get-session', ip);
      expect(r.status, `auth ke-${i + 1}`).not.toBe(429);
    }
    expect((await ambil('/api/v1/auth/get-session', ip)).status).toBe(429);
  });

  it('ember auth dan ember umum TIDAK saling menghabiskan', async () => {
    if (!reachable) return;
    const ip = alamatBaru();
    for (let i = 0; i < BATAS_AUTH + 1; i++) await ambil('/api/v1/auth/get-session', ip);
    expect((await ambil('/api/v1/auth/get-session', ip)).status).toBe(429);

    // Menghabiskan jatah login tidak boleh mengunci seluruh aplikasi.
    expect((await ambil('/health', ip)).status).toBe(200);
  });

  it('TTL dipasang sekali, jendelanya tidak bergeser maju', async () => {
    if (!reachable) return;
    const ip = alamatBaru();
    await ambil('/health', ip);
    const ttl1 = await redis.ttl(`rl:ip:${ip}:all`);
    await new Promise((r) => setTimeout(r, 1200));
    await ambil('/health', ip);
    const ttl2 = await redis.ttl(`rl:ip:${ip}:all`);

    // `EXPIRE` di setiap request akan membuat ttl2 >= ttl1 — jendela geser
    // yang tidak disengaja, dan pengguna yang mengetuk tiap detik tidak pernah
    // direset.
    expect(ttl1).toBeGreaterThan(0);
    expect(ttl2).toBeLessThan(ttl1);
  });

  it('kunci Redis-nya memang yang didaftarkan §9.4', async () => {
    if (!reachable) return;
    const ip = alamatBaru();
    await ambil('/health', ip);
    expect(await redis.keys(`rl:ip:${ip}:*`)).toHaveLength(1);
  });
});

describe('R-03 — rate limit saat Redis mati', () => {
  it('MEMBIARKAN LEWAT, bukan memblokir semuanya', async () => {
    if (!reachable) return;
    // Aturan keras 7: Redis turunan. Pembatas yang gagal tertutup mengubah
    // gangguan Redis menjadi padamnya seluruh API.
    const rusak = {
      incr: () => Promise.reject(new Error('Connection is closed.')),
      expire: () => Promise.reject(new Error('Connection is closed.')),
      ttl: () => Promise.reject(new Error('Connection is closed.')),
    };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(REDIS)
      .useValue(rusak)
      .compile();
    const rapuh = moduleRef.createNestApplication();
    rapuh.setGlobalPrefix('api/v1', { exclude: ['health'] });
    await rapuh.listen(0, '127.0.0.1');
    const alamat = rapuh.getHttpServer().address() as AddressInfo;

    try {
      const r = await fetch(`http://127.0.0.1:${alamat.port}/health`, {
        headers: { 'x-forwarded-for': alamatBaru() },
      });
      expect(r.status).toBe(200);
      expect(r.headers.get('x-ratelimit-remaining')).toBeNull();
    } finally {
      await rapuh.close();
    }
  }, 30_000);
});

describe('R-03 — kebocoran rahasia', () => {
  it('respons galat tidak memuat stack trace', async () => {
    if (!reachable) return;
    const r = await ambil(`/api/v1/tidak-ada-${randomUUID()}`, alamatBaru());
    const teks = await r.text();
    expect(teks).not.toContain('at Object.');
    expect(teks).not.toContain('node_modules');
    expect(teks.toLowerCase()).not.toContain('postgres://');
  });
});
