import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type Redis from 'ioredis';
import type { Server, ServerOptions } from 'socket.io';

import { createRedis } from '../infra/redis';

/**
 * Adapter Socket.IO di atas Redis pub/sub — `RT-01`, PRD RT-2.
 *
 * > **RT-2** Redis pub/sub sebagai adapter agar bisa jalan multi-instance
 * > **sejak hari pertama**, meski awalnya satu instance.
 *
 * Tanpa adapter ini, `server.to('squad:X').emit(...)` hanya sampai ke klien
 * yang tersambung ke INSTANCE YANG SAMA. Dengan dua instance di belakang load
 * balancer, separuh anggota squad tidak pernah menerima pembaruan — dan tidak
 * ada galat apa pun, karena dari sudut pandang tiap instance semuanya
 * berhasil terkirim.
 *
 * ── Dua koneksi Redis KHUSUS, bukan klien `REDIS` bersama ──
 *
 * Koneksi yang sedang `SUBSCRIBE` tidak bisa menjalankan perintah biasa sama
 * sekali. Memakai klien bersama untuk sisi subscriber akan mematikan setiap
 * `ZADD` papan peringkat di proses yang sama, dengan pesan galat yang
 * menunjuk ke Redis, bukan ke WebSocket.
 */
export class RedisIoAdapter extends IoAdapter {
  private pub?: Redis;
  private sub?: Redis;
  private adapter?: ReturnType<typeof createAdapter>;

  constructor(
    app: INestApplicationContext,
    private readonly redisUrl?: string,
  ) {
    super(app);
  }

  /**
   * WAJIB ditunggu sebelum `app.listen()`.
   *
   * `createRedis()` memakai `enableOfflineQueue: false` (Redis turunan, gagal
   * cepat). Perintah yang dikirim sebelum koneksi siap DITOLAK, bukan
   * diantrekan — jadi adapter yang dipasang sebelum `ready` kehilangan
   * langganannya diam-diam.
   */
  async connect(): Promise<void> {
    this.pub = createRedis(this.redisUrl);
    this.sub = this.pub.duplicate();
    await Promise.all([siap(this.pub), siap(this.sub)]);
    this.adapter = createAdapter(this.pub, this.sub);
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    if (!this.adapter) {
      throw new Error('RedisIoAdapter.connect() belum ditunggu sebelum server dibuat');
    }
    const server = super.createIOServer(port, options) as Server;
    server.adapter(this.adapter);
    return server;
  }

  /**
   * Dipanggil Nest saat aplikasi ditutup. Koneksi Redis milik adapter ikut
   * ditutup DI SINI — kalau tidak, `app.close()` selesai tapi proses tidak
   * pernah keluar, karena dua soket Redis masih terbuka.
   */
  override async close(server: Server): Promise<void> {
    await super.close(server);
    this.pub?.disconnect();
    this.sub?.disconnect();
  }
}

function siap(r: Redis): Promise<void> {
  if (r.status === 'ready') return Promise.resolve();
  return new Promise((resolve, reject) => {
    r.once('ready', () => resolve());
    r.once('error', reject);
  });
}
