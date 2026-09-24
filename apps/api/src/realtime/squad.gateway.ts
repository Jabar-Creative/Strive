import { Inject, Logger, type OnApplicationShutdown } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  type OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Kysely } from 'kysely';
import type { Server, Socket } from 'socket.io';

import { appOrigins } from '../common/app-origin';
import { resolveSessionToken, type UserRole } from '../common/guards';
import { DATABASE, type DB } from '../infra/kysely';
import { SquadReadService } from '../modules/squad';
import { squadRoom } from './realtime.emitter';

/** Path WebSocket, di bawah prefiks API yang sama dengan REST (PRD §10). */
export const WS_PATH = '/api/v1/ws';

/** Seberapa sering izin soket yang sudah tersambung diperiksa ULANG. */
export const PERIKSA_ULANG_MS = 5 * 60_000;

/** Batas `subscribe` per soket per menit. */
export const BATAS_SUBSCRIBE = 30;
const JENDELA_SUBSCRIBE_MS = 60_000;

interface SocketUser {
  id: string;
  role: UserRole;
}

/** Penghitung `subscribe` per soket — jendela tetap 60 detik. */
interface Jatah {
  sampai: number;
  terpakai: number;
}

export interface SubscribeAck {
  ok: boolean;
  error?: { code: string; message: string; details?: Record<string, unknown> };
}

/**
 * Gateway WebSocket — `RT-01`, PRD §7 E15 RT-1 … RT-3.
 *
 * > **WebSocket adalah pelengkap, bukan pengganti.** Setiap layar harus tetap
 * > benar tanpa satu pun event WS.
 *
 * Itu yang membentuk seluruh berkas ini: gateway tidak pernah menjadi
 * satu-satunya jalan ke data apa pun. Ia hanya MEMPERCEPAT kabar bahwa papan
 * squad berubah; keadaannya selalu dibaca dari REST (`GET /squads/:id/leaderboard`).
 *
 * ── Autentikasi di MIDDLEWARE, bukan di `handleConnection` ──
 *
 * Versi pertama memeriksa sesi di `handleConnection`. Itu race: Socket.IO
 * sudah mengirim `connect` ke klien SEBELUM `handleConnection` yang asinkron
 * selesai, jadi klien yang langsung `subscribe` — yang justru perilaku
 * paling wajar — ditolak "belum terverifikasi" di setiap koneksi, bergantung
 * seberapa cepat Postgres menjawab.
 *
 * Middleware (`server.use`) berjalan SEBELUM koneksi berdiri. Soket tanpa
 * sesi sah tidak pernah tersambung sama sekali: klien menerima
 * `connect_error` dengan `data.code`, dan cukup itu untuk memutuskan login
 * ulang atau jatuh ke polling (RT-5).
 *
 * Tokennya dicek lewat `resolveSessionToken` — fungsi yang SAMA dengan
 * `SessionGuard`, bukan salinannya — supaya akun yang ditangguhkan tidak tetap
 * menerima event realtime setelah REST-nya menolak.
 *
 * ── Izin diperiksa ULANG, bukan sekali seumur koneksi ──
 *
 * `subscribe` memeriksa `canRead` satu kali. Itu benar untuk saat itu, dan
 * berhenti benar begitu keadaannya berubah: pengguna yang KELUAR dari squad,
 * ditangguhkan, atau sesinya kedaluwarsa tetap memegang soketnya dan tetap
 * menerima `score.updated` selama soket itu hidup.
 *
 * REST tidak punya masalah itu — `Q-06` memeriksa ulang di setiap request.
 * Jadi komentar di bawah yang menjanjikan "aturan yang SAMA dengan papan
 * REST" hanya benar pada detik pertama. Test `anggota yang sudah KELUAR tidak
 * bisa subscribe lagi` juga hanya menguji langganan BARU.
 *
 * `verifikasiUlang()` menutupnya: tiap `PERIKSA_ULANG_MS` setiap soket lokal
 * diperiksa ulang — sesinya masih sah, dan setiap ruang yang diikutinya masih
 * boleh dibacanya. Yang gagal dikeluarkan dari ruangnya; yang sesinya sudah
 * mati diputus.
 *
 * Dipisah dari timer-nya supaya bisa diuji tanpa menunggu lima menit — pola
 * yang sama dengan `runOnce()` di worker.
 *
 * ── `subscribe` punya jatah ──
 *
 * `RateLimitInterceptor` (`R-03`) hanya berlaku untuk HTTP; ia keluar lebih
 * awal untuk konteks non-HTTP. Tanpa jatah di sini, satu soket yang sah bisa
 * memanggil `subscribe` ribuan kali per detik, dan tiap panggilan menembak
 * `canRead` ke Postgres. Pembatas yang melindungi REST tidak melindungi pintu
 * di sebelahnya.
 *
 * ── RT-3: subscribe ke squad LAIN ditolak ──
 *
 * `SquadReadService.canRead` — aturan yang SAMA dengan papan REST `Q-06`:
 * anggota aktif, atau mentornya. Ditolak dengan balasan ber-`code`, BUKAN
 * dengan memutus soketnya: klien yang salah kirim satu `squad_id` tidak pantas
 * kehilangan langganan squad-nya sendiri.
 */
@WebSocketGateway({
  path: WS_PATH,
  // `appOrigins()`, sumber yang sama dengan REST. Sebelumnya ekspresi
  // `process.env['APP_URL'] ?? …` disalin ke sini — dan lubang string
  // kosongnya (`cors` membaca origin falsy sebagai `*`) ikut tersalin
  // (temuan audit R-03).
  cors: { origin: appOrigins(), credentials: true },
})
export class SquadGateway implements OnGatewayInit, OnApplicationShutdown {
  private readonly log = new Logger(SquadGateway.name);

  /**
   * Server Socket.IO instance ini. Request handler TIDAK memakainya untuk
   * mengirim event — itu tugas outbox worker lewat `RealtimeEmitter` (RT-4).
   * Ia ada untuk satu hal: membuktikan di test bahwa event yang dikirim DARI
   * satu instance sampai ke klien di instance LAIN (RT-2).
   */
  @WebSocketServer()
  server!: Server;

  constructor(
    @Inject(DATABASE) private readonly db: Kysely<DB>,
    private readonly squads: SquadReadService,
  ) {}

  private timer?: ReturnType<typeof setInterval>;

  afterInit(server: Server): void {
    // Timer TIDAK menahan proses tetap hidup: `unref()` supaya `app.close()`
    // tidak menggantung menunggu interval berikutnya.
    this.timer = setInterval(() => {
      void this.verifikasiUlang().catch((err: unknown) => {
        this.log.warn(`Verifikasi ulang izin soket gagal: ${String(err)}`);
      });
    }, PERIKSA_ULANG_MS);
    this.timer.unref();

    server.use((socket, next) => {
      resolveSessionToken(this.db, tokenDari(socket))
        .then((user) => {
          if (!user) {
            const err = new Error('Sesi tidak valid atau sudah berakhir') as Error & {
              data?: unknown;
            };
            err.data = { code: 'UNAUTHENTICATED' };
            next(err);
            return;
          }
          (socket.data as { user?: SocketUser }).user = user;
          next();
        })
        // Galat database bukan "sesi tidak sah" — jangan sampai klien dipaksa
        // login ulang karena Postgres sedang lambat. Kode berbeda, supaya
        // klien cukup jatuh ke polling.
        .catch(() => {
          const err = new Error('Verifikasi sesi gagal sementara') as Error & { data?: unknown };
          err.data = { code: 'PROVIDER_UNAVAILABLE' };
          next(err);
        });
    });
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /**
   * Memeriksa ulang setiap soket LOKAL instance ini.
   *
   * Lokal, bukan global, dan itu benar: tiap instance memegang soketnya
   * sendiri, jadi bersama-sama mereka menutupi semuanya tanpa satu instance
   * pun perlu tahu tentang yang lain.
   */
  async verifikasiUlang(): Promise<{ diperiksa: number; dikeluarkan: number; diputus: number }> {
    const hasil = { diperiksa: 0, dikeluarkan: 0, diputus: 0 };
    if (!this.server) return hasil;

    for (const socket of this.server.sockets.sockets.values()) {
      const user = (socket.data as { user?: SocketUser }).user;
      if (!user) continue;
      hasil.diperiksa += 1;

      // Sesi dulu: yang sesinya mati tidak perlu diperiksa per-ruang.
      const masihSah = await resolveSessionToken(this.db, tokenDari(socket));
      if (!masihSah || masihSah.id !== user.id) {
        socket.disconnect(true);
        hasil.diputus += 1;
        continue;
      }

      for (const room of socket.rooms) {
        if (!room.startsWith('squad:')) continue;
        const squadId = room.slice('squad:'.length);
        if (!(await this.squads.canRead(squadId, user))) {
          await socket.leave(room);
          hasil.dikeluarkan += 1;
          this.log.log(`Soket ${user.id} dikeluarkan dari ${room} — izinnya sudah tidak berlaku`);
        }
      }
    }
    return hasil;
  }

  @SubscribeMessage('subscribe')
  async subscribe(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { squad_id?: unknown } | undefined,
  ): Promise<SubscribeAck> {
    // Middleware menjamin ini terisi untuk setiap soket yang tersambung.
    // Diperiksa tetap, karena `socket.data` bertipe bebas dan pemeriksaan yang
    // hilang di sini berarti `canRead` menerima `undefined` sebagai aktor.
    const user = (socket.data as { user?: SocketUser }).user;
    if (!user) {
      return { ok: false, error: { code: 'UNAUTHENTICATED', message: 'Sesi tidak ada' } };
    }

    if (!adaJatah(socket)) {
      return {
        ok: false,
        error: {
          code: 'RATE_LIMITED',
          message: 'Terlalu banyak permintaan subscribe',
          details: { limit: BATAS_SUBSCRIBE, window_seconds: JENDELA_SUBSCRIBE_MS / 1000 },
        },
      };
    }

    const squadId = body?.squad_id;
    if (typeof squadId !== 'string' || squadId.length === 0) {
      return {
        ok: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'squad_id wajib',
          details: { field: 'squad_id' },
        },
      };
    }

    if (!(await this.squads.canRead(squadId, user))) {
      this.log.warn(
        `Pengguna ${user.id} mencoba berlangganan squad ${squadId} yang bukan miliknya`,
      );
      return {
        ok: false,
        error: {
          code: 'FORBIDDEN_ROLE',
          message: 'Kanal squad hanya untuk anggotanya sendiri',
          details: { squad_id: squadId },
        },
      };
    }

    await socket.join(squadRoom(squadId));
    return { ok: true };
  }
}

/**
 * Jatah `subscribe` per soket, jendela tetap 60 detik.
 *
 * Disimpan di `socket.data`, bukan Redis: yang dibatasi SATU soket, dan soket
 * itu hidup di satu instance. Memindahkannya ke Redis akan menambah satu
 * perjalanan jaringan untuk melindungi dari sesuatu yang tidak bisa menyebar
 * lintas instance.
 */
function adaJatah(socket: Socket): boolean {
  const data = socket.data as { jatah?: Jatah };
  const kini = Date.now();
  if (!data.jatah || kini > data.jatah.sampai) {
    data.jatah = { sampai: kini + JENDELA_SUBSCRIBE_MS, terpakai: 0 };
  }
  data.jatah.terpakai += 1;
  return data.jatah.terpakai <= BATAS_SUBSCRIBE;
}

/**
 * Token dari `handshake.auth.token` (cara Socket.IO) atau header
 * `Authorization: Bearer` (paritas dengan REST).
 *
 * Tidak dari query string: URL tercatat di log akses proxy, dan token sesi di
 * sana adalah kunci akun yang tersimpan di tempat yang dibaca banyak orang.
 */
function tokenDari(socket: Socket): string {
  const dariAuth = (socket.handshake.auth as { token?: unknown } | undefined)?.token;
  if (typeof dariAuth === 'string') return dariAuth.trim();

  const header = socket.handshake.headers['authorization'];
  const nilai = Array.isArray(header) ? header[0] : header;
  if (typeof nilai === 'string' && nilai.startsWith('Bearer ')) {
    return nilai.slice('Bearer '.length).trim();
  }
  return '';
}
