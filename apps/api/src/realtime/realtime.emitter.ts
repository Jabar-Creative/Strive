import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Emitter } from '@socket.io/redis-emitter';
import type Redis from 'ioredis';

import { createRedis } from '../infra/redis';

/** Nama ruang Socket.IO untuk satu squad — PRD RT-1: `squad:{squad_id}`. */
export const squadRoom = (squadId: string): string => `squad:${squadId}`;

/** Batas menunggu koneksi pertama sebelum event dianggap hilang saja. */
const TUNGGU_SIAP_MS = 5_000;

/**
 * Pengirim event realtime dari proses yang TIDAK punya server Socket.IO —
 * `RT-01`, PRD RT-4.
 *
 * > **RT-4** Event dikirim **oleh outbox worker setelah commit**, bukan dari
 * > request handler.
 *
 * Worker berjalan di `MODE=worker`, tanpa HTTP dan tanpa server WebSocket.
 * `@socket.io/redis-emitter` menerbitkan event ke kanal Redis yang SAMA yang
 * didengarkan `RedisIoAdapter` di setiap instance API — jadi worker bisa
 * mengirim ke ruang `squad:X` tanpa tahu instance mana yang memegang
 * soketnya, atau berapa banyak instance yang ada.
 *
 * Koneksi Redis-nya sendiri, bukan klien `REDIS` bersama: emitter menulis ke
 * kanal pub/sub dengan protokol Socket.IO, dan memisahkannya membuat kegagalan
 * realtime tidak ikut menjatuhkan penulisan papan peringkat.
 *
 * ── Kenapa `publish` dibungkus, bukan dipanggil langsung ──
 *
 * Kalimat di atas — "kegagalan realtime tidak menjatuhkan papan peringkat" —
 * TIDAK benar dengan sendirinya. `Emitter` memanggil
 * `redisClient.publish(channel, msg)` dan **membuang Promise-nya**; klien kita
 * memakai `enableOfflineQueue: false`, jadi saat Redis putus `publish` tidak
 * mengantre melainkan MENOLAK. Promise yang ditolak tanpa `.catch()` menjadi
 * `unhandledRejection`, dan Node 22 mengakhiri prosesnya. Artinya Redis
 * realtime yang mati akan mematikan seluruh worker — termasuk `syncMember`
 * yang sudah selesai dan pembukuan outbox yang belum commit.
 *
 * Jadi yang diberikan ke `Emitter` bukan klien ioredis-nya, melainkan
 * pembungkus tipis yang menangkap penolakan itu. `Emitter` memang hanya
 * memanggil `.publish()` pada apa yang diterimanya (tipenya `any` di
 * pustakanya), jadi tidak ada cast dan tidak ada yang disembunyikan.
 *
 * ── Kenapa pembungkusnya juga MENUNGGU koneksi siap ──
 *
 * Menangkap penolakan saja tidak cukup, dan sempat membuat keadaannya lebih
 * buruk: alasan `publish` menolak paling sering bukan Redis mati, melainkan
 * Redis BELUM SIAP. `createRedis()` menyambung secara asinkron, jadi setiap
 * event yang terbit di milidetik pertama proses worker ditolak — dan dengan
 * `.catch()` saja ia hilang tanpa suara, yang lebih sulit dilihat daripada
 * crash yang digantikannya.
 *
 * Maka penerbitan dirantai pada kesiapan pertama, dengan batas waktu supaya
 * Redis yang tidak pernah hidup tidak menumpuk event di memori selamanya.
 * Setelah sekali siap, `siap` sudah selesai: koneksi yang putus kemudian
 * menolak cepat seperti sebelumnya — itu memang yang diinginkan (RT-5).
 */

@Injectable()
export class RealtimeEmitter implements OnModuleDestroy {
  private readonly log = new Logger(RealtimeEmitter.name);
  private readonly redis: Redis;
  private readonly emitter: Emitter;
  private readonly siap: Promise<void>;

  constructor() {
    this.redis = createRedis();
    // ioredis meneruskan galat koneksi sebagai event 'error'. EventEmitter
    // tanpa pendengar 'error' MELEMPAR — jebakan yang sama dengan di atas,
    // lewat pintu berbeda.
    this.redis.on('error', (err: Error) => {
      this.log.warn(`Koneksi Redis realtime bermasalah: ${err.message}`);
    });

    this.siap = new Promise<void>((resolve) => {
      if (this.redis.status === 'ready') {
        resolve();
        return;
      }
      const selesai = (): void => {
        clearTimeout(batas);
        resolve();
      };
      const batas = setTimeout(selesai, TUNGGU_SIAP_MS);
      // Jangan menahan proses tetap hidup hanya karena timer ini.
      batas.unref();
      this.redis.once('ready', selesai);
    });

    this.emitter = new Emitter({
      publish: (channel: string, msg: unknown): void => {
        void this.siap
          .then(() => this.redis.publish(channel, msg as string | Buffer))
          .catch((err: unknown) => {
            const pesan = err instanceof Error ? err.message : String(err);
            // Peringatan, bukan galat: event realtime yang hilang berarti klien
            // memakai fallback polling 30 detik (RT-5). Datanya tetap benar.
            this.log.warn(`Event realtime ke ${channel} tidak terkirim: ${pesan}`);
          });
      },
    });
  }

  toSquad(squadId: string, event: string, payload: Record<string, unknown>): void {
    this.emitter.to(squadRoom(squadId)).emit(event, payload);
  }

  onModuleDestroy(): void {
    this.redis.disconnect();
  }
}
