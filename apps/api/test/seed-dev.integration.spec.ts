import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { Kysely, sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase, type DB } from '../src/infra/kysely';

/**
 * `F-13` — `pnpm seed` terhadap DATABASE NYATA.
 *
 * Seeder dijalankan sebagai PROSES TERPISAH, bukan diimpor. Dua alasan:
 * `pnpm seed` memang begitu dipakai, dan modul `.mjs` yang punya `await main()`
 * di tingkat atas hanya berjalan sekali per proses — test idempotensi yang
 * mengimpornya dua kali akan lulus tanpa menjalankan apa pun yang kedua.
 */

const URL_DEV = 'postgres://strive:strive_dev_only@localhost:55432/strive';
const url = process.env['DATABASE_URL_TEST'] ?? process.env['DATABASE_URL'] ?? URL_DEV;
const SEEDER = join(__dirname, '..', '..', '..', 'db', 'seeds', 'seed-dev.mjs');

let db: Kysely<DB>;
let reachable = false;

function jalankanSeed(): string {
  return execFileSync(process.execPath, [SEEDER], {
    env: { ...process.env, DATABASE_URL: url },
    encoding: 'utf8',
  });
}

const hitung = async (
  tabel:
    'users' | 'tracks' | 'modules' | 'lessons' | 'lesson_cards' | 'store_items' | 'pricing_config',
) => {
  const r = await sql<{ n: string }>`SELECT count(*)::text AS n FROM ${sql.table(tabel)}`.execute(
    db,
  );
  return Number(r.rows[0]!.n);
};

beforeAll(async () => {
  db = createDatabase(url);
  try {
    await db.selectFrom('store_items').select('id').limit(1).execute();
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
  await sql`TRUNCATE users, tracks, store_items, pricing_config RESTART IDENTITY CASCADE`.execute(
    db,
  );
});

describe('pnpm seed — data dev (F-13, database nyata)', () => {
  it('database siap dipakai', () => {
    expect(reachable, `DATABASE_URL tidak bisa dipakai (${url})`).toBe(true);
  });

  it('AC: database kosong → stack yang bisa dipakai', async () => {
    if (!reachable) return;
    jalankanSeed();

    expect(await hitung('pricing_config'), 'tidak ada harga aktif').toBe(1);
    expect(await hitung('tracks')).toBe(1);
    expect(await hitung('modules')).toBe(2);
    expect(await hitung('lessons')).toBe(6);
    expect(await hitung('lesson_cards')).toBe(12);
    // PRD §7 E14: "8 item di-seed manual".
    expect(await hitung('store_items'), 'PRD E14 menyebut 8 item').toBe(8);
  });

  it('AC: harga PERSIS seperti docs/PRD.md §6 — yang TERKUNCI', async () => {
    if (!reachable) return;
    jalankanSeed();
    const p = await db.selectFrom('pricing_config').selectAll().executeTakeFirstOrThrow();

    // Ditulis satu per satu, bukan toMatchObject dengan objek yang disalin dari
    // seeder: kalau seeder dan test menyalin dari sumber yang sama, keduanya
    // salah bersamaan dan testnya tetap hijau. Angka di bawah dibaca dari PRD.
    expect(p.coin_price_idr, 'Q1: 1 koin = Rp 25').toBe(25);
    expect(p.lesson_reward_coins, '§6.1: 1 lesson = 20 koin').toBe(20);
    expect(p.scan_cost_coins, '§6.2: scan = 2.400').toBe(2400);
    expect(p.scan_cached_cost_coins, '§6.2: cache hit = 240, BUKAN 1200').toBe(240);
    expect(p.cv_cost_coins, '§6.2: ATS CV = 400').toBe(400);
    expect(p.interview_cost_coins, '§6.2: wawancara = 300').toBe(300);
    expect(p.statement_cost_coins, '§6.2: personal statement = 500').toBe(500);
    expect(p.prompt_run_cost_coins, '§6.2: Prompt Lab = 20').toBe(20);
    expect(p.freeze_cost_coins, '§6.2 + Q3: freeze = 200').toBe(200);

    const paket = p.packages as { id: string; coins: number; price_idr: number }[];
    expect(paket.map((x) => [x.coins, x.price_idr])).toEqual([
      [1000, 25000],
      [2200, 50000],
      [4800, 100000],
    ]);
  });

  it('AC: dijalankan DUA KALI tidak menggandakan apa pun dan tidak error', async () => {
    if (!reachable) return;
    jalankanSeed();
    const sebelum = {
      users: await hitung('users'),
      lessons: await hitung('lessons'),
      cards: await hitung('lesson_cards'),
      store: await hitung('store_items'),
      pricing: await hitung('pricing_config'),
    };

    const keluaran = jalankanSeed();

    expect(await hitung('users')).toBe(sebelum.users);
    expect(await hitung('lessons')).toBe(sebelum.lessons);
    expect(await hitung('lesson_cards')).toBe(sebelum.cards);
    expect(await hitung('store_items')).toBe(sebelum.store);
    // Yang paling mudah salah: `pricing_config` bertambah versi tiap jalan.
    // Kalau itu terjadi, "versi aktif" melompat dan order lama menunjuk versi
    // yang bukan harganya (SA-02).
    expect(await hitung('pricing_config'), 'harga bertambah versi tiap seed').toBe(1);
    expect(keluaran).toContain('idempoten');
  });

  it('AC: data yang sudah DISENTUH pengguna tidak pernah ditimpa', async () => {
    if (!reachable) return;
    jalankanSeed();

    const lesson = await db
      .selectFrom('lessons')
      .select(['id'])
      .orderBy('id')
      .executeTakeFirstOrThrow();

    // Seorang dev mengubah judul lesson hasil seed.
    await db
      .updateTable('lessons')
      .set({ title: 'JUDUL YANG DIUBAH MANUSIA' })
      .where('id', '=', lesson.id)
      .execute();

    // Dan seorang pengguna sungguhan mengerjakan sesuatu.
    const pengguna = await db
      .insertInto('users')
      .values({
        email: 'nyata@uji.test',
        password_hash: 'x',
        display_name: 'Pengguna Nyata',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await db
      .insertInto('lesson_attempts')
      .values({
        user_id: pengguna.id,
        lesson_id: lesson.id,
        attempt_date: sql`(now() AT TIME ZONE 'Asia/Jakarta')::date`,
        card_results: JSON.stringify([{ card: 1 }]),
        score: 90,
        points: 9,
        coins: 18,
        duration_ms: 1000,
      })
      .execute();
    await db
      .insertInto('coin_ledger')
      .values({
        user_id: pengguna.id,
        entry_type: 'earn_lesson',
        amount: 18,
        balance_after: 18,
      })
      .execute();

    jalankanSeed();

    const sesudah = await db
      .selectFrom('lessons')
      .select('title')
      .where('id', '=', lesson.id)
      .executeTakeFirstOrThrow();
    expect(sesudah.title, 'seeder menimpa perubahan manusia').toBe('JUDUL YANG DIUBAH MANUSIA');

    const attempt = await db
      .selectFrom('lesson_attempts')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('user_id', '=', pengguna.id)
      .executeTakeFirstOrThrow();
    expect(Number(attempt.n), 'attempt pengguna hilang').toBe(1);

    const ledger = await db
      .selectFrom('coin_ledger')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('user_id', '=', pengguna.id)
      .executeTakeFirstOrThrow();
    expect(Number(ledger.n), 'entri ledger pengguna hilang').toBe(1);
  });

  it('kartu punya kunci jawaban DI DATABASE — yang dibuang serializer, bukan seeder', async () => {
    if (!reachable) return;
    jalankanSeed();
    const kartu = await db.selectFrom('lesson_cards').select(['content']).execute();

    for (const k of kartu) {
      const c = k.content as { options: { id: string; text: string; correct: boolean }[] };
      expect(c.options.length, 'kartu tanpa opsi').toBeGreaterThanOrEqual(2);
      // Tepat satu jawaban benar per kartu. Nol berarti kartunya tidak bisa
      // diselesaikan; dua berarti penilaiannya ambigu — dan keduanya baru
      // ketahuan saat pengguna sungguhan mengerjakannya.
      expect(c.options.filter((o) => o.correct)).toHaveLength(1);
    }
  });

  it('item store bisa dibeli: harga positif, aktif, slug unik', async () => {
    if (!reachable) return;
    jalankanSeed();
    const item = await db.selectFrom('store_items').selectAll().execute();

    expect(new Set(item.map((x) => x.slug)).size).toBe(item.length);
    for (const i of item) {
      expect(i.price_coins, `${i.slug} harga tidak positif`).toBeGreaterThan(0);
      expect(i.is_active, `${i.slug} tidak aktif`).toBe(true);
      expect(i.asset_key.length, `${i.slug} tanpa asset_key`).toBeGreaterThan(0);
    }
    // §6.2: "Item store 300–1.500".
    expect(Math.min(...item.map((x) => x.price_coins))).toBeGreaterThanOrEqual(300);
    expect(Math.max(...item.map((x) => x.price_coins))).toBeLessThanOrEqual(1500);
  });

  it('pengguna jangkar TIDAK bisa login — repo ini publik', async () => {
    if (!reachable) return;
    jalankanSeed();
    const anchor = await db
      .selectFrom('users')
      .select(['password_hash', 'role'])
      .where('email', '=', 'seed-anchor@strive.local')
      .executeTakeFirstOrThrow();

    expect(anchor.role).toBe('superadmin');
    // Menyemai kredensial yang bisa dipakai sama dengan menerbitkan kunci masuk
    // ke setiap lingkungan yang pernah menjalankan `pnpm seed`.
    expect(anchor.password_hash, 'pengguna seed punya password').toBeNull();
    const akun = await sql<{ n: string }>`
      SELECT count(*)::text AS n FROM auth_accounts a
      JOIN users u ON u.id = a.user_id WHERE u.email = 'seed-anchor@strive.local'
    `.execute(db);
    expect(Number(akun.rows[0]!.n), 'pengguna seed punya auth_accounts').toBe(0);
  });
});
