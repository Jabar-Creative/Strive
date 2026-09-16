import { Inject, Injectable, Logger } from '@nestjs/common';
import type { NotificationKind } from '@strive/contracts';
import type { Selectable } from 'kysely';
/**
 * `infra/kysely` bukan modul domain (tidak dimiliki fitur mana pun, dipasang
 * @Global() di app.module.ts). Aturan batas modul di eslint.config.mjs
 * dimaksudkan mencegah kopling ANTAR modul domain (mis.
 * `../wallet/coin-ledger.service`), bukan akses ke infrastruktur bersama
 * lewat barrel publiknya (index.ts, yang hanya meng-ekspor ulang modul + tipe
 * DB + token DI, tanpa membuka file internal). Alias `@/*` di tsconfig.json
 * akan menghindari pola ini sama sekali, tapi vitest.config.mts belum
 * mengenalnya (dicoba: `Failed to load url @/infra/kysely` — vite tidak
 * membaca `paths` tsconfig tanpa plugin `vite-tsconfig-paths`). Menambahkan
 * plugin itu menyentuh config bersama semua modul, jadi sengaja TIDAK
 * dilakukan di sini — dilaporkan sebagai gap di laporan PR N-01, bukan
 * diputuskan sepihak.
 */
// eslint-disable-next-line no-restricted-imports -- lihat komentar di atas
import { DATABASE, type DB, type Database, type Json } from '../../infra/kysely';
import { ResendMailerService } from './resend-mailer.service';
import { buildListUnsubscribeHeader, renderNotificationEmail } from './notification-templates.util';

export interface CreateNotificationInput {
  userId: string;
  kind: NotificationKind;
  title: string;
  body: string;
  data?: Json | null;
}

/** Bentuk baris SELECT — `Selectable<>` melepas wrapper `Generated<>`/`ColumnType<>` (id: string, created_at: Date, dst). */
export type NotificationRow = Selectable<DB['notifications']>;

export interface CursorPage<T> {
  data: T[];
  nextCursor: string | null;
}

interface CursorPayload {
  createdAt: string;
  id: string;
}

/**
 * docs/PRD.md §7 E16 NO-2: "Kanal: lonceng in-app (selalu) + email (untuk
 * `streak_warning` dan `job_done`)". `league_change` dan `review_validated`
 * TIDAK PERNAH mengirim email — `sent_at` mereka tetap NULL selamanya, dan
 * itu bukan kegagalan (lihat catatan di notificationSchema).
 */
const EMAIL_ENABLED_KINDS: ReadonlySet<NotificationKind> = new Set(['streak_warning', 'job_done']);

const MAX_SEND_ATTEMPTS = 3;

function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeCursor(raw: string): CursorPayload {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as CursorPayload).createdAt === 'string' &&
      typeof (parsed as CursorPayload).id === 'string'
    ) {
      return parsed as CursorPayload;
    }
  } catch {
    // jatuh ke throw di bawah — pesan tunggal untuk semua bentuk cursor yang rusak
  }
  throw new NotificationCursorError(raw);
}

/** Dilempar sebagai Error biasa (bukan HttpException) — controller yang memutuskan status HTTP-nya. */
export class NotificationCursorError extends Error {
  constructor(readonly rawCursor: string) {
    super('Cursor tidak valid');
  }
}

export class NotificationOwnershipError extends Error {
  constructor(readonly notificationId: string) {
    super('Notifikasi tidak ditemukan');
  }
}

/**
 * `create()` SENGAJA tidak menerima `trx` dari pemanggil.
 *
 * Mengirim email adalah panggilan jaringan lambat (bisa 3x retry dengan
 * backoff) — menahannya di dalam transaksi Postgres pemanggil akan menahan
 * koneksi/lock selama itu, pelanggaran semangat yang sama dengan "tidak ada
 * penulisan Redis di dalam transaksi Postgres" (CLAUDE.md aturan 6). Modul
 * lain yang memicu notifikasi (mis. StreakService untuk `streak_warning`)
 * WAJIB memanggil `create()` SETELAH transaksi bisnisnya sendiri commit —
 * pola waktu yang sama dengan `queue.add()` (CLAUDE.md aturan 10).
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly mailer: ResendMailerService,
  ) {}

  /**
   * Delay eksponensial antar-percobaan (300ms, 600ms).
   *
   * `protected`, BUKAN parameter konstruktor — sempat dicoba sebagai parameter
   * ke-3 dengan default value supaya unit test bisa melewati delay sungguhan,
   * tapi Nest tetap membaca tipe metadata parameter itu (`Function`) sebagai
   * token DI dan gagal resolve saat `AppModule` di-bootstrap sungguhan
   * (`test/app.module.spec.ts` menangkap ini). Method yang di-override lewat
   * subclass tipis di test tidak punya masalah itu.
   */
  protected retryDelayMs(attempt: number): number {
    return 300 * 2 ** (attempt - 1);
  }

  async create(input: CreateNotificationInput): Promise<NotificationRow> {
    const row = await this.db
      .insertInto('notifications')
      .values({
        user_id: input.userId,
        kind: input.kind,
        title: input.title,
        body: input.body,
        data: input.data ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    if (!EMAIL_ENABLED_KINDS.has(input.kind)) {
      // In-app only (NO-2). sent_at NULL di sini BUKAN kegagalan — tidak ada
      // percobaan kirim, jadi tidak ada baris audit_log yang ditulis.
      return row;
    }

    const user = await this.db
      .selectFrom('users')
      .select(['email', 'display_name'])
      .where('id', '=', input.userId)
      .executeTakeFirst();

    if (!user) {
      // Data tidak konsisten (user terhapus setelah notifikasi ini dipicu).
      // Dicatat sebagai kegagalan sungguhan, bukan diam-diam dilewati (NO-4).
      await this.recordEmailFailure(row.id, input.userId, 'USER_NOT_FOUND');
      return row;
    }

    const sent = await this.sendWithRetry(user.email, input, row.id);
    if (!sent) {
      return row; // sent_at tetap NULL, audit_log sudah ditulis di sendWithRetry
    }

    return this.db
      .updateTable('notifications')
      .set({ sent_at: new Date() })
      .where('id', '=', row.id)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /**
   * Cursor-paginated, MILIK SENDIRI SAJA — `user_id = userId` selalu ada di
   * WHERE, tidak bisa dilewati dari controller (CLAUDE.md §Guard vs
   * kepemilikan: kepemilikan dicek di service, bukan cuma guard).
   */
  async listForUser(
    userId: string,
    options: { cursor?: string; limit: number },
  ): Promise<CursorPage<NotificationRow>> {
    let query = this.db
      .selectFrom('notifications')
      .selectAll()
      .where('user_id', '=', userId)
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(options.limit + 1);

    if (options.cursor) {
      const cursor = decodeCursor(options.cursor);
      const cursorCreatedAt = new Date(cursor.createdAt);
      query = query.where((eb) =>
        eb.or([
          eb('created_at', '<', cursorCreatedAt),
          eb.and([eb('created_at', '=', cursorCreatedAt), eb('id', '<', cursor.id)]),
        ]),
      );
    }

    const rows = await query.execute();
    const hasMore = rows.length > options.limit;
    const page = hasMore ? rows.slice(0, options.limit) : rows;
    const last = page.at(-1);

    return {
      data: page,
      nextCursor:
        hasMore && last
          ? encodeCursor({ createdAt: last.created_at.toISOString(), id: last.id })
          : null,
    };
  }

  /**
   * UPDATE dengan `id` DAN `user_id` di WHERE yang sama: satu query atomik
   * yang sekaligus menjadi pemeriksaan kepemilikan (tidak ada jendela
   * SELECT-lalu-UPDATE yang bisa balapan). Kalau 0 baris ter-update, itu
   * berarti "tidak ada" ATAU "bukan milik pengguna ini" — sengaja tidak
   * dibedakan ke client, supaya ID notifikasi orang lain tidak bisa
   * dikonfirmasi keberadaannya lewat respons yang berbeda.
   */
  async markRead(userId: string, notificationId: string): Promise<NotificationRow> {
    let updated: NotificationRow | undefined;
    try {
      updated = await this.db
        .updateTable('notifications')
        .set({ read_at: new Date() })
        .where('id', '=', notificationId)
        .where('user_id', '=', userId)
        .returningAll()
        .executeTakeFirst();
    } catch (error) {
      // Postgres 22P02 = invalid_text_representation (UUID malformed).
      // Diperlakukan sama seperti "tidak ditemukan", bukan 500 mentah.
      if (this.isInvalidUuidError(error)) {
        throw new NotificationOwnershipError(notificationId);
      }
      throw error;
    }

    if (!updated) {
      throw new NotificationOwnershipError(notificationId);
    }
    return updated;
  }

  private isInvalidUuidError(error: unknown): boolean {
    return (
      typeof error === 'object' && error !== null && (error as { code?: string }).code === '22P02'
    );
  }

  private async sendWithRetry(
    to: string,
    input: CreateNotificationInput,
    notificationId: string,
  ): Promise<boolean> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_SEND_ATTEMPTS; attempt++) {
      try {
        await this.mailer.send({
          to,
          subject: input.title,
          html: renderNotificationEmail(input.kind, {
            userId: input.userId,
            title: input.title,
            body: input.body,
          }),
          listUnsubscribe: buildListUnsubscribeHeader(input.userId),
        });
        return true;
      } catch (error) {
        lastError = error;
        this.logger.warn(
          `Percobaan ${attempt}/${MAX_SEND_ATTEMPTS} kirim email notifikasi ${notificationId} gagal: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        if (attempt < MAX_SEND_ATTEMPTS) {
          await this.delay(this.retryDelayMs(attempt));
        }
      }
    }

    await this.recordEmailFailure(
      notificationId,
      input.userId,
      lastError instanceof Error ? lastError.message : String(lastError),
    );
    return false;
  }

  private delay(ms: number): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * NO-4: "Kegagalan kirim di-retry 3x lalu dicatat — tidak hilang diam-diam."
   * `actor_id = null` karena ini kegagalan SISTEM (vendor email), bukan aksi
   * seorang pengguna — audit_log.actor_id memang nullable untuk kasus ini.
   */
  private async recordEmailFailure(
    notificationId: string,
    userId: string,
    reason: string,
  ): Promise<void> {
    await this.db
      .insertInto('audit_log')
      .values({
        actor_id: null,
        action: 'notification.email_failed',
        subject_type: 'notifications',
        subject_id: notificationId,
        before: null,
        after: { user_id: userId, reason, attempts: MAX_SEND_ATTEMPTS },
      })
      .execute();
  }
}
