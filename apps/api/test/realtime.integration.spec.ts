import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type Redis from 'ioredis';
import { Kysely, sql } from 'kysely';
import { io, type Socket as ClientSocket } from 'socket.io-client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { KyselyModule, createDatabase, type DB } from '../src/infra/kysely';
import { RedisModule, createRedis } from '../src/infra/redis';
import { LeaderboardService } from '../src/modules/league';
import { SquadModule } from '../src/modules/squad';
import {
  RealtimeEmitter,
  RealtimeModule,
  RedisIoAdapter,
  SquadGateway,
  WS_PATH,
} from '../src/realtime';
import { OutboxWorkerService } from '../src/workers';

/**
 * `RT-01` terhadap dua instance API SUNGGUHAN + Redis nyata — PRD §7 E15.
 *
 * Dua acceptance criteria:
 *   1. Dua instance API berbagi event lewat Redis pub/sub.
 *   2. Klien yang tidak berhak masuk kanal squad lain DITOLAK saat subscribe.
 *
 * Yang pertama tidak bisa dibuktikan dengan satu instance: `server.to(...)`
 * selalu sampai ke klien di proses yang sama, dengan atau tanpa adapter. Jadi
 * dua aplikasi Nest benar-benar dijalankan di dua port berbeda, dan event
 * dikirim dari yang SATU ke klien yang tersambung ke yang LAIN.
 */

const URL_DEV = 'postgres://strive:strive_dev_only@localhost:55432/strive';
const url = process.env['DATABASE_URL_TEST'] ?? process.env['DATABASE_URL'] ?? URL_DEV;
const redisUrl = process.env['REDIS_URL'] ?? 'redis://127.0.0.1:56379';

const ANGGOTA = '00000000-0000-4000-8000-000000017201';
const ORANG_LAIN = '00000000-0000-4000-8000-000000017202';
const MENTOR = '00000000-0000-4000-8000-000000017203';
const MUSIM = '00000000-0000-4000-8000-000000017210';
const SQUAD = '00000000-0000-4000-8000-000000017211';
const SQUAD_LAIN = '00000000-0000-4000-8000-000000017212';

let db: Kysely<DB>;
let redis: Redis;
let appA: INestApplication;
let appB: INestApplication;
let portA = 0;
let portB = 0;
let reachable = false;
const klien: ClientSocket[] = [];

/** Sesi sungguhan di tabel `sessions` — bentuk yang sama dengan REST. */
async function sesi(userId: string): Promise<string> {
  const token = randomUUID();
  await db
    .insertInto('sessions')
    .values({ user_id: userId, token, expires_at: sql`now() + interval '1 day'` })
    .execute();
  return token;
}

/** Menyambung dan MENUNGGU sampai benar-benar tersambung, atau melempar. */
function sambung(port: number, token?: string): Promise<ClientSocket> {
  const s = io(`http://127.0.0.1:${port}`, {
    path: WS_PATH,
    transports: ['websocket'],
    ...(token ? { auth: { token } } : {}),
    reconnection: false,
  });
  klien.push(s);
  return new Promise((resolve, reject) => {
    s.once('connect', () => resolve(s));
    s.once('connect_error', (e) => reject(e));
    setTimeout(() => reject(new Error('timeout menyambung')), 5000);
  });
}

/** Menunggu satu event, atau `null` kalau tidak datang dalam `ms`. */
function tunggu(s: ClientSocket, event: string, ms = 2000): Promise<unknown> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    s.once(event, (payload: unknown) => {
      clearTimeout(t);
      resolve(payload);
    });
  });
}

async function buatApp(): Promise<{ app: INestApplication; port: number }> {
  const moduleRef = await Test.createTestingModule({
    imports: [KyselyModule, RedisModule, SquadModule, RealtimeModule],
  }).compile();
  const app = moduleRef.createNestApplication();
  const adapter = new RedisIoAdapter(app, redisUrl);
  await adapter.connect();
  app.useWebSocketAdapter(adapter);
  await app.listen(0, '127.0.0.1');
  const alamat = app.getHttpServer().address() as AddressInfo | null;
  if (!alamat) throw new Error('server tidak mendapat port');
  return { app, port: alamat.port };
}

beforeAll(async () => {
  db = createDatabase(url);
  redis = createRedis(redisUrl);
  try {
    await db.selectFrom('squads').select('id').limit(1).execute();
    await redis.ping();
    reachable = true;
  } catch {
    reachable = false;
    return;
  }
  process.env['DATABASE_URL'] = url;
  const a = await buatApp();
  const b = await buatApp();
  appA = a.app;
  portA = a.port;
  appB = b.app;
  portB = b.port;
}, 30_000);

afterAll(async () => {
  for (const s of klien.splice(0)) s.disconnect();
  if (appA) await appA.close();
  if (appB) await appB.close();
  if (redis) redis.disconnect();
  if (db) await db.destroy();
});

beforeEach(async () => {
  if (!reachable) return;
  for (const s of klien.splice(0)) s.disconnect();

  // `outbox_events` tidak punya FK ke `users`, jadi ia TIDAK ikut terbawa
  // CASCADE — sisa event dari berkas test lain akan ikut diproses worker di
  // test ujung-ke-ujung di bawah dan mengacaukan hitungannya.
  await sql`TRUNCATE users, league_seasons, squads, outbox_events RESTART IDENTITY CASCADE`.execute(
    db,
  );

  await db
    .insertInto('users')
    .values([
      { id: ANGGOTA, email: 'rt-a@uji.test', display_name: 'Anggota' },
      { id: ORANG_LAIN, email: 'rt-b@uji.test', display_name: 'Lain' },
      { id: MENTOR, email: 'rt-m@uji.test', display_name: 'Mentor', role: 'mentor' },
    ])
    .execute();
  await db
    .insertInto('league_seasons')
    .values({
      id: MUSIM,
      code: '2026-W43',
      starts_at: sql`now() - interval '1 day'`,
      ends_at: sql`now() + interval '6 days'`,
    })
    .execute();
  await db
    .insertInto('squads')
    .values([
      { id: SQUAD, name: 'Squad Aku', season_id: MUSIM, mentor_id: MENTOR },
      { id: SQUAD_LAIN, name: 'Squad Lain', season_id: MUSIM },
    ])
    .execute();
  await db
    .insertInto('squad_members')
    .values([
      { squad_id: SQUAD, user_id: ANGGOTA, weekly_points: 30 },
      { squad_id: SQUAD_LAIN, user_id: ORANG_LAIN },
    ])
    .execute();
});

describe('RT-01 — WS gateway + Redis pub/sub (dua instance nyata)', () => {
  it('database dan Redis siap, kedua instance hidup di port berbeda', () => {
    expect(reachable, `DATABASE_URL/REDIS_URL tidak bisa dipakai (${url})`).toBe(true);
    expect(portA).toBeGreaterThan(0);
    expect(portB).toBeGreaterThan(0);
    expect(portA).not.toBe(portB);
  });

  // ── AC 1: dua instance berbagi event ───────────────────────────────────

  it('AC: event dari instance A sampai ke klien di instance B', async () => {
    if (!reachable) return;
    const s = await sambung(portB, await sesi(ANGGOTA));
    expect(await s.emitWithAck('subscribe', { squad_id: SQUAD })).toEqual({ ok: true });

    const datang = tunggu(s, 'score.updated');
    // Dikirim dari instance A — yang TIDAK memegang soket ini.
    appA.get(SquadGateway).server.to(`squad:${SQUAD}`).emit('score.updated', { squad_id: SQUAD });

    expect(
      await datang,
      'event tidak menyeberang antar-instance — adapter Redis tidak terpasang',
    ).toEqual({ squad_id: SQUAD });
  });

  it('event squad TIDAK bocor ke klien squad lain di instance mana pun', async () => {
    if (!reachable) return;
    const punyaku = await sambung(portA, await sesi(ANGGOTA));
    const punyaDia = await sambung(portB, await sesi(ORANG_LAIN));
    await punyaku.emitWithAck('subscribe', { squad_id: SQUAD });
    await punyaDia.emitWithAck('subscribe', { squad_id: SQUAD_LAIN });

    const salah = tunggu(punyaDia, 'score.updated', 1000);
    const benar = tunggu(punyaku, 'score.updated');
    appA.get(SquadGateway).server.to(`squad:${SQUAD}`).emit('score.updated', { squad_id: SQUAD });

    expect(await benar).toEqual({ squad_id: SQUAD });
    // Adapter yang menyiarkan ke SEMUA soket tetap membuat test di atas hijau.
    expect(await salah, 'siaran menembus batas ruang squad').toBeNull();
  });

  it('RT-4: event dari WORKER (tanpa server WS) sampai ke klien', async () => {
    if (!reachable) return;
    const s = await sambung(portA, await sesi(ANGGOTA));
    await s.emitWithAck('subscribe', { squad_id: SQUAD });

    // `MODE=worker` tidak punya server Socket.IO sama sekali. Emitter menulis
    // ke kanal Redis yang sama yang didengarkan setiap instance API.
    const emitter = new RealtimeEmitter();
    const datang = tunggu(s, 'score.updated');
    emitter.toSquad(SQUAD, 'score.updated', { squad_id: SQUAD, user_id: ANGGOTA });

    expect(await datang).toEqual({ squad_id: SQUAD, user_id: ANGGOTA });
    emitter.onModuleDestroy();
  });

  it('ujung-ke-ujung: baris outbox → worker → klien menerima score.updated', async () => {
    if (!reachable) return;
    const s = await sambung(portB, await sesi(ANGGOTA));
    await s.emitWithAck('subscribe', { squad_id: SQUAD });

    await db
      .insertInto('outbox_events')
      .values({
        topic: 'points.awarded',
        payload: JSON.stringify({ user_id: ANGGOTA, squad_id: SQUAD, season_id: MUSIM }),
      })
      .execute();

    const emitter = new RealtimeEmitter();
    const worker = new OutboxWorkerService(db, new LeaderboardService(db, redis), emitter);
    const datang = tunggu(s, 'score.updated');

    const hasil = await worker.runOnce();
    expect(hasil).toMatchObject({ processed: 1, failed: 0, deadLettered: 0 });

    // Jalur produksi penuh. Satu-satunya jahitan yang tidak tersentuh test
    // `Q-03` maupun test emitter di atas adalah panggilan `toSquad` di dalam
    // handler — dan itu tepat yang dibuktikan di sini.
    expect(await datang).toEqual({ squad_id: SQUAD, user_id: ANGGOTA });
    emitter.onModuleDestroy();
  });

  it('Redis realtime mati tidak menjatuhkan proses pengirimnya', async () => {
    if (!reachable) return;
    const tertangkap: unknown[] = [];
    const pendengar = (err: unknown): void => void tertangkap.push(err);
    process.on('unhandledRejection', pendengar);

    try {
      const emitter = new RealtimeEmitter();
      const s = await sambung(portA, await sesi(ANGGOTA));
      await s.emitWithAck('subscribe', { squad_id: SQUAD });

      // Satu pengiriman yang BERHASIL dulu. Tanpa ini koneksinya mungkin
      // belum pernah siap, `publish` tidak pernah dipanggil sama sekali, dan
      // test ini hijau tanpa menguji apa pun.
      emitter.toSquad(SQUAD, 'score.updated', { squad_id: SQUAD });
      expect(await tunggu(s, 'score.updated')).not.toBeNull();

      emitter.onModuleDestroy(); // koneksinya ditutup — `publish` PASTI menolak
      expect(() => emitter.toSquad(SQUAD, 'score.updated', { squad_id: SQUAD })).not.toThrow();
      await new Promise((r) => setTimeout(r, 300));
    } finally {
      process.off('unhandledRejection', pendengar);
    }

    // `Emitter` membuang Promise dari `publish`. Tanpa pembungkus yang
    // menangkapnya, Redis realtime yang putus mengakhiri SELURUH worker —
    // termasuk papan peringkat dan pembukuan outbox yang tidak ada
    // hubungannya dengan WebSocket.
    expect(tertangkap, 'publish yang gagal menjadi unhandledRejection').toEqual([]);
  });

  // ── AC 2: RT-3, kanal squad lain ditolak ───────────────────────────────

  it('AC: subscribe ke squad ORANG LAIN ditolak', async () => {
    if (!reachable) return;
    const s = await sambung(portA, await sesi(ANGGOTA));

    const ack = (await s.emitWithAck('subscribe', { squad_id: SQUAD_LAIN })) as {
      ok: boolean;
      error?: { code: string };
    };
    expect(ack.ok).toBe(false);
    expect(ack.error?.code).toBe('FORBIDDEN_ROLE');
  });

  it('ditolak berarti TIDAK menerima event kanal itu', async () => {
    if (!reachable) return;
    const s = await sambung(portA, await sesi(ANGGOTA));
    await s.emitWithAck('subscribe', { squad_id: SQUAD_LAIN });

    const datang = tunggu(s, 'score.updated', 1000);
    appA
      .get(SquadGateway)
      .server.to(`squad:${SQUAD_LAIN}`)
      .emit('score.updated', { squad_id: SQUAD_LAIN });

    // Balasan `ok: false` tidak membuktikan apa pun kalau ruangnya tetap
    // dimasuki sebelum pemeriksaannya.
    expect(await datang, 'ditolak tapi tetap menerima event squad itu').toBeNull();
  });

  it('penolakan subscribe TIDAK memutus soketnya', async () => {
    if (!reachable) return;
    const s = await sambung(portA, await sesi(ANGGOTA));
    await s.emitWithAck('subscribe', { squad_id: SQUAD_LAIN });

    // Klien yang salah kirim satu `squad_id` tidak pantas kehilangan
    // langganan squad-nya sendiri.
    expect(s.connected).toBe(true);
    expect(await s.emitWithAck('subscribe', { squad_id: SQUAD })).toEqual({ ok: true });
  });

  it('mentor squad BOLEH — aturan yang sama dengan papan REST (Q-06)', async () => {
    if (!reachable) return;
    const s = await sambung(portA, await sesi(MENTOR));
    expect(await s.emitWithAck('subscribe', { squad_id: SQUAD })).toEqual({ ok: true });

    // Dan hanya squad yang ia bina — peran `mentor` bukan kunci umum.
    const ack = (await s.emitWithAck('subscribe', { squad_id: SQUAD_LAIN })) as { ok: boolean };
    expect(ack.ok).toBe(false);
  });

  it('anggota yang sudah KELUAR tidak bisa subscribe lagi', async () => {
    if (!reachable) return;
    await db
      .updateTable('squad_members')
      .set({ left_at: sql`now()` })
      .where('user_id', '=', ANGGOTA)
      .execute();

    const s = await sambung(portA, await sesi(ANGGOTA));
    const ack = (await s.emitWithAck('subscribe', { squad_id: SQUAD })) as { ok: boolean };
    expect(ack.ok).toBe(false);
  });

  // ── Autentikasi handshake ──────────────────────────────────────────────

  it('tanpa token: koneksi TIDAK PERNAH berdiri', async () => {
    if (!reachable) return;
    const e = await sambung(portA).catch((x: Error) => x);
    expect(e).toBeInstanceOf(Error);
    expect((e as Error & { data?: { code?: string } }).data?.code).toBe('UNAUTHENTICATED');
  });

  it('token karangan ditolak', async () => {
    if (!reachable) return;
    const e = await sambung(portA, randomUUID()).catch((x: Error) => x);
    expect(e).toBeInstanceOf(Error);
  });

  it('akun DITANGGUHKAN ditolak — aturan sesi yang sama dengan REST', async () => {
    if (!reachable) return;
    const token = await sesi(ANGGOTA);
    await db.updateTable('users').set({ status: 'suspended' }).where('id', '=', ANGGOTA).execute();

    // `resolveSessionToken` yang SAMA dipakai REST dan WS. Kalau keduanya
    // punya salinan sendiri, yang menyimpang duluan biasanya pemeriksaan
    // `status` — dan akun yang ditangguhkan tetap menerima event realtime
    // setelah REST-nya menolak.
    const e = await sambung(portA, token).catch((x: Error) => x);
    expect(e).toBeInstanceOf(Error);
  });

  it('sesi KEDALUWARSA ditolak', async () => {
    if (!reachable) return;
    const token = randomUUID();
    await db
      .insertInto('sessions')
      .values({ user_id: ANGGOTA, token, expires_at: sql`now() - interval '1 hour'` })
      .execute();

    const e = await sambung(portA, token).catch((x: Error) => x);
    expect(e).toBeInstanceOf(Error);
  });

  it('token lewat header Authorization: Bearer juga diterima', async () => {
    if (!reachable) return;
    const token = await sesi(ANGGOTA);
    const s = io(`http://127.0.0.1:${portA}`, {
      path: WS_PATH,
      transports: ['websocket'],
      extraHeaders: { Authorization: `Bearer ${token}` },
      reconnection: false,
    });
    klien.push(s);
    await new Promise<void>((resolve, reject) => {
      s.once('connect', () => resolve());
      s.once('connect_error', reject);
      setTimeout(() => reject(new Error('timeout')), 5000);
    });
    expect(await s.emitWithAck('subscribe', { squad_id: SQUAD })).toEqual({ ok: true });
  });

  it('subscribe SEGERA setelah connect berhasil — tidak ada race handshake', async () => {
    if (!reachable) return;
    // Versi pertama gateway memeriksa sesi di `handleConnection`, yang
    // asinkron: Socket.IO sudah mengirim `connect` sebelum pemeriksaannya
    // selesai, jadi klien yang langsung subscribe — perilaku paling wajar —
    // ditolak "belum terverifikasi", bergantung kecepatan Postgres.
    for (let i = 0; i < 5; i++) {
      const s = await sambung(portA, await sesi(ANGGOTA));
      expect(await s.emitWithAck('subscribe', { squad_id: SQUAD }), `percobaan ${i}`).toEqual({
        ok: true,
      });
      s.disconnect();
    }
  });

  it('squad_id yang bukan string ditolak sebagai VALIDATION_ERROR', async () => {
    if (!reachable) return;
    const s = await sambung(portA, await sesi(ANGGOTA));
    for (const busuk of [undefined, null, 42, {}, '']) {
      const ack = (await s.emitWithAck('subscribe', { squad_id: busuk })) as {
        ok: boolean;
        error?: { code: string };
      };
      expect(ack.ok, `squad_id=${String(busuk)}`).toBe(false);
      expect(ack.error?.code).toBe('VALIDATION_ERROR');
    }
  });
});
