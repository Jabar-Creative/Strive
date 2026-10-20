import { Kysely, sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase, type DB } from '../src/infra/kysely';
import { NotificationsService, type ResendMailerService } from '../src/modules/notification';

/**
 * `N-02` terhadap DATABASE NYATA — satu-satunya AC yang tidak bisa dibuktikan
 * dari mock: **"Jumlah belum dibaca akurat"**.
 *
 * Akurat berarti angka itu dihitung SERVER dari tabel sungguhan, bukan
 * dihitung klien dari satu halaman respons (halaman berhenti di `limit`, dan
 * notifikasi belum dibaca pengguna yang lama tidak membuka aplikasi BISA
 * lebih banyak dari halaman pertama — NO-5 membatasi 3/hari, tapi tidak
 * membatasi berapa hari ia tidak membukanya).
 *
 * Karena itu respons GET /notifications ditambah field `unread_count` yang
 * dihitung `COUNT(*) WHERE read_at IS NULL` — perubahan aditif pada kontrak
 * milik Dev B, mengikuti catatan N-01 bahwa endpoint ini "dirancang supaya
 * bisa langsung dikonsumsi N-02".
 */

const URL_DEV = 'postgres://strive:strive_dev_only@localhost:55432/strive';
const url = process.env['DATABASE_URL_TEST'] ?? process.env['DATABASE_URL'] ?? URL_DEV;

const AKU = '00000000-0000-4000-8000-0000000a0201';
const LAIN = '00000000-0000-4000-8000-0000000a0202';

let db: Kysely<DB>;
let notif: NotificationsService;
let reachable = false;

/**
 * Stub mailer: test ini tidak menyentuh jalur kirim email (`create()` untuk
 * kind tanpa email tidak pernah memanggil mailer), dan service tidak punya
 * jalur lain yang memakainya. Cast eksplisit supaya jelas ini BUKAN
 * ResendMailerService sungguhan.
 */
const mailerPalsu = { send: async () => undefined } as unknown as ResendMailerService;

async function sisipNotifikasi(
  userId: string,
  baris: ReadonlyArray<{ kind: string; judul: string; sudahDibaca?: boolean; detikLalu?: number }>,
) {
  const now = Date.now();
  await db
    .insertInto('notifications')
    .values(
      baris.map((b, i) => ({
        user_id: userId,
        kind: b.kind,
        title: b.judul,
        body: 'isi',
        read_at: b.sudahDibaca ? new Date(now - 60_000) : null,
        created_at: new Date(now - (b.detikLalu ?? 60 - i) * 1000),
      })),
    )
    .execute();
}

beforeAll(async () => {
  db = createDatabase(url);
  notif = new NotificationsService(db, mailerPalsu);
  try {
    await db.selectFrom('notifications').select('id').limit(1).execute();
    reachable = true;
  } catch {
    reachable = false;
  }
});

afterAll(async () => {
  if (db) await db.destroy();
});

beforeEach(async () => {
  if (!reachable) return;
  await sql`TRUNCATE users, notifications RESTART IDENTITY CASCADE`.execute(db);
  await db
    .insertInto('users')
    .values([
      { id: AKU, email: 'n02a@uji.test', display_name: 'Aku' },
      { id: LAIN, email: 'n02b@uji.test', display_name: 'Lain' },
    ])
    .execute();
});

describe('unread_count (database nyata)', () => {
  it('database siap dipakai', () => {
    expect(reachable, `DATABASE_URL tidak bisa dipakai (${url})`).toBe(true);
  });

  // ── AC "jumlah belum dibaca akurat" ─────────────────────────────────────
  it('menghitung belum dibaca milik pengguna ini saja, terpisah dari isi halaman', async () => {
    if (!reachable) return;
    await sisipNotifikasi(AKU, [
      { kind: 'streak_warning', judul: 'Streak akan putus', sudahDibaca: false },
      { kind: 'league_change', judul: 'Naik liga', sudahDibaca: false },
      { kind: 'job_done', judul: 'CV selesai', sudahDibaca: true },
    ]);
    // Notifikasi pengguna lain TIDAK boleh ikut terhitung.
    await sisipNotifikasi(LAIN, [
      { kind: 'streak_warning', judul: 'Milik orang lain', sudahDibaca: false },
      { kind: 'streak_warning', judul: 'Milik orang lain 2', sudahDibaca: false },
    ]);

    const halaman = await notif.listForUser(AKU, { limit: 2 });
    expect(halaman.data, 'halaman terpotong limit — unread_count harus tetap akurat').toHaveLength(
      2,
    );
    expect(halaman.unreadCount).toBe(2);
  });

  it('markRead menurunkan unread_count tepat satu, sekali', async () => {
    if (!reachable) return;
    await sisipNotifikasi(AKU, [
      { kind: 'streak_warning', judul: 'A', sudahDibaca: false },
      { kind: 'streak_warning', judul: 'B', sudahDibaca: false },
    ]);

    const pertama = await notif.listForUser(AKU, { limit: 20 });
    const target = pertama.data[0]!;

    await notif.markRead(AKU, target.id);
    expect((await notif.listForUser(AKU, { limit: 20 })).unreadCount).toBe(1);

    // Idempoten (PRD §10.3): menandai ulang tidak boleh mengurangi lagi.
    await notif.markRead(AKU, target.id);
    expect((await notif.listForUser(AKU, { limit: 20 })).unreadCount).toBe(1);
  });

  it('nol belum dibaca saat semuanya sudah dibaca atau kosong', async () => {
    if (!reachable) return;
    await sisipNotifikasi(AKU, [{ kind: 'job_done', judul: 'X', sudahDibaca: true }]);
    expect((await notif.listForUser(AKU, { limit: 20 })).unreadCount).toBe(0);
  });
});
