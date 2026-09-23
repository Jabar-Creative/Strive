import { Kysely, sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase, type DB } from '../src/infra/kysely';
import { CoinLedgerService, InvalidCursorError, WalletService } from '../src/modules/wallet';

/**
 * `WalletService` terhadap DATABASE NYATA.
 *
 * Yang diuji di sini adalah janji `C-02` yang paling mudah dilanggar tanpa
 * ketahuan: **riwayat bisa ditelusuri sampai entri pertama**. Test yang hanya
 * mengambil halaman pertama akan hijau meski paginasinya berputar-putar atau
 * melewatkan baris — jadi di bawah seluruh riwayat benar-benar ditelusuri dan
 * dicocokkan dengan isi tabelnya.
 */

const URL_DEV = 'postgres://strive:strive_dev_only@localhost:55432/strive';
const url = process.env['DATABASE_URL_TEST'] ?? process.env['DATABASE_URL'] ?? URL_DEV;

let db: Kysely<DB>;
let wallet: WalletService;
let coins: CoinLedgerService;
let reachable = false;

const USER = '00000000-0000-4000-8000-0000000c0201';
const LAIN = '00000000-0000-4000-8000-0000000c0202';

beforeAll(async () => {
  db = createDatabase(url);
  wallet = new WalletService(db);
  coins = new CoinLedgerService();
  try {
    await db.selectFrom('coin_ledger').select('id').limit(1).execute();
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
  await sql`TRUNCATE users RESTART IDENTITY CASCADE`.execute(db);
  for (const [id, email] of [
    [USER, 'w1@uji.test'],
    [LAIN, 'w2@uji.test'],
  ]) {
    await db.insertInto('users').values({ id: id!, email: email!, display_name: 'Uji' }).execute();
  }
});

/** Menyemai LEWAT ledger, tidak pernah menulis coin_balance langsung (aturan 2). */
async function semai(userId: string, n: number) {
  for (let i = 0; i < n; i++) {
    await db.transaction().execute((trx) =>
      coins.write(trx, {
        userId,
        entryType: 'earn_lesson',
        amount: 10,
        // `'attempt'`, bukan `'lesson'`: `RefType` tidak memuat `'lesson'`,
        // jadi fixture lama memakai nilai yang PRODUKSI tidak pernah bisa
        // menulis — dan kolomnya `text`, jadi database tidak menolaknya.
        refType: 'attempt',
        refId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      }),
    );
  }
}

describe('WalletService (database nyata)', () => {
  it('database siap dipakai', () => {
    expect(reachable, `DATABASE_URL tidak bisa dipakai (${url})`).toBe(true);
  });

  it('GET /wallet: saldo + paling banyak 20 entri terakhir', async () => {
    if (!reachable) return;
    await semai(USER, 25);

    const hasil = await wallet.overview(USER);
    expect(hasil.balance).toBe(250);
    expect(hasil.recent_entries).toHaveLength(20);
    // Terbaru dulu.
    expect(Number(hasil.recent_entries[0]!.id)).toBeGreaterThan(
      Number(hasil.recent_entries[19]!.id),
    );
  });

  it('setiap entri menampilkan jenis, jumlah, saldo setelah, dan referensinya', async () => {
    if (!reachable) return;
    await semai(USER, 1);
    const [e] = (await wallet.ledger(USER)).data;

    expect(e).toMatchObject({
      entry_type: 'earn_lesson',
      amount: 10,
      balance_after: 10,
      ref_type: 'lesson',
    });
    expect(e!.ref_id).toBeTruthy();
    expect(e!.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // bigserial direpresentasikan STRING — melewati MAX_SAFE_INTEGER itu nyata
    // untuk tabel yang tumbuh seumur produk.
    expect(typeof e!.id).toBe('string');
  });

  // ── AC inti ─────────────────────────────────────────────────────────────
  it('AC: riwayat bisa ditelusuri sampai entri PERTAMA tanpa offset', async () => {
    if (!reachable) return;
    const TOTAL = 47;
    await semai(USER, TOTAL);

    const terkumpul: string[] = [];
    let cursor: string | undefined;
    let halaman = 0;

    do {
      const h = await wallet.ledger(USER, { cursor, limit: 10 });
      terkumpul.push(...h.data.map((d) => d.id));
      cursor = h.next_cursor ?? undefined;
      halaman++;
      expect(halaman, 'paginasi tidak berhenti — kemungkinan berputar').toBeLessThan(20);
    } while (cursor);

    // Tiga hal sekaligus: tidak ada yang hilang, tidak ada yang ganda, dan
    // urutannya menurun tanpa putus. Hanya menghitung jumlah tidak cukup —
    // paginasi yang melewatkan satu baris lalu mengulang baris lain akan lolos.
    expect(terkumpul).toHaveLength(TOTAL);
    expect(new Set(terkumpul).size).toBe(TOTAL);

    const semua = await db
      .selectFrom('coin_ledger')
      .select('id')
      .where('user_id', '=', USER)
      .orderBy('id', 'desc')
      .execute();
    expect(terkumpul).toEqual(semua.map((r) => String(r.id)));
  });

  it('halaman terakhir mengembalikan next_cursor null, bukan cursor kosong', async () => {
    if (!reachable) return;
    await semai(USER, 3);
    const h = await wallet.ledger(USER, { limit: 10 });
    expect(h.data).toHaveLength(3);
    expect(h.next_cursor).toBeNull();
  });

  it('riwayat pengguna lain TIDAK pernah ikut terbawa', async () => {
    if (!reachable) return;
    await semai(USER, 5);
    await semai(LAIN, 5);

    const milikku = await wallet.ledger(USER, { limit: 50 });
    expect(milikku.data).toHaveLength(5);

    const idLain = new Set(
      (await db.selectFrom('coin_ledger').select('id').where('user_id', '=', LAIN).execute()).map(
        (r) => String(r.id),
      ),
    );
    for (const e of milikku.data) {
      expect(idLain.has(e.id), 'entri pengguna lain bocor ke riwayat ini').toBe(false);
    }
  });

  it('cursor dari sumber lain ditolak, bukan dipakai sebagai id', async () => {
    if (!reachable) return;
    await semai(USER, 3);

    // Tanpa prefiks, cursor endpoint lain akan diam-diam jadi id dan
    // mengembalikan halaman yang salah tanpa satu pun error.
    const asing = Buffer.from('notif:12', 'utf8').toString('base64url');
    await expect(wallet.ledger(USER, { cursor: asing })).rejects.toBeInstanceOf(InvalidCursorError);
    await expect(wallet.ledger(USER, { cursor: 'bukan-base64-!!' })).rejects.toBeInstanceOf(
      InvalidCursorError,
    );
  });

  it('limit dibatasi keras — satu request tidak bisa menarik seluruh riwayat', async () => {
    if (!reachable) return;
    await semai(USER, 60);
    const h = await wallet.ledger(USER, { limit: 9999 });
    expect(h.data.length).toBeLessThanOrEqual(50);
    expect(h.next_cursor).not.toBeNull();
  });

  it('pengguna tanpa entri: saldo 0, riwayat kosong, bukan error', async () => {
    if (!reachable) return;
    const h = await wallet.overview(USER);
    expect(h.balance).toBe(0);
    expect(h.recent_entries).toEqual([]);
  });
});
