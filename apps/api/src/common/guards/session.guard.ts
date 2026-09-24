import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { type Kysely, sql } from 'kysely';

import { DATABASE, type DB } from '../../infra/kysely';
import type { UserRole } from './roles.decorator';

export interface SessionRequest {
  headers: Record<string, string | string[] | undefined>;
  /** Diisi guard ini kalau sesinya sah. */
  user?: { id: string; role: UserRole };
}

/**
 * Menetapkan SIAPA pemanggilnya. Tidak menetapkan apa yang boleh ia lakukan —
 * itu `RolesGuard`.
 *
 * **Namanya `SessionGuard`, bukan `JwtGuard`.** `docs/BACKLOG.md` item `A-02`
 * menulis "JwtGuard", dan itu benar saat backlog ditulis. Isu #18 mengganti
 * AU-4 dari JWT + refresh token menjadi sesi server Better-Auth bertoken
 * buram, dan `A-01` menjalankannya. **Tidak ada JWT di sistem ini.** Menamai
 * kelas ini `JwtGuard` berarti menaruh kebohongan di tempat yang paling sering
 * dibaca orang.
 *
 * Token Bearer dicocokkan ke baris `sessions` (kolom `token` UNIQUE sejak
 * migrasi 004), dan masa berlakunya dibandingkan **di dalam SQL** — jam proses
 * Node tidak dipercaya untuk itu.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(@Inject(DATABASE) private readonly db: Kysely<DB>) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<SessionRequest>();
    request.user = await this.resolve(request);
    return true;
  }

  private async resolve(request: SessionRequest): Promise<{ id: string; role: UserRole }> {
    const header = request.headers['authorization'];
    const value = Array.isArray(header) ? header[0] : header;

    if (!value?.startsWith('Bearer ')) {
      throw new UnauthorizedException({
        error: { code: 'UNAUTHENTICATED', message: 'Header Authorization Bearer tidak ada' },
      });
    }

    const user = await resolveSessionToken(this.db, value.slice('Bearer '.length).trim());
    if (!user) {
      throw new UnauthorizedException({
        error: { code: 'UNAUTHENTICATED', message: 'Sesi tidak valid atau sudah berakhir' },
      });
    }
    return user;
  }
}

/**
 * Token sesi → pengguna, atau `null`. SATU-SATUNYA tempat keputusan itu dibuat.
 *
 * Dipakai `SessionGuard` (REST) dan gateway WebSocket (`RT-01`). Dua salinan
 * logika "sesi ini sah?" akan menyimpang — dan yang menyimpang duluan biasanya
 * pemeriksaan `status`, sehingga akun yang ditangguhkan tetap menerima event
 * realtime setelah REST-nya menolak.
 *
 * `null` untuk tiga sebab — tidak ada, kedaluwarsa, ditangguhkan — dan
 * pemanggil TIDAK diberi tahu yang mana: bedanya tidak berguna bagi pengguna
 * yang sah, dan berguna bagi yang menebak-nebak token.
 */
export async function resolveSessionToken(
  db: Kysely<DB>,
  token: string,
): Promise<{ id: string; role: UserRole } | null> {
  if (token.length === 0) return null;

  const row = await db
    .selectFrom('sessions')
    .innerJoin('users', 'users.id', 'sessions.user_id')
    .select(['users.id as id', 'users.role as role', 'users.status as status'])
    .where('sessions.token', '=', token)
    .where(sql<boolean>`sessions.expires_at > now()`)
    .executeTakeFirst();

  if (!row || row.status !== 'active') return null;
  return { id: row.id, role: row.role as UserRole };
}
