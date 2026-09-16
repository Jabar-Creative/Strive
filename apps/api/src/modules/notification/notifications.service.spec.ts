import { beforeEach, describe, expect, it, vi } from 'vitest';
// Sama seperti notifications.service.ts: `infra/kysely` bukan modul domain,
// lihat komentar lengkap di sana.
// eslint-disable-next-line no-restricted-imports
import type { Database } from '../../infra/kysely';
import {
  NotificationCursorError,
  NotificationOwnershipError,
  NotificationsService,
  type CreateNotificationInput,
} from './notifications.service';
import type { ResendMailerService } from './resend-mailer.service';

/**
 * Lewati delay retry sungguhan (300ms/600ms) di test — `retryDelayMs` sengaja
 * `protected`, bukan parameter konstruktor (lihat komentar di
 * notifications.service.ts kenapa versi parameter-konstruktor gagal di-boot
 * Nest DI).
 */
class TestableNotificationsService extends NotificationsService {
  protected override retryDelayMs(): number {
    return 0;
  }
}

/**
 * Query builder Kysely palsu: setiap method chaining (`values`, `where`,
 * `orderBy`, dst) mengembalikan dirinya sendiri, method terminal
 * (`execute`/`executeTakeFirst`/`executeTakeFirstOrThrow`) mengembalikan
 * `result` yang dikonfigurasi test.
 *
 * INI TEST UNIT, BUKAN INTEGRASI: mem-verifikasi orkestrasi
 * NotificationsService (jalur retry, kapan audit_log ditulis, kepemilikan)
 * lewat mock — BUKAN membuktikan SQL yang dihasilkan Kysely benar terhadap
 * Postgres sungguhan. Docker Desktop tidak menyala di lingkungan kerja sesi
 * ini (`docker info` gagal connect ke named pipe), jadi test integrasi DB
 * sungguhan TIDAK dijalankan — lihat laporan PR N-01.
 */
function chainable<T>(result: T | Error) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of [
    'values',
    'select',
    'selectAll',
    'set',
    'where',
    'orderBy',
    'limit',
    'returningAll',
  ]) {
    chain[method] = vi.fn(() => chain);
  }
  const resolve = () => {
    if (result instanceof Error) throw result;
    return result;
  };
  chain['execute'] = vi.fn(async () => resolve());
  chain['executeTakeFirst'] = vi.fn(async () => resolve());
  chain['executeTakeFirstOrThrow'] = vi.fn(async () => resolve());
  return chain;
}

interface MockDb {
  insertInto: ReturnType<typeof vi.fn>;
  selectFrom: ReturnType<typeof vi.fn>;
  updateTable: ReturnType<typeof vi.fn>;
}

function nowRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'aaaaaaaa-0000-4000-8000-000000000001',
    user_id: 'user-1',
    kind: 'streak_warning',
    title: 'Streak-mu hampir putus',
    body: 'Selesaikan 1 lesson lagi hari ini.',
    data: null,
    read_at: null,
    sent_at: null,
    created_at: new Date('2026-09-16T10:00:00.000Z'),
    ...overrides,
  };
}

describe('NotificationsService', () => {
  let mailerSend: ReturnType<typeof vi.fn>;
  let mailer: ResendMailerService;

  beforeEach(() => {
    mailerSend = vi.fn();
    mailer = { send: mailerSend } as unknown as ResendMailerService;
  });

  describe('create()', () => {
    const baseInput: CreateNotificationInput = {
      userId: 'user-1',
      kind: 'streak_warning',
      title: 'Streak-mu hampir putus',
      body: 'Selesaikan 1 lesson lagi hari ini.',
    };

    it('kind in-app-only (league_change) TIDAK memanggil mailer sama sekali', async () => {
      const insertedRow = nowRow({ kind: 'league_change' });
      const db = {
        insertInto: vi.fn(() => chainable(insertedRow)),
        selectFrom: vi.fn(),
        updateTable: vi.fn(),
      } satisfies MockDb;

      const service = new TestableNotificationsService(db as unknown as Database, mailer);
      const result = await service.create({ ...baseInput, kind: 'league_change' });

      expect(mailerSend).not.toHaveBeenCalled();
      expect(db.selectFrom).not.toHaveBeenCalled();
      expect(result.sent_at).toBeNull();
      expect(db.insertInto).toHaveBeenCalledTimes(1);
      expect(db.insertInto).toHaveBeenCalledWith('notifications');
    });

    it('kind streak_warning, kirim sukses di percobaan pertama -> sent_at terisi, tidak ada audit_log', async () => {
      const insertedRow = nowRow();
      const updatedRow = nowRow({ sent_at: new Date('2026-09-16T10:00:01.000Z') });
      const insertChain = chainable(insertedRow);
      const updateChain = chainable(updatedRow);
      const auditInsert = vi.fn(() => chainable({}));

      const db = {
        insertInto: vi.fn((table: string) =>
          table === 'notifications' ? insertChain : auditInsert(),
        ),
        selectFrom: vi.fn(() => chainable({ email: 'mhs@yopmail.com', display_name: 'Budi' })),
        updateTable: vi.fn(() => updateChain),
      } satisfies MockDb;

      mailerSend.mockResolvedValueOnce(undefined);

      const service = new TestableNotificationsService(db as unknown as Database, mailer);
      const result = await service.create(baseInput);

      expect(mailerSend).toHaveBeenCalledTimes(1);
      expect(db.updateTable).toHaveBeenCalledWith('notifications');
      expect(updateChain['set']).toHaveBeenCalledWith({ sent_at: expect.any(Date) });
      expect(auditInsert).not.toHaveBeenCalled();
      expect(result.sent_at).not.toBeNull();
    });

    it('kind streak_warning, mailer gagal 3x -> retry tepat 3x, sent_at TETAP NULL, audit_log ditulis (NO-4)', async () => {
      const insertedRow = nowRow();
      const insertChain = chainable(insertedRow);
      const auditChain = chainable({});
      const auditInsertSpy = vi.fn(() => auditChain);

      const db = {
        insertInto: vi.fn((table: string) =>
          table === 'notifications' ? insertChain : auditInsertSpy(),
        ),
        selectFrom: vi.fn(() => chainable({ email: 'mhs@yopmail.com', display_name: 'Budi' })),
        updateTable: vi.fn(),
      } satisfies MockDb;

      mailerSend.mockRejectedValue(
        new Error('Resend menolak pengiriman (rate_limit_exceeded): terlalu banyak request'),
      );

      const service = new TestableNotificationsService(db as unknown as Database, mailer);
      const result = await service.create(baseInput);

      expect(mailerSend).toHaveBeenCalledTimes(3); // MAX_SEND_ATTEMPTS
      expect(db.updateTable).not.toHaveBeenCalled(); // sent_at TIDAK di-update
      expect(result.sent_at).toBeNull();

      expect(auditInsertSpy).toHaveBeenCalledTimes(1);
      expect(db.insertInto).toHaveBeenCalledWith('audit_log');
      expect(auditChain['values']).toHaveBeenCalledWith(
        expect.objectContaining({
          actor_id: null,
          action: 'notification.email_failed',
          subject_type: 'notifications',
          subject_id: insertedRow.id,
          after: expect.objectContaining({ user_id: baseInput.userId, attempts: 3 }),
        }),
      );
    });

    it('retry berhasil di percobaan ke-2 -> TIDAK ada audit_log, sent_at terisi', async () => {
      const insertedRow = nowRow();
      const updatedRow = nowRow({ sent_at: new Date() });
      const auditInsertSpy = vi.fn(() => chainable({}));

      const db = {
        insertInto: vi.fn((table: string) =>
          table === 'notifications' ? chainable(insertedRow) : auditInsertSpy(),
        ),
        selectFrom: vi.fn(() => chainable({ email: 'mhs@yopmail.com', display_name: 'Budi' })),
        updateTable: vi.fn(() => chainable(updatedRow)),
      } satisfies MockDb;

      mailerSend
        .mockRejectedValueOnce(new Error('timeout jaringan'))
        .mockResolvedValueOnce(undefined);

      const service = new TestableNotificationsService(db as unknown as Database, mailer);
      const result = await service.create(baseInput);

      expect(mailerSend).toHaveBeenCalledTimes(2);
      expect(auditInsertSpy).not.toHaveBeenCalled();
      expect(result.sent_at).not.toBeNull();
    });

    it('kind streak_warning tapi user sudah tidak ada -> dicatat sebagai kegagalan (USER_NOT_FOUND), bukan dilewati diam-diam', async () => {
      const insertedRow = nowRow();
      const auditChain = chainable({});
      const auditInsertSpy = vi.fn(() => auditChain);

      const db = {
        insertInto: vi.fn((table: string) =>
          table === 'notifications' ? chainable(insertedRow) : auditInsertSpy(),
        ),
        selectFrom: vi.fn(() => chainable(undefined)), // user tidak ditemukan
        updateTable: vi.fn(),
      } satisfies MockDb;

      const service = new TestableNotificationsService(db as unknown as Database, mailer);
      const result = await service.create(baseInput);

      expect(mailerSend).not.toHaveBeenCalled();
      expect(result.sent_at).toBeNull();
      expect(auditInsertSpy).toHaveBeenCalledTimes(1);
      expect(auditChain['values']).toHaveBeenCalledWith(
        expect.objectContaining({ after: expect.objectContaining({ reason: 'USER_NOT_FOUND' }) }),
      );
    });
  });

  describe('listForUser()', () => {
    it('mengembalikan next_cursor null kalau baris <= limit', async () => {
      const rows = [nowRow({ id: '1' }), nowRow({ id: '2' })];
      const db = {
        insertInto: vi.fn(),
        selectFrom: vi.fn(() => chainable(rows)),
        updateTable: vi.fn(),
      } satisfies MockDb;

      const service = new TestableNotificationsService(db as unknown as Database, mailer);
      const page = await service.listForUser('user-1', { limit: 20 });

      expect(page.data).toHaveLength(2);
      expect(page.nextCursor).toBeNull();
    });

    it('memotong ke `limit` dan mengembalikan next_cursor yang bisa dipakai ulang kalau baris > limit', async () => {
      const rows = [
        nowRow({ id: 'a', created_at: new Date('2026-09-16T10:00:02.000Z') }),
        nowRow({ id: 'b', created_at: new Date('2026-09-16T10:00:01.000Z') }),
      ];
      const db = {
        insertInto: vi.fn(),
        selectFrom: vi.fn(() => chainable(rows)),
        updateTable: vi.fn(),
      } satisfies MockDb;

      const service = new TestableNotificationsService(db as unknown as Database, mailer);
      const page = await service.listForUser('user-1', { limit: 1 });

      expect(page.data).toHaveLength(1);
      expect(page.data[0]?.id).toBe('a');
      expect(page.nextCursor).not.toBeNull();

      // Cursor harus round-trip: dipakai lagi sebagai input tidak melempar.
      const secondDb = {
        insertInto: vi.fn(),
        selectFrom: vi.fn(() => chainable([])),
        updateTable: vi.fn(),
      } satisfies MockDb;
      const secondService = new TestableNotificationsService(
        secondDb as unknown as Database,
        mailer,
      );
      await expect(
        secondService.listForUser('user-1', { cursor: page.nextCursor!, limit: 1 }),
      ).resolves.toEqual({
        data: [],
        nextCursor: null,
      });
    });

    it('cursor yang rusak melempar NotificationCursorError, bukan 500 mentah', async () => {
      const db = {
        insertInto: vi.fn(),
        selectFrom: vi.fn(() => chainable([])),
        updateTable: vi.fn(),
      } satisfies MockDb;

      const service = new TestableNotificationsService(db as unknown as Database, mailer);
      await expect(
        service.listForUser('user-1', { cursor: 'bukan-base64url-json-valid!!', limit: 20 }),
      ).rejects.toBeInstanceOf(NotificationCursorError);
    });
  });

  describe('markRead()', () => {
    it('sukses menandai baris milik sendiri sebagai sudah dibaca', async () => {
      const updatedRow = nowRow({ read_at: new Date('2026-09-16T11:00:00.000Z') });
      const updateChain = chainable(updatedRow);
      const db = {
        insertInto: vi.fn(),
        selectFrom: vi.fn(),
        updateTable: vi.fn(() => updateChain),
      } satisfies MockDb;

      const service = new TestableNotificationsService(db as unknown as Database, mailer);
      const result = await service.markRead('user-1', updatedRow.id);

      expect(result.read_at).not.toBeNull();
      // WHERE id DAN user_id ada di query yang SAMA — satu query atomik untuk kepemilikan.
      expect(updateChain['where']).toHaveBeenCalledWith('id', '=', updatedRow.id);
      expect(updateChain['where']).toHaveBeenCalledWith('user_id', '=', 'user-1');
    });

    it('0 baris ter-update (tidak ada / bukan milik user) -> NotificationOwnershipError, BUKAN dibedakan dari "tidak ada"', async () => {
      const db = {
        insertInto: vi.fn(),
        selectFrom: vi.fn(),
        updateTable: vi.fn(() => chainable(undefined)),
      } satisfies MockDb;

      const service = new TestableNotificationsService(db as unknown as Database, mailer);
      await expect(service.markRead('user-1', 'notif-milik-orang-lain')).rejects.toBeInstanceOf(
        NotificationOwnershipError,
      );
    });

    it('UUID tidak valid (Postgres 22P02) diperlakukan sebagai tidak ditemukan, bukan 500 mentah', async () => {
      const pgError = Object.assign(new Error('invalid input syntax for type uuid'), {
        code: '22P02',
      });
      const db = {
        insertInto: vi.fn(),
        selectFrom: vi.fn(),
        updateTable: vi.fn(() => chainable(pgError)),
      } satisfies MockDb;

      const service = new TestableNotificationsService(db as unknown as Database, mailer);
      await expect(service.markRead('user-1', 'bukan-uuid')).rejects.toBeInstanceOf(
        NotificationOwnershipError,
      );
    });

    it('error DB lain (bukan 22P02) diteruskan apa adanya, tidak ditelan', async () => {
      const dbError = Object.assign(new Error('connection terminated'), { code: '57P01' });
      const db = {
        insertInto: vi.fn(),
        selectFrom: vi.fn(),
        updateTable: vi.fn(() => chainable(dbError)),
      } satisfies MockDb;

      const service = new TestableNotificationsService(db as unknown as Database, mailer);
      await expect(service.markRead('user-1', 'id-valid')).rejects.toThrow('connection terminated');
    });
  });
});
