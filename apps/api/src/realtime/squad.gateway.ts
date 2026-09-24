import { Inject, Logger } from '@nestjs/common';
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

interface SocketUser {
  id: string;
  role: UserRole;
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
export class SquadGateway implements OnGatewayInit {
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

  afterInit(server: Server): void {
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
