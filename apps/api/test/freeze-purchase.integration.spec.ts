import { ConflictException } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase, type DB } from '../src/infra/kysely';
import { PricingConfigService } from '../src/modules/payment';
import { FreezePurchaseService, MAX_FREEZE_CREDITS } from '../src/modules/streak';
import { CoinLedgerService, InsufficientCoinsError } from '../src/modules/wallet';

/**
 * `S-05` terhadap DATABASE NYATA — PRD §5 Q3.
 *
 * > **Bisa dibeli: 200 koin per kredit, maksimal 1 pembelian per bulan.**
 *
 * Kalimat "per bulan" itu yang paling mudah salah: bulan LOKAL pengguna,
 * bukan bulan UTC.
 *
 * Seperti `streak.integration.spec.ts`, **tidak ada satu pun tanggal yang
 * dibentuk di Node** — semuanya dihitung Postgres dari `streaks.timezone`.
 * Test yang mengetik '2026-09' akan lulus di mesin mana pun dan tidak
 * membuktikan apa-apa.
 */

const URL_DEV = 'postgres://strive:strive_dev_only@localhost:55432/strive';
const url = process.env['DATABASE_URL_TEST'] ?? process.env['DATABASE_URL'] ?? URL_DEV;

const ADMIN = '00000000-0000-4000-8000-0000000f5e01';
const USER = '00000000-0000-4000-8000-0000000f5e02';
const HARGA_FREEZE = 200;

let db: Kysely<DB>;
let freeze: FreezePurchaseService;
let reachable = false;

const saldo = async () =>
  (
    await db
      .selectFrom('users')
      .select('coin_balance')
      .where('id', '=', USER)
      .executeTakeFirstOrThrow()
  ).coin_balance;

const streak = async () =>
  db
    .selectFrom('streaks')
    .select(['freeze_credits', 'freeze_purchased_month'])
    .where('user_id', '=', USER)
    .executeTakeFirstOrThrow();

/** ATURAN 2: cache saldo harus SELALU sama dengan jumlah ledger. */
async function assertSaldoKonsisten() {
  const r = await sql<{ cache: number; ledger: string }>`
    SELECT u.coin_balance AS cache, COALESCE(SUM(l.amount), 0)::text AS ledger
    FROM users u LEFT JOIN coin_ledger l ON l.user_id = u.id
    WHERE u.id = ${USER} GROUP BY u.coin_balance
  `.execute(db);
  const row = r.rows[0]!;
  expect(row.cache, `cache ${row.cache} vs ledger ${row.ledger}`).toBe(Number(row.ledger));
}

beforeAll(async () => {
  db = createDatabase(url);
  freeze = new FreezePurchaseService(db, new CoinLedgerService(), new PricingConfigService(db));
  try {
    await db.selectFrom('streaks').select('user_id').limit(1).execute();
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
  await sql`TRUNCATE users, pricing_config RESTART IDENTITY CASCADE`.execute(db);
  await db
    .insertInto('users')
    .values([
      {
        id: ADMIN,
        email: 's5a@uji.test',
        password_hash: 'x',
        display_name: 'A',
        role: 'superadmin',
      },
      {
        id: USER,
        email: 's5u@uji.test',
        password_hash: 'x',
        display_name: 'U',
        coin_balance: 1000,
      },
    ])
    .execute();
  await db
    .insertInto('coin_ledger')
    .values({ user_id: USER, entry_type: 'adjust', amount: 1000, balance_after: 1000 })
    .execute();
  // Trigger AU-6 membuat baris streak-nya; kredit awal 1 (DEFAULT kolom).
  await db
    .insertInto('pricing_config')
    .values({
      version: 1,
      coin_price_idr: 25,
      scan_cost_coins: 2400,
      scan_cached_cost_coins: 240,
      lesson_reward_coins: 20,
      cv_cost_coins: 400,
      interview_cost_coins: 300,
      statement_cost_coins: 500,
      prompt_run_cost_coins: 20,
      freeze_cost_coins: HARGA_FREEZE,
      packages: JSON.stringify([{ id: 's', name: 'S', coins: 1000, price_idr: 25000 }]),
      created_by: ADMIN,
    })
    .execute();
  // Mulai dari 0 kredit supaya batas "maksimal 2" bisa diuji terpisah.
  await db.updateTable('streaks').set({ freeze_credits: 0 }).where('user_id', '=', USER).execute();
});

describe('S-05 — beli kredit freeze (database nyata)', () => {
  it('database siap dipakai', () => {
    expect(reachable, `DATABASE_URL tidak bisa dipakai (${url})`).toBe(true);
  });

  it('AC: 200 koin terpotong, kredit bertambah satu, bulan tercatat', async () => {
    if (!reachable) return;
    const r = await freeze.buy(USER);

    expect(r.costCoins).toBe(HARGA_FREEZE);
    expect(r.credits).toBe(1);
    expect(r.purchasedMonth).toMatch(/^\d{4}-\d{2}$/);
    expect(await saldo()).toBe(1000 - HARGA_FREEZE);
    await assertSaldoKonsisten();

    const s = await streak();
    expect(s.freeze_credits).toBe(1);
    expect((s.freeze_purchased_month ?? '').trim()).toBe(r.purchasedMonth);
  });

  it('AC: pembelian KEDUA di bulan yang sama ditolak, saldo tidak berubah', async () => {
    if (!reachable) return;
    await freeze.buy(USER);
    const sesudah = await saldo();

    await expect(freeze.buy(USER)).rejects.toBeInstanceOf(ConflictException);

    expect(await saldo(), 'koin terpotong untuk pembelian yang ditolak').toBe(sesudah);
    expect((await streak()).freeze_credits).toBe(1);
    await assertSaldoKonsisten();
  });

  it('bulan BERIKUTNYA boleh beli lagi', async () => {
    if (!reachable) return;
    await freeze.buy(USER);
    // Catatan bulannya dimundurkan — persis keadaan pengguna di bulan baru.
    await sql`
      UPDATE streaks
      SET freeze_purchased_month = to_char((now() AT TIME ZONE timezone)::date - interval '1 month', 'YYYY-MM')
      WHERE user_id = ${USER}
    `.execute(db);

    const r = await freeze.buy(USER);
    expect(r.credits).toBe(2);
    expect(await saldo()).toBe(1000 - HARGA_FREEZE * 2);
    await assertSaldoKonsisten();
  });

  // ── ATURAN KERAS 5, di satuan bulan ────────────────────────────────────

  it('bulan diambil dari `streaks.timezone`, bukan dari jam proses Node', async () => {
    if (!reachable) return;
    // UTC+14 — zona waktu paling depan yang ada. Tanggal lokalnya SELALU
    // berbeda dari tanggal UTC selama 10 jam setiap hari, dan bulannya
    // berbeda di sekitar pergantian bulan.
    const TZ = 'Pacific/Kiritimati';
    await db.updateTable('streaks').set({ timezone: TZ }).where('user_id', '=', USER).execute();

    const r = await freeze.buy(USER);

    // Dibandingkan ke hitungan POSTGRES untuk zona itu, bukan ke string yang
    // diketik di sini: inilah satu-satunya bentuk yang tidak bisa lulus palsu
    // hanya karena mesin CI kebetulan berjalan di UTC.
    const harap = await sql<{ bulan: string; sama_utc: boolean }>`
      SELECT to_char((now() AT TIME ZONE ${sql.lit(TZ)})::date, 'YYYY-MM') AS bulan,
             to_char((now() AT TIME ZONE ${sql.lit(TZ)})::date, 'YYYY-MM')
               = to_char(now()::date, 'YYYY-MM') AS sama_utc
    `.execute(db);
    const { bulan, sama_utc } = harap.rows[0]!;

    expect(r.purchasedMonth, `bulan tidak dihitung dari ${TZ}`).toBe(bulan);
    expect((await streak()).freeze_purchased_month?.trim()).toBe(bulan);

    // Bentuk terkuatnya hanya bisa dibuktikan di sekitar pergantian bulan:
    // di hari-hari itu, bulan UTC dan bulan lokal benar-benar berbeda.
    // Tidak dipaksakan setiap hari — assert yang hanya benar 28 hari sebulan
    // adalah test yang merah tanpa sebab, dan test merah tanpa sebab diabaikan.
    if (!sama_utc) {
      expect(r.purchasedMonth, 'bulan diambil dari UTC').not.toBe(
        new Date().toISOString().slice(0, 7),
      );
    }
  });

  it('dua pengguna, satu saat yang sama, zona berbeda → bulan masing-masing', async () => {
    if (!reachable) return;
    // Penjaga terhadap kesalahan yang paling mungkin: memakai SATU bulan
    // global (mis. `to_char(now(), 'YYYY-MM')`) untuk semua pengguna. Bentuk
    // itu lulus test di atas selama proses dan database sama-sama UTC.
    const LAIN = '00000000-0000-4000-8000-0000000f5e03';
    await db
      .insertInto('users')
      .values({ id: LAIN, email: 's5l@uji.test', password_hash: 'x', display_name: 'L' })
      .execute();
    await db
      .updateTable('streaks')
      .set({ timezone: 'Pacific/Kiritimati' }) // UTC+14
      .where('user_id', '=', USER)
      .execute();
    await db
      .updateTable('streaks')
      .set({ timezone: 'Etc/GMT+12' }) // UTC-12 — 26 jam di belakangnya
      .where('user_id', '=', LAIN)
      .execute();

    const tanggal = await sql<{ depan: string; belakang: string }>`
      SELECT to_char((now() AT TIME ZONE 'Pacific/Kiritimati')::date, 'YYYY-MM-DD') AS depan,
             to_char((now() AT TIME ZONE 'Etc/GMT+12')::date, 'YYYY-MM-DD')          AS belakang
    `.execute(db);
    const { depan, belakang } = tanggal.rows[0]!;
    // Selisih 26 jam: tanggalnya tidak pernah sama, jam berapa pun test jalan.
    expect(depan, 'prasyaratnya patah — dua zona ini seharusnya beda hari').not.toBe(belakang);

    const a = await freeze.buy(USER);
    // `LAIN` belum punya saldo; yang diuji di sini bulannya, bukan koinnya.
    await db.updateTable('users').set({ coin_balance: 1000 }).where('id', '=', LAIN).execute();
    await db
      .insertInto('coin_ledger')
      .values({ user_id: LAIN, entry_type: 'adjust', amount: 1000, balance_after: 1000 })
      .execute();
    const b = await freeze.buy(LAIN);

    expect(a.purchasedMonth).toBe(depan.slice(0, 7));
    expect(b.purchasedMonth).toBe(belakang.slice(0, 7));
  });

  // ── Batas dan kegagalan ────────────────────────────────────────────────

  it('kredit sudah penuh (2) → ditolak sebelum koin tersentuh', async () => {
    if (!reachable) return;
    await db
      .updateTable('streaks')
      .set({ freeze_credits: MAX_FREEZE_CREDITS })
      .where('user_id', '=', USER)
      .execute();
    const sebelum = await saldo();

    // CHECK `streaks_freeze_credits_range` akan menolaknya juga, tapi sebagai
    // galat database — 500. Pengguna pantas mendapat jawaban yang menjelaskan.
    await expect(freeze.buy(USER)).rejects.toBeInstanceOf(ConflictException);
    expect(await saldo()).toBe(sebelum);
    await assertSaldoKonsisten();
  });

  it('saldo kurang → kredit TIDAK bertambah', async () => {
    if (!reachable) return;
    await db.updateTable('users').set({ coin_balance: 50 }).where('id', '=', USER).execute();
    await db
      .insertInto('coin_ledger')
      .values({ user_id: USER, entry_type: 'adjust', amount: -950, balance_after: 50 })
      .execute();

    await expect(freeze.buy(USER)).rejects.toBeInstanceOf(InsufficientCoinsError);

    // Rollback yang menjaminnya, bukan urutan pemanggilan.
    expect((await streak()).freeze_credits, 'kredit bertambah padahal koin gagal dipotong').toBe(0);
    expect((await streak()).freeze_purchased_month).toBeNull();
    expect(await saldo()).toBe(50);
    await assertSaldoKonsisten();
  });

  // ── Konkurensi: batas yang bocor di batasnya adalah batas yang tidak ada ─

  it('dua pembelian BERSAMAAN hanya menghasilkan satu', async () => {
    if (!reachable) return;
    let buka!: () => void;
    const gerbang = new Promise<void>((r) => {
      buka = r;
    });
    const penahan = db.transaction().execute(async (trx) => {
      await sql`SELECT user_id FROM streaks WHERE user_id = ${USER} FOR UPDATE`.execute(trx);
      await gerbang;
    });
    await new Promise((r) => setTimeout(r, 200));

    const p1 = freeze.buy(USER);
    const p2 = freeze.buy(USER);
    await new Promise((r) => setTimeout(r, 300)); // keduanya menumpuk di kunci

    // Selama gerbang tertahan, NOL yang boleh lolos.
    expect((await streak()).freeze_credits, 'pembelian menembus kunci baris streak').toBe(0);

    buka();
    await penahan;
    const hasil = await Promise.allSettled([p1, p2]);

    // ── Diverifikasi MERAH dengan `.forUpdate()` dicabut dari service ──
    //
    // Yang gagal saat dicabut BUKAN baris di atas: `UPDATE streaks` milik
    // service ikut mengantre di kunci yang sama, jadi selama gerbang tertahan
    // kreditnya tetap 0 dengan atau tanpa `forUpdate()`. Yang bocor justru
    // lebih buruk dan lebih sunyi: kedua transaksi membaca
    // `freeze_purchased_month = NULL`, **keduanya mendebit 200 koin**, lalu
    // menulis `freeze_credits = 0 + 1` dari bacaan basi masing-masing.
    //
    // Hasilnya pengguna membayar 400 untuk 1 kredit, tanpa galat apa pun.
    // Karena itu ketiga assert di bawah dipegang bersama — jumlah yang
    // berhasil, kreditnya, DAN saldonya. Assert kredit saja lulus di dunia
    // yang rusak itu.
    const berhasil = hasil.filter((h) => h.status === 'fulfilled');
    expect(berhasil, 'dua pembelian lolos di bulan yang sama').toHaveLength(1);
    expect((await streak()).freeze_credits).toBe(1);
    expect(await saldo(), 'terdebit dua kali untuk satu kredit').toBe(1000 - HARGA_FREEZE);
    await assertSaldoKonsisten();
  });

  it('entri ledger TANPA ref — kalau tidak, pembelian kedua mustahil selamanya', async () => {
    if (!reachable) return;
    await freeze.buy(USER);

    const l = await db
      .selectFrom('coin_ledger')
      .select(['entry_type', 'amount', 'ref_type', 'ref_id', 'note'])
      .where('user_id', '=', USER)
      .where('entry_type', '=', 'spend_store')
      .executeTakeFirstOrThrow();

    expect(l.amount).toBe(-HARGA_FREEZE);
    // `coin_ledger_ref_uniq (ref_type, ref_id, entry_type)` akan membatasi
    // pembelian jadi SEKALI SEUMUR HIDUP kalau ref-nya diisi (userId, 'streak').
    expect(l.ref_id, 'ref_id diisi — pembelian bulan depan akan ditolak database').toBeNull();
    // Yang memisahkannya dari pembelian store sungguhan sampai enum coin_entry
    // diperbaiki: store selalu menunjuk barisnya, freeze tidak punya baris.
    expect(l.note).toContain('freeze');
  });
});
