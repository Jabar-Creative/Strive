import { HttpException } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDatabase, type DB } from '../src/infra/kysely';
import { type AiRunResult, type AiServiceClient } from '../src/modules/ai';
import { PricingConfigService } from '../src/modules/payment';
import { CoinLedgerService } from '../src/modules/wallet';
import { PromptLabService, type PromptRunSections } from '../src/modules/career';

/**
 * `PL-01` sisi Node terhadap DATABASE NYATA + klien AI PALSU (antarmuka,
 * bukan vendor — pola SnapClient). Uang, kuota, dan idempotensi tidak bisa
 * dibuktikan dari mock satuan.
 *
 * AC:
 *   AC-PL-1: run lengkap → koin terpotong, hasil tampil, prompt_runs +1.
 *   AC-PL-2: LLM gagal/lebih dari 30 dtk → koin TIDAK terpotong + pesan jelas.
 *   PL-4:    kuota 10 run AI/hari (gabungan) → DAILY_AI_QUOTA_EXCEEDED.
 *
 * Keputusan #245: hold → settle | release (aturan keras 4), BUKAN debit
 * langsung seperti tulisan lama PL-3.
 */

const URL_DEV = 'postgres://strive:strive_dev_only@localhost:55432/strive';
const url = process.env['DATABASE_URL_TEST'] ?? process.env['DATABASE_URL'] ?? URL_DEV;

const AKU = '00000000-0000-4000-8000-00000000aa01';
const LAIN = '00000000-0000-4000-8000-00000000aa02';
const ZONA = 'Asia/Jakarta';

const BAGIAN: PromptRunSections = {
  role: 'Editor akademik Indonesia',
  context: 'Skripsi manajemen tentang UMKM kuliner',
  task: 'Ringkas abstrak jadi 3 kalimat',
  format: 'Prosa tanpa poin',
  constraints: 'Maksimal 80 kata, tanpa jargon',
};

let db: Kysely<DB>;
let svc: PromptLabService;
let coins: CoinLedgerService;
let reachable = false;

/** Klien AI palsu yang merekam pemanggilan. */
function klienAiPalsu(perilaku: { output?: string; lempar?: Error; lambatMs?: number }) {
  const dipanggil = vi.fn();
  const hasil: AiRunResult = {
    output: perilaku.output ?? 'HASIL-PALSU',
    model: 'gpt-palsu',
    promptVersion: 'prompt-lab/2026-10-18',
    inputTokens: 100,
    outputTokens: 50,
    costUsd: 0,
  };
  const klien: AiServiceClient = {
    name: 'ai-palsu',
    run: async () => {
      dipanggil();
      if (perilaku.lambatMs) await new Promise((r) => setTimeout(r, perilaku.lambatMs));
      if (perilaku.lempar) throw perilaku.lempar;
      return hasil;
    },
  };
  return { klien, dipanggil };
}

async function saldo(userId: string): Promise<number> {
  const r = await db
    .selectFrom('users')
    .select('coin_balance')
    .where('id', '=', userId)
    .executeTakeFirstOrThrow();
  return r.coin_balance;
}

async function semaiUser(userId: string, koin: number) {
  await db
    .insertInto('users')
    .values({
      id: userId,
      email: `pl01-${userId.slice(-4)}@uji.test`,
      display_name: userId.slice(-4),
      coin_balance: koin,
    })
    .execute();
  if (koin > 0) {
    await db
      .insertInto('coin_ledger')
      .values({ user_id: userId, entry_type: 'adjust', amount: koin, balance_after: koin })
      .execute();
  }
  // streaks.timezone adalah sumber tanggal LOKAL (pelajaran #193).
  await db.updateTable('streaks').set({ timezone: ZONA }).where('user_id', '=', userId).execute();
}

beforeAll(async () => {
  db = createDatabase(url);
  coins = new CoinLedgerService();
  reachable = await (async () => {
    try {
      await db.selectFrom('prompt_runs').select('id').limit(1).execute();
      return true;
    } catch {
      return false;
    }
  })();
});

afterAll(async () => {
  if (db) await db.destroy();
});

beforeEach(async () => {
  if (!reachable) return;
  await sql`TRUNCATE users, prompt_runs, coin_ledger, audit_log, pricing_config RESTART IDENTITY CASCADE`.execute(
    db,
  );
  // pricing aktif wajib ada — suite lain mem-TRUNCATE pricing_config dan
  // tidak menaruhnya kembali; jangan bergantung pada sisa data dev.
  await db
    .insertInto('pricing_config')
    .values({
      version: 1,
      coin_price_idr: 25,
      scan_cost_coins: 2400,
      scan_cached_cost_coins: 1200,
      lesson_reward_coins: 14,
      cv_cost_coins: 1500,
      interview_cost_coins: 2000,
      statement_cost_coins: 2000,
      prompt_run_cost_coins: 20,
      freeze_cost_coins: 400,
      packages: JSON.stringify([{ id: 'starter', name: 'Starter', coins: 1000, price_idr: 25000 }]),
      active_from: new Date(Date.now() - 60_000),
      created_by: null,
    })
    .execute();

  await semaiUser(AKU, 1000);
  await semaiUser(LAIN, 0);
});

describe('POST /career/prompt-lab/run (PL-01 Node)', () => {
  it('database siap dipakai', () => {
    expect(reachable, `DATABASE_URL tidak bisa dipakai (${url})`).toBe(true);
  });

  it('AC-PL-1: run sukses → hold→settle, koin -20, prompt_runs berisi output', async () => {
    if (!reachable) return;
    const { klien } = klienAiPalsu({ output: 'RINGKASAN-BAGUS' });
    svc = new PromptLabService(db, coins, new PricingConfigService(db), klien);

    const hasil = await svc.run(AKU, BAGIAN, 'kunci-1');

    expect(hasil.output).toBe('RINGKASAN-BAGUS');
    expect(await saldo(AKU)).toBe(980); // 1000 - 20
    const baris = await db
      .selectFrom('prompt_runs')
      .selectAll()
      .where('id', '=', hasil.id)
      .executeTakeFirstOrThrow();
    expect(baris.output).toBe('RINGKASAN-BAGUS');
    // Hold telah disetle: entri hold ada, dan TIDAK ada entri release.
    const tipe = await db
      .selectFrom('coin_ledger')
      .select('entry_type')
      .where('user_id', '=', AKU)
      .orderBy('created_at')
      .execute();
    expect(tipe.map((t) => t.entry_type)).toEqual(['adjust', 'hold']);
  });

  it('AC-PL-2: LLM gagal → release (koin kembali), baris run DIHAPUS, galat bersih', async () => {
    if (!reachable) return;
    const { klien } = klienAiPalsu({ lempar: new Error('jaringan putus') });
    svc = new PromptLabService(db, coins, new PricingConfigService(db), klien);

    await expect(svc.run(AKU, BAGIAN, 'kunci-gagal')).rejects.toBeInstanceOf(HttpException);

    expect(await saldo(AKU)).toBe(1000); // utuh
    const sisa = await db.selectFrom('prompt_runs').where('user_id', '=', AKU).execute();
    expect(sisa).toHaveLength(0); // riwayat hanya run BERHASIL (PL-6)
    const tipe = await db
      .selectFrom('coin_ledger')
      .select('entry_type')
      .where('user_id', '=', AKU)
      .orderBy('created_at')
      .execute();
    expect(tipe.map((t) => t.entry_type)).toEqual(['adjust', 'hold', 'release']);
  });

  it('AC-PL-2: lebih dari batas waktu → diperlakukan gagal (koin utuh)', async () => {
    if (!reachable) return;
    const { klien } = klienAiPalsu({ lambatMs: 500 });
    svc = new PromptLabService(db, coins, new PricingConfigService(db), klien);
    svc.batasMs = 50; // AC-PL-2 tanpa menunggu 30 dtk nyata

    await expect(svc.run(AKU, BAGIAN, 'kunci-timeout')).rejects.toBeInstanceOf(HttpException);
    expect(await saldo(AKU)).toBe(1000);
  });

  it('PL-4: kesebelas run hari ini → 429 DAILY_AI_QUOTA_EXCEEDED', async () => {
    if (!reachable) return;
    const { klien } = klienAiPalsu({});
    svc = new PromptLabService(db, coins, new PricingConfigService(db), klien);
    for (let i = 1; i <= 10; i++) {
      await svc.run(AKU, BAGIAN, `kunci-kuota-${i}`);
    }
    await expect(svc.run(AKU, BAGIAN, 'kunci-kuota-11')).rejects.toMatchObject({
      status: 429,
      response: { error: { code: 'DAILY_AI_QUOTA_EXCEEDED' } },
    });
    expect(await saldo(AKU)).toBe(800); // tepat 10×20
  });

  it('PL-4: kuota GABUNGAN — cv_documents ikut dihitung', async () => {
    if (!reachable) return;
    await db
      .insertInto('cv_documents')
      .values(
        Array.from({ length: 10 }, (_, i) => ({
          user_id: AKU,
          pdf_key: `kunci-${i}`,
          structured: {},
          ats_score: 80,
        })),
      )
      .execute();
    const { klien } = klienAiPalsu({});
    svc = new PromptLabService(db, coins, new PricingConfigService(db), klien);

    await expect(svc.run(AKU, BAGIAN, 'kunci-gabung')).rejects.toMatchObject({ status: 429 });
  });

  it('PL-4: PERCOBAAN GAGAL ikut dihitung (ledger hold, bukan baris run) — audit T2', async () => {
    if (!reachable) return;
    const { klien } = klienAiPalsu({ lempar: new Error('gagal terus') });
    svc = new PromptLabService(db, coins, new PricingConfigService(db), klien);
    for (let i = 1; i <= 10; i++) {
      await expect(svc.run(AKU, BAGIAN, `kunci-gagal-${i}`)).rejects.toBeInstanceOf(HttpException);
    }
    // 10 percobaan gagal: nol baris prompt_runs, 10 pasangan hold+release.
    // Percobaan ke-11 HARUS ditolak — tiap percobaan tetap memanggil vendor.
    const { klien: klienOk } = klienAiPalsu({});
    svc = new PromptLabService(db, coins, new PricingConfigService(db), klienOk);
    await expect(svc.run(AKU, BAGIAN, 'kunci-gagal-11')).rejects.toMatchObject({ status: 429 });
  });

  it('PL-4: tengah malam LOKAL tidak bolong — pengguna zona +14 tetap terhitung (audit T1)', async () => {
    if (!reachable) return;
    // Zona +14 (Kiritimati): tanggal lokalnya BESOK dari sudut UTC siang ini.
    // Versi lama membandingkan created_at >= date-yang-dicast-di-UTC →
    // ambang masa depan → hitungan nol → kuota tak berlaku sama sekali.
    await db
      .updateTable('streaks')
      .set({ timezone: 'Pacific/Kiritimati' })
      .where('user_id', '=', AKU)
      .execute();
    const { klien } = klienAiPalsu({});
    svc = new PromptLabService(db, coins, new PricingConfigService(db), klien);
    for (let i = 1; i <= 10; i++) {
      await svc.run(AKU, BAGIAN, `kunci-plus14-${i}`);
    }
    await expect(svc.run(AKU, BAGIAN, 'kunci-plus14-11')).rejects.toMatchObject({ status: 429 });
  });

  it('⚡ replay kunci sama → run yang sama dikembalikan, LLM tidak dipanggil ulang', async () => {
    if (!reachable) return;
    const { klien, dipanggil } = klienAiPalsu({ output: 'SEKALI-SAJA' });
    svc = new PromptLabService(db, coins, new PricingConfigService(db), klien);

    const pertama = await svc.run(AKU, BAGIAN, 'kunci-replay');
    const kedua = await svc.run(AKU, BAGIAN, 'kunci-replay');

    expect(kedua.id).toBe(pertama.id);
    expect(kedua.output).toBe('SEKALI-SAJA');
    expect(dipanggil).toHaveBeenCalledTimes(1);
    expect(await saldo(AKU)).toBe(980); // sekali potong
  });

  it('saldo kurang → INSUFFICIENT_COINS, tanpa baris run', async () => {
    if (!reachable) return;
    const { klien } = klienAiPalsu({});
    svc = new PromptLabService(db, coins, new PricingConfigService(db), klien);

    await expect(svc.run(LAIN, BAGIAN, 'kunci-miskin')).rejects.toMatchObject({
      status: 402, // konvensi repo: INSUFFICIENT_COINS = 402
      response: { error: { code: 'INSUFFICIENT_COINS' } },
    });
    const sisa = await db.selectFrom('prompt_runs').where('user_id', '=', LAIN).execute();
    expect(sisa).toHaveLength(0);
  });
});
