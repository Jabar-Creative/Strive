import { randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase, type DB } from '../src/infra/kysely';
import { StorageService, createS3FromEnv } from '../src/infra/storage';
import { CoinLedgerService, InsufficientCoinsError } from '../src/modules/wallet';
import { PricingConfigService } from '../src/modules/payment';
import { DocumentUploadService, STALE_HOLD_MINUTES, ScanService } from '../src/modules/scan';

/**
 * `K-02` terhadap PostgreSQL + MinIO NYATA.
 *
 * AC-nya dua kalimat, dan keduanya soal hal yang tidak terlihat dari kode:
 *
 *   "Worker dimatikan paksa di tengah jalan -> koin kembali otomatis
 *    dalam <=30 menit lewat reaper"
 *   "Dokumen identik kedua tidak memanggil vendor"
 *
 * Yang pertama disimulasikan dengan MEMUNDURKAN `created_at` scan yang masih
 * `running` — itu persis keadaan yang ditinggalkan worker yang mati: baris
 * ada, hold ada, tidak ada yang akan menyentuhnya lagi.
 *
 * Aturan keras 2 diperiksa di SETIAP titik: `users.coin_balance` adalah cache,
 * kebenarannya `SUM(coin_ledger.amount)`. Kalau keduanya menyimpang, angka
 * yang benar pun tidak berarti apa-apa.
 */

const URL_DEV = 'postgres://strive:strive_dev_only@localhost:55432/strive';
const url = process.env['DATABASE_URL_TEST'] ?? process.env['DATABASE_URL'] ?? URL_DEV;

const ADMIN = '00000000-0000-4000-8000-0000000k2001'.replace(/k2/, 'da');
const USER = '00000000-0000-4000-8000-0000000k2002'.replace(/k2/, 'da');
const USER2 = '00000000-0000-4000-8000-0000000k2003'.replace(/k2/, 'da');

const BIAYA_PENUH = 2400;
const BIAYA_CACHE = 240;

let db: Kysely<DB>;
let scans: ScanService;
let coins: CoinLedgerService;
let reachable = false;

/** PDF sungguhan, isinya unik per panggilan supaya hash-nya berbeda. */
const pdf = (isi = randomUUID()) => Buffer.from(`%PDF-1.7\n% ${isi}\n%%EOF\n`, 'latin1');

const dokumen = (buffer: Buffer, filename = 'skripsi.pdf') => ({ filename, buffer });

async function saldo(userId: string): Promise<number> {
  const r = await db
    .selectFrom('users')
    .select('coin_balance')
    .where('id', '=', userId)
    .executeTakeFirstOrThrow();
  return r.coin_balance;
}

/** ATURAN 2: cache harus SELALU sama dengan jumlah ledger. */
async function assertSaldoKonsisten(userId: string) {
  const r = await sql<{ cache: number; ledger: string }>`
    SELECT u.coin_balance AS cache,
           COALESCE(SUM(l.amount), 0)::text AS ledger
    FROM users u LEFT JOIN coin_ledger l ON l.user_id = u.id
    WHERE u.id = ${userId}
    GROUP BY u.coin_balance
  `.execute(db);
  const row = r.rows[0]!;
  expect(
    row.cache,
    `users.coin_balance (${row.cache}) menyimpang dari SUM(coin_ledger) (${row.ledger})`,
  ).toBe(Number(row.ledger));
}

/** Memundurkan usia scan — persis keadaan yang ditinggalkan worker yang mati. */
async function tuakan(scanId: string, menit: number, status = 'running') {
  await sql`
    UPDATE plagiarism_scans
    SET created_at = now() - ${sql.lit(menit)} * interval '1 minute', status = ${status}
    WHERE id = ${scanId}::uuid
  `.execute(db);
}

beforeAll(async () => {
  db = createDatabase(url);
  const storage = new StorageService(createS3FromEnv());
  coins = new CoinLedgerService();
  scans = new ScanService(
    db,
    new DocumentUploadService(storage),
    coins,
    new PricingConfigService(db),
  );
  try {
    await db.selectFrom('plagiarism_scans').select('id').limit(1).execute();
    await storage.exists('strive-documents', 'probe');
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
        email: 'k2a@uji.test',
        password_hash: 'x',
        display_name: 'Admin',
        role: 'superadmin',
      },
      {
        id: USER,
        email: 'k2u@uji.test',
        password_hash: 'x',
        display_name: 'Pengguna',
        coin_balance: 10000,
      },
      {
        id: USER2,
        email: 'k2v@uji.test',
        password_hash: 'x',
        display_name: 'Kedua',
        coin_balance: 10000,
      },
    ])
    .execute();

  // Saldo awal ditulis langsung ke kolom cache, jadi ledger-nya harus diisi
  // agar konsisten sejak awal — kalau tidak, assert aturan 2 gagal karena
  // fixture-nya, bukan karena kodenya.
  for (const u of [USER, USER2]) {
    await db
      .insertInto('coin_ledger')
      .values({ user_id: u, entry_type: 'adjust', amount: 10000, balance_after: 10000 })
      .execute();
  }

  await db
    .insertInto('pricing_config')
    .values({
      version: 1,
      coin_price_idr: 25,
      scan_cost_coins: BIAYA_PENUH,
      scan_cached_cost_coins: BIAYA_CACHE,
      lesson_reward_coins: 20,
      cv_cost_coins: 400,
      interview_cost_coins: 300,
      statement_cost_coins: 500,
      prompt_run_cost_coins: 20,
      freeze_cost_coins: 200,
      packages: JSON.stringify([{ id: 'starter', name: 'Starter', coins: 1000, price_idr: 25000 }]),
      created_by: ADMIN,
    })
    .execute();
});

describe('ScanService — jalur normal (K-02)', () => {
  it('database dan MinIO siap dipakai', () => {
    expect(reachable, `DATABASE_URL / S3_ENDPOINT tidak bisa dipakai (${url})`).toBe(true);
  });

  it('KL-4/KL-5: submit menahan biaya PENUH dan scan masuk antrean', async () => {
    if (!reachable) return;
    const r = await scans.submit({
      userId: USER,
      document: dokumen(pdf()),
      idempotencyKey: randomUUID(),
    });

    expect(r.status).toBe('queued');
    expect(r.costCoins).toBe(BIAYA_PENUH);
    expect(r.needsVendor).toBe(true);
    expect(await saldo(USER)).toBe(10000 - BIAYA_PENUH);
    await assertSaldoKonsisten(USER);

    const baris = await db
      .selectFrom('plagiarism_scans')
      .selectAll()
      .where('id', '=', r.scanId)
      .executeTakeFirstOrThrow();
    expect(baris.status).toBe('queued');
    // Hold DITUNJUK barisnya — tanpa ini reaper tidak bisa menelusuri
    // koin mana yang tertahan untuk scan mana.
    expect(baris.hold_ledger_id).not.toBeNull();
  });

  it('KL-5: saldo kurang → scan TIDAK PERNAH dibuat', async () => {
    if (!reachable) return;
    await db.updateTable('users').set({ coin_balance: 100 }).where('id', '=', USER).execute();
    await db
      .insertInto('coin_ledger')
      .values({ user_id: USER, entry_type: 'adjust', amount: -9900, balance_after: 100 })
      .execute();

    await expect(
      scans.submit({ userId: USER, document: dokumen(pdf()), idempotencyKey: randomUUID() }),
    ).rejects.toBeInstanceOf(InsufficientCoinsError);

    // "Kalau saldo kurang, job tidak pernah dibuat" — dan yang menjaminnya
    // ROLLBACK, bukan urutan pemanggilan. Baris scan ikut hilang.
    const n = await db
      .selectFrom('plagiarism_scans')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .executeTakeFirstOrThrow();
    expect(Number(n.n), 'ada baris scan tertinggal padahal hold gagal').toBe(0);
    expect(await saldo(USER)).toBe(100);
  });

  it('KL-4: hasil masuk → settle, saldo TIDAK berubah lagi', async () => {
    if (!reachable) return;
    const r = await scans.submit({
      userId: USER,
      document: dokumen(pdf()),
      idempotencyKey: randomUUID(),
    });
    const sesudahHold = await saldo(USER);

    await scans.complete(r.scanId, {
      providerScanId: 'cl-1',
      similarityScore: 12.5,
      reportKey: 'reports/cl-1.pdf',
      wordCount: 4200,
    });

    // Settle TIDAK menulis entri ledger — hold sudah memotong. Menulis lagi
    // akan memotong dua kali.
    expect(await saldo(USER), 'settle memotong saldo untuk kedua kalinya').toBe(sesudahHold);
    await assertSaldoKonsisten(USER);

    const baris = await db
      .selectFrom('plagiarism_scans')
      .selectAll()
      .where('id', '=', r.scanId)
      .executeTakeFirstOrThrow();
    expect(baris.status).toBe('done');
    expect(Number(baris.similarity_score)).toBe(12.5);
  });

  it('webhook dikirim DUA KALI → tetap satu efek', async () => {
    if (!reachable) return;
    const r = await scans.submit({
      userId: USER,
      document: dokumen(pdf()),
      idempotencyKey: randomUUID(),
    });
    const hasil = {
      providerScanId: 'cl-2',
      similarityScore: 30,
      reportKey: 'r.pdf',
      wordCount: 100,
    };
    await scans.complete(r.scanId, hasil);
    const sesudah = await saldo(USER);
    await scans.complete(r.scanId, hasil);

    expect(await saldo(USER)).toBe(sesudah);
    await assertSaldoKonsisten(USER);
  });

  it('KL-7: vendor gagal → koin kembali PENUH', async () => {
    if (!reachable) return;
    const r = await scans.submit({
      userId: USER,
      document: dokumen(pdf()),
      idempotencyKey: randomUUID(),
    });
    expect(await saldo(USER)).toBe(10000 - BIAYA_PENUH);

    await scans.fail(r.scanId, 'vendor timeout');

    expect(await saldo(USER), 'koin tidak kembali penuh setelah gagal').toBe(10000);
    await assertSaldoKonsisten(USER);

    const baris = await db
      .selectFrom('plagiarism_scans')
      .select(['status', 'error_message'])
      .where('id', '=', r.scanId)
      .executeTakeFirstOrThrow();
    expect(baris.status).toBe('failed');
    expect(baris.error_message).toContain('timeout');
  });
});

describe('ScanService — dedup (AC: dokumen identik tidak memanggil vendor)', () => {
  it('AC: dokumen identik kedua → tarif cache, status done, vendor TIDAK dipanggil', async () => {
    if (!reachable) return;
    const buf = pdf();

    // Pengguna pertama: jalur penuh sampai selesai.
    const satu = await scans.submit({
      userId: USER,
      document: dokumen(buf),
      idempotencyKey: randomUUID(),
    });
    await scans.complete(satu.scanId, {
      providerScanId: 'cl-asal',
      similarityScore: 18.75,
      reportKey: 'reports/asal.pdf',
      wordCount: 5000,
    });

    // Pengguna KEDUA mengirim dokumen yang sama persis.
    const dua = await scans.submit({
      userId: USER2,
      document: dokumen(buf, 'nama-berbeda.pdf'),
      idempotencyKey: randomUUID(),
    });

    expect(dua.needsVendor, 'vendor akan dipanggil untuk dokumen yang sudah pernah discan').toBe(
      false,
    );
    expect(dua.status).toBe('done');
    expect(dua.costCoins, 'tarif penuh dikenakan untuk cache hit').toBe(BIAYA_CACHE);
    expect(dua.cachedFrom).toBe(satu.scanId);
    expect(dua.similarityScore).toBe(18.75);

    expect(await saldo(USER2)).toBe(10000 - BIAYA_CACHE);
    await assertSaldoKonsisten(USER2);

    // Tidak ada hold sama sekali di jalur cache — hold untuk pekerjaan yang
    // sudah selesai adalah dua penulisan untuk satu kejadian.
    const hold = await db
      .selectFrom('coin_ledger')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('user_id', '=', USER2)
      .where('entry_type', '=', 'hold')
      .executeTakeFirstOrThrow();
    expect(Number(hold.n)).toBe(0);
  });

  it('KL-9: scan yang BELUM done tidak bisa jadi sumber cache', async () => {
    if (!reachable) return;
    const buf = pdf();
    // Pertama masih `queued` — hasilnya belum ada untuk disalin.
    await scans.submit({ userId: USER, document: dokumen(buf), idempotencyKey: randomUUID() });

    const dua = await scans.submit({
      userId: USER2,
      document: dokumen(buf),
      idempotencyKey: randomUUID(),
    });

    // Cache diisi HANYA setelah hasil benar-benar tersimpan. Kalau tidak,
    // pengguna kedua membayar tarif diskon untuk hasil yang tidak ada.
    expect(dua.needsVendor, 'scan yang belum selesai dipakai sebagai cache').toBe(true);
    expect(dua.costCoins).toBe(BIAYA_PENUH);
  });

  it('scan yang GAGAL juga tidak bisa jadi sumber cache', async () => {
    if (!reachable) return;
    const buf = pdf();
    const satu = await scans.submit({
      userId: USER,
      document: dokumen(buf),
      idempotencyKey: randomUUID(),
    });
    await scans.fail(satu.scanId, 'vendor menolak');

    const dua = await scans.submit({
      userId: USER2,
      document: dokumen(buf),
      idempotencyKey: randomUUID(),
    });
    expect(dua.needsVendor).toBe(true);
    expect(dua.costCoins).toBe(BIAYA_PENUH);
  });

  it('dokumen BERBEDA tidak pernah dianggap sama', async () => {
    if (!reachable) return;
    const satu = await scans.submit({
      userId: USER,
      document: dokumen(pdf('isi-a')),
      idempotencyKey: randomUUID(),
    });
    await scans.complete(satu.scanId, {
      providerScanId: 'cl-a',
      similarityScore: 5,
      reportKey: 'a.pdf',
      wordCount: 10,
    });

    const dua = await scans.submit({
      userId: USER2,
      document: dokumen(pdf('isi-b')),
      idempotencyKey: randomUUID(),
    });
    expect(dua.needsVendor).toBe(true);
    expect(dua.costCoins).toBe(BIAYA_PENUH);
  });
});

describe('ScanService — reaper (AC: worker mati → koin kembali ≤30 menit)', () => {
  it('AC: hold yang menggantung > 30 menit dilepas, koin kembali PENUH', async () => {
    if (!reachable) return;
    const r = await scans.submit({
      userId: USER,
      document: dokumen(pdf()),
      idempotencyKey: randomUUID(),
    });
    expect(await saldo(USER)).toBe(10000 - BIAYA_PENUH);

    // Persis keadaan yang ditinggalkan worker yang dimatikan paksa: baris
    // `running`, hold ada, tidak ada yang akan menyentuhnya lagi.
    await tuakan(r.scanId, STALE_HOLD_MINUTES + 1, 'running');

    const hasil = await scans.releaseStale();

    expect(hasil.released).toContain(r.scanId);
    expect(hasil.coinsReturned).toBe(BIAYA_PENUH);
    expect(await saldo(USER), 'koin tidak kembali setelah reaper').toBe(10000);
    await assertSaldoKonsisten(USER);

    const baris = await db
      .selectFrom('plagiarism_scans')
      .select(['status', 'error_message'])
      .where('id', '=', r.scanId)
      .executeTakeFirstOrThrow();
    expect(baris.status).toBe('released');
    expect(baris.error_message).toContain('reaper');
  });

  it('scan yang MASIH BARU tidak disentuh — ambangnya 30 menit, bukan "kapan saja"', async () => {
    if (!reachable) return;
    const r = await scans.submit({
      userId: USER,
      document: dokumen(pdf()),
      idempotencyKey: randomUUID(),
    });
    // Reaper yang terlalu rajin membatalkan pekerjaan yang masih berjalan, dan
    // pengguna membayar dua kali untuk dokumen yang sama.
    await tuakan(r.scanId, STALE_HOLD_MINUTES - 1, 'running');

    const hasil = await scans.releaseStale();
    expect(hasil.released, 'reaper melepas scan yang masih berjalan').toEqual([]);
    expect(await saldo(USER)).toBe(10000 - BIAYA_PENUH);
  });

  it('scan yang SUDAH done tidak dilepas, meski tua', async () => {
    if (!reachable) return;
    const r = await scans.submit({
      userId: USER,
      document: dokumen(pdf()),
      idempotencyKey: randomUUID(),
    });
    await scans.complete(r.scanId, {
      providerScanId: 'cl-3',
      similarityScore: 9,
      reportKey: 'x.pdf',
      wordCount: 1,
    });
    await sql`UPDATE plagiarism_scans SET created_at = now() - interval '2 hours' WHERE id = ${r.scanId}::uuid`.execute(
      db,
    );

    const hasil = await scans.releaseStale();
    expect(
      hasil.released,
      'reaper melepas scan yang sudah selesai — koin dikembalikan dua kali',
    ).toEqual([]);
    expect(await saldo(USER)).toBe(10000 - BIAYA_PENUH);
    await assertSaldoKonsisten(USER);
  });

  it('reaper dijalankan DUA KALI tidak mengembalikan koin dua kali', async () => {
    if (!reachable) return;
    const r = await scans.submit({
      userId: USER,
      document: dokumen(pdf()),
      idempotencyKey: randomUUID(),
    });
    await tuakan(r.scanId, STALE_HOLD_MINUTES + 5);

    await scans.releaseStale();
    const sesudah = await saldo(USER);
    const kedua = await scans.releaseStale();

    expect(kedua.released, 'reaper melepas scan yang sama dua kali').toEqual([]);
    expect(await saldo(USER)).toBe(sesudah);
    await assertSaldoKonsisten(USER);
  });

  it('hasil yang tiba SETELAH reaper melepas: tercatat, koin TIDAK ditagih, tidak melempar', async () => {
    if (!reachable) return;
    // Jalurnya persis AC item ini: reaper melepas hold pada menit ke-30,
    // vendor menjawab pada menit ke-31.
    //
    // Versi pertama `complete()` MELEMPAR di sini — `coins.settle()` menolak
    // menyetel hold yang sudah dilepas, dan galatnya merambat jadi 500. Itu
    // mengubah anomali jadi kegagalan, DAN membuang hasil yang vendornya sudah
    // kita bayar. Ketahuan dari test balapan, bukan dari membaca kode.
    const r = await scans.submit({
      userId: USER,
      document: dokumen(pdf()),
      idempotencyKey: randomUUID(),
    });
    await tuakan(r.scanId, STALE_HOLD_MINUTES + 5);
    await scans.releaseStale();
    expect(await saldo(USER)).toBe(10000);

    await expect(
      scans.complete(r.scanId, {
        providerScanId: 'cl-telat',
        similarityScore: 7.5,
        reportKey: 'telat.pdf',
        wordCount: 900,
      }),
      'webhook telat melempar — hasilnya hilang dan API menjawab 500',
    ).resolves.toBeUndefined();

    const baris = await db
      .selectFrom('plagiarism_scans')
      .select(['status', 'similarity_score', 'provider_scan_id', 'error_message'])
      .where('id', '=', r.scanId)
      .executeTakeFirstOrThrow();

    // Hasilnya DISIMPAN sebagai bukti — vendornya sudah dibayar.
    expect(Number(baris.similarity_score)).toBe(7.5);
    expect(baris.provider_scan_id).toBe('cl-telat');
    // Statusnya TETAP `released`: `done` akan berarti dua hal yang keduanya
    // tidak benar — bahwa penggunanya membayar, dan bahwa baris ini layak
    // jadi sumber dedup dengan tarif diskon.
    expect(baris.status, 'scan yang koinnya dikembalikan ditandai done').toBe('released');
    expect(baris.error_message).toContain('TIDAK ditagih');

    // Uangnya: tetap kembali, tidak ditagih ulang diam-diam.
    expect(await saldo(USER)).toBe(10000);
    await assertSaldoKonsisten(USER);
  });

  it('scan yang koinnya sudah dikembalikan TIDAK jadi sumber dedup', async () => {
    if (!reachable) return;
    // Lanjutan dari yang di atas: kalau `released` ikut dianggap cache,
    // pengguna berikutnya membayar 240 koin untuk hasil yang tidak ada
    // pemiliknya — dan yang pertama mendapatkannya gratis.
    const buf = pdf();
    const satu = await scans.submit({
      userId: USER,
      document: dokumen(buf),
      idempotencyKey: randomUUID(),
    });
    await tuakan(satu.scanId, STALE_HOLD_MINUTES + 5);
    await scans.releaseStale();
    await scans.complete(satu.scanId, {
      providerScanId: 'cl-telat',
      similarityScore: 7.5,
      reportKey: 'telat.pdf',
      wordCount: 900,
    });

    const dua = await scans.submit({
      userId: USER2,
      document: dokumen(buf),
      idempotencyKey: randomUUID(),
    });
    expect(dua.needsVendor).toBe(true);
    expect(dua.costCoins).toBe(BIAYA_PENUH);
  });

  it('satu scan bermasalah tidak menghentikan pelepasan milik pengguna lain', async () => {
    if (!reachable) return;
    const a = await scans.submit({
      userId: USER,
      document: dokumen(pdf()),
      idempotencyKey: randomUUID(),
    });
    const b = await scans.submit({
      userId: USER2,
      document: dokumen(pdf()),
      idempotencyKey: randomUUID(),
    });
    await tuakan(a.scanId, STALE_HOLD_MINUTES + 5);
    await tuakan(b.scanId, STALE_HOLD_MINUTES + 5);

    const hasil = await scans.releaseStale();
    expect(hasil.released).toHaveLength(2);
    expect(await saldo(USER)).toBe(10000);
    expect(await saldo(USER2)).toBe(10000);
  });

  it('scan yang dilepas reaper BISA dikirim ulang dan ditahan lagi', async () => {
    if (!reachable) return;
    const buf = pdf();
    const satu = await scans.submit({
      userId: USER,
      document: dokumen(buf),
      idempotencyKey: randomUUID(),
    });
    await tuakan(satu.scanId, STALE_HOLD_MINUTES + 5);
    await scans.releaseStale();
    expect(await saldo(USER)).toBe(10000);

    // Kunci idempotensi BARU: ini percobaan baru, bukan pengulangan yang lama.
    // Kalau `released` ikut dianggap cache, pengguna akan mendapat "hasil"
    // yang tidak pernah ada.
    const dua = await scans.submit({
      userId: USER,
      document: dokumen(buf),
      idempotencyKey: randomUUID(),
    });
    expect(dua.needsVendor).toBe(true);
    expect(dua.costCoins).toBe(BIAYA_PENUH);
    expect(await saldo(USER)).toBe(10000 - BIAYA_PENUH);
    await assertSaldoKonsisten(USER);
  });
});

describe('ScanService — idempotensi (PRD §10.3 ⚡)', () => {
  it('kunci SAMA + dokumen SAMA → hasil pertama dikembalikan, satu hold', async () => {
    if (!reachable) return;
    const kunci = randomUUID();
    const buf = pdf();

    const satu = await scans.submit({
      userId: USER,
      document: dokumen(buf),
      idempotencyKey: kunci,
    });
    const sesudah = await saldo(USER);

    const dua = await scans.submit({ userId: USER, document: dokumen(buf), idempotencyKey: kunci });

    // Semantik Idempotency-Key: percobaan ulang yang jujur mendapat jawaban
    // yang SAMA, bukan pekerjaan baru.
    expect(dua.scanId, 'percobaan ulang membuat scan BARU').toBe(satu.scanId);
    expect(await saldo(USER)).toBe(sesudah);
    await assertSaldoKonsisten(USER);

    const n = await db
      .selectFrom('plagiarism_scans')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .executeTakeFirstOrThrow();
    expect(Number(n.n), 'ada baris scan kedua untuk percobaan ulang').toBe(1);
  });

  it('kunci SAMA + dokumen BERBEDA → ditolak, dan NOL scan hantu', async () => {
    if (!reachable) return;
    // Cacat yang ditemukan review bermusuhan, bukan test.
    //
    // Versi pertama membuat baris scan KEDUA lalu memanggil `hold()` yang —
    // karena idempoten — mengembalikan entri LAMA tanpa mendebit. Hasilnya dua
    // scan berbagi satu hold, dan yang kedua TIDAK AKAN PERNAH bisa selesai:
    // `settle()` mencari hold dengan ref_id scan kedua dan tidak menemukannya.
    //
    // Uangnya tidak pernah salah. Yang salah janji ke penggunanya: scan yang
    // menggantung selamanya, lalu ditandai `released` tanpa koin kembali —
    // memang tidak ada yang ditahan untuknya.
    const kunci = randomUUID();
    await scans.submit({
      userId: USER,
      document: dokumen(pdf('dokumen-A')),
      idempotencyKey: kunci,
    });
    const sesudah = await saldo(USER);

    await expect(
      scans.submit({ userId: USER, document: dokumen(pdf('dokumen-B')), idempotencyKey: kunci }),
      'kunci dipakai ulang untuk dokumen lain DITERIMA',
    ).rejects.toBeInstanceOf(ConflictException);

    const n = await db
      .selectFrom('plagiarism_scans')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .executeTakeFirstOrThrow();
    expect(Number(n.n), 'scan hantu terbuat — tidak punya hold, tidak bisa selesai').toBe(1);
    expect(await saldo(USER)).toBe(sesudah);
    await assertSaldoKonsisten(USER);
  });

  it('setiap scan yang `queued` PUNYA hold miliknya sendiri', async () => {
    if (!reachable) return;
    // Invarian yang seharusnya ada sejak awal: baris scan menggantung tanpa
    // hold adalah baris yang tidak bisa diselesaikan maupun dilepas.
    for (let i = 0; i < 3; i++) {
      await scans.submit({
        userId: USER,
        document: dokumen(pdf(`inv-${i}`)),
        idempotencyKey: randomUUID(),
      });
    }

    const yatim = await sql<{ n: string }>`
      SELECT count(*)::text AS n
      FROM plagiarism_scans s
      WHERE s.status IN ('queued','running')
        AND NOT EXISTS (
          SELECT 1 FROM coin_ledger l
          WHERE l.ref_type = 'scan' AND l.ref_id = s.id AND l.entry_type = 'hold'
        )
    `.execute(db);
    expect(Number(yatim.rows[0]!.n), 'ada scan menggantung tanpa hold').toBe(0);
  });
});
