import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import type { Insertable, Selectable } from 'kysely';
import { sql } from 'kysely';

import { DATABASE, type Database } from '../../infra/kysely';
import type { DB } from '../../infra/kysely';

/** Baris `pricing_config` apa adanya — lihat db/migrations/001_init.sql. */
export type PricingConfigRow = Selectable<DB['pricing_config']>;

/** Satu paket top-up koin (docs/PRD.md §6.3). */
export interface PricingPackageOption {
  id: string;
  name: string;
  coins: number;
  price_idr: number;
}

/**
 * Payload untuk menerbitkan versi harga baru.
 *
 * `version`, `created_by`, dan `active_from` SENGAJA tidak ada di sini:
 * - `version` dihitung service (`MAX(version)+1`), bukan input pemanggil —
 *   kalau pemanggil yang menentukan nomor versi, dua publish bersamaan bisa
 *   menabrak nomor yang sama tanpa service sempat mencegahnya.
 * - `created_by` datang dari actor yang memanggil (audit trail), bukan body.
 * - `active_from` opsional: kosongkan untuk berlaku seketika (default DB
 *   `now()`), isi untuk menjadwalkan berlaku di masa depan (dipakai SA-02).
 */
export interface PublishPricingInput {
  coinPriceIdr: number;
  scanCostCoins: number;
  scanCachedCostCoins: number;
  lessonRewardCoins: number;
  cvCostCoins: number;
  interviewCostCoins: number;
  statementCostCoins: number;
  promptRunCostCoins: number;
  freezeCostCoins: number;
  packages: PricingPackageOption[];
  activeFrom?: Date;
}

/** Nama kunci advisory lock — lihat komentar `publishNewVersion`. */
const PUBLISH_LOCK_NAME = 'pricing_config:publish';
const MAX_PUBLISH_RETRIES = 3;

/** Kode error PostgreSQL untuk unique_violation (dokumentasi resmi PostgreSQL, Appendix A.1). */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  );
}

// Kolomnya `integer` (int4) di db/migrations/001_init.sql — batas atas eksplisit
// mencegah angka yang lolos validasi tapi ditolak PostgreSQL sebagai
// "integer out of range" (koreksi audit P-01, T-4).
const MAX_INT4 = 2_147_483_647;

function assertPositiveInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value <= 0 || value > MAX_INT4) {
    throw new BadRequestException({
      code: 'INVALID_PRICING_PAYLOAD',
      message: `Field "${field}" harus bilangan bulat positif, maksimal ${MAX_INT4}`,
      details: { field, value },
    });
  }
}

function assertPackages(packages: PricingPackageOption[]): void {
  if (packages.length === 0) {
    throw new BadRequestException({
      code: 'INVALID_PRICING_PAYLOAD',
      message: 'Minimal satu paket top-up wajib diisi',
      details: { field: 'packages' },
    });
  }

  const seenIds = new Set<string>();
  for (const pkg of packages) {
    if (!pkg.id || !pkg.name) {
      throw new BadRequestException({
        code: 'INVALID_PRICING_PAYLOAD',
        message: 'Setiap paket wajib punya id dan name',
        details: { package: pkg },
      });
    }
    if (seenIds.has(pkg.id)) {
      throw new BadRequestException({
        code: 'INVALID_PRICING_PAYLOAD',
        message: `id paket duplikat: "${pkg.id}"`,
        details: { field: 'packages', duplicateId: pkg.id },
      });
    }
    seenIds.add(pkg.id);
    assertPositiveInteger(pkg.coins, `packages.${pkg.id}.coins`);
    assertPositiveInteger(pkg.price_idr, `packages.${pkg.id}.price_idr`);
  }
}

/**
 * P-01 · pricing_config berversi — docs/PRD.md §6, §10.3 `GET /pricing`.
 *
 * APPEND-ONLY, semangatnya sama dengan `coin_ledger` (CLAUDE.md aturan 1)
 * walau ini bukan ledger uang: menerbitkan harga baru SELALU insert baris
 * versi baru, TIDAK PERNAH UPDATE baris lama. Tidak ada method `update*` di
 * kelas ini sama sekali — append-only ditegakkan secara struktural, bukan
 * cuma janji di komentar. Order lama membaca harganya lewat
 * `orders.pricing_version` (FK ke tabel ini, docs/PRD.md PA-4), jadi "harga
 * lama tetap terbaca" otomatis benar selama baris versi lama tidak disentuh.
 */
@Injectable()
export class PricingConfigService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Versi yang berlaku SEKARANG: `version` terbesar dengan `active_from <= now()`.
   *
   * Kenapa bukan cuma `MAX(version)`: kolom `active_from` sudah punya default
   * `now()` di migrasi, jadi publish biasa langsung berlaku dan hasilnya
   * identik dengan `MAX(version)` untuk kasus itu. Tapi memfilter
   * `active_from <= now()` di sini membuat penjadwalan harga (dipakai SA-02
   * nanti — mis. harga baru berlaku mulai tanggal tertentu) tidak butuh
   * migrasi atau perubahan kode baca tambahan: cukup isi `active_from` di
   * masa depan saat publish, dan baris itu diam-diam menunggu sampai
   * waktunya sebelum terlihat di sini.
   */
  async getCurrentVersion(): Promise<PricingConfigRow | undefined> {
    return this.db
      .selectFrom('pricing_config')
      .selectAll()
      .where('active_from', '<=', new Date())
      .orderBy('version', 'desc')
      .limit(1)
      .executeTakeFirst();
  }

  /**
   * Versi SPESIFIK by PK — dipakai order lama untuk tetap membaca harga
   * aslinya (docs/PRD.md PA-4) walau versi yang lebih baru sudah terbit.
   */
  async getVersion(version: number): Promise<PricingConfigRow | undefined> {
    return this.db.selectFrom('pricing_config').selectAll().where('version', '=', version).executeTakeFirst();
  }

  /**
   * Menerbitkan versi harga baru. INSERT-only — lihat komentar kelas.
   *
   * Konkurensi: `version` adalah integer PK biasa (bukan serial/identity),
   * jadi nomor berikutnya DIHITUNG di sini (`MAX(version)+1`), bukan
   * digenerate database. `SELECT ... FOR UPDATE` tidak cukup untuk menutup
   * race ini: kalau tabel sedang KOSONG (atau versi terbesar belum ada baris
   * yang bisa dikunci), dua transaksi publish yang berjalan bersamaan
   * sama-sama melihat "belum ada baris" dan sama-sama mencoba menulis
   * `version = 1`. Karena itu dipakai advisory lock BERNAMA
   * (`pg_advisory_xact_lock`), yang mengunci terlepas dari isi tabel —
   * dilepas otomatis saat transaksi commit/rollback. Unique constraint pada
   * `version` tetap jadi jaring pengaman terakhir: kalau tetap ada tabrakan
   * (mis. dua proses beda yang belum tentu lewat service ini), publish
   * di-retry beberapa kali dengan nomor baru, dan menyerah dengan error yang
   * jelas — bukan crash mentah — kalau tetap gagal.
   */
  async publishNewVersion(data: PublishPricingInput, actorId: string): Promise<PricingConfigRow> {
    assertPositiveInteger(data.coinPriceIdr, 'coinPriceIdr');
    assertPositiveInteger(data.scanCostCoins, 'scanCostCoins');
    assertPositiveInteger(data.scanCachedCostCoins, 'scanCachedCostCoins');
    assertPositiveInteger(data.lessonRewardCoins, 'lessonRewardCoins');
    assertPositiveInteger(data.cvCostCoins, 'cvCostCoins');
    assertPositiveInteger(data.interviewCostCoins, 'interviewCostCoins');
    assertPositiveInteger(data.statementCostCoins, 'statementCostCoins');
    assertPositiveInteger(data.promptRunCostCoins, 'promptRunCostCoins');
    assertPositiveInteger(data.freezeCostCoins, 'freezeCostCoins');
    assertPackages(data.packages);

    for (let attempt = 1; attempt <= MAX_PUBLISH_RETRIES; attempt += 1) {
      try {
        return await this.db.transaction().execute(async (trx) => {
          // Terikat transaksi (xact), bukan sesi — lepas otomatis saat
          // commit/rollback, tidak perlu unlock manual.
          await sql`select pg_advisory_xact_lock(hashtext(${PUBLISH_LOCK_NAME})::bigint)`.execute(trx);

          const latest = await trx
            .selectFrom('pricing_config')
            .select('version')
            .orderBy('version', 'desc')
            .limit(1)
            .executeTakeFirst();

          const nextVersion = (latest?.version ?? 0) + 1;

          const values: Insertable<DB['pricing_config']> = {
            version: nextVersion,
            coin_price_idr: data.coinPriceIdr,
            scan_cost_coins: data.scanCostCoins,
            scan_cached_cost_coins: data.scanCachedCostCoins,
            lesson_reward_coins: data.lessonRewardCoins,
            cv_cost_coins: data.cvCostCoins,
            interview_cost_coins: data.interviewCostCoins,
            statement_cost_coins: data.statementCostCoins,
            prompt_run_cost_coins: data.promptRunCostCoins,
            freeze_cost_coins: data.freezeCostCoins,
            // JSON.stringify MANUAL wajib di sini. node-postgres hanya
            // men-serialize objek POLOS ke JSON otomatis; array top-level
            // (kasus kita — `packages` adalah array) malah diperlakukan
            // sebagai Postgres array literal (`{...}`), bukan JSON, dan
            // ditolak kolom jsonb dengan error "invalid input syntax for
            // type json". Ketahuan dari test integrasi database nyata
            // (pricing-config.service.spec.ts) — bukan asumsi dari membaca
            // dokumentasi pg. Cast `as unknown as ...` karena `Insertable`
            // hasil codegen mengharap `Json` (union `JsonValue`), sedangkan
            // yang dikirim ke driver sekarang memang string JSON mentah.
            packages: JSON.stringify(data.packages) as unknown as Insertable<DB['pricing_config']>['packages'],
            created_by: actorId,
            ...(data.activeFrom ? { active_from: data.activeFrom } : {}),
          };

          return trx.insertInto('pricing_config').values(values).returningAll().executeTakeFirstOrThrow();
        });
      } catch (error) {
        if (isUniqueViolation(error) && attempt < MAX_PUBLISH_RETRIES) {
          continue; // versi keburu diambil transaksi lain — coba nomor berikutnya
        }
        if (isUniqueViolation(error)) {
          throw new ConflictException({
            code: 'PRICING_VERSION_CONFLICT',
            message: 'Versi harga sedang diterbitkan proses lain, coba lagi',
            details: { attempts: MAX_PUBLISH_RETRIES },
          });
        }
        throw error;
      }
    }

    // Tidak pernah tercapai — setiap iterasi di atas selalu `return` atau
    // `throw`. TypeScript tidak bisa membuktikan itu untuk loop `for` dengan
    // batas non-literal, jadi tetap butuh jalur keluar eksplisit di sini.
    throw new ConflictException({
      code: 'PRICING_VERSION_CONFLICT',
      message: 'Versi harga sedang diterbitkan proses lain, coba lagi',
      details: { attempts: MAX_PUBLISH_RETRIES },
    });
  }
}
