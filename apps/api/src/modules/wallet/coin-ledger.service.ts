import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import { InsufficientCoinsError } from './insufficient-coins.error';
import type {
  DriftRow,
  HoldParams,
  LedgerEntry,
  ReleaseParams,
  SettleParams,
  Trx,
  WriteParams,
} from './coin-ledger.types';

/**
 * Satu-satunya jalan koin berpindah di seluruh sistem.
 *
 * TIDAK ADA kode lain di repo ini yang boleh `INSERT INTO coin_ledger` atau
 * `UPDATE users.coin_balance`. Store, scan, payment, attempt — semuanya lewat
 * sini (CLAUDE.md aturan 3).
 *
 * Empat hal yang membentuk setiap method di bawah:
 *
 * 1. **`coin_ledger` append-only.** Trigger database menolak UPDATE dan DELETE.
 *    Koreksi ditulis sebagai entri `adjust` BARU (CO-1, CO-2).
 *
 * 2. **`users.coin_balance` adalah CACHE.** Kebenarannya `SUM(coin_ledger.amount)`.
 *    Menulis saldo tanpa menulis ledger di transaksi yang sama adalah bug,
 *    meski angkanya kebetulan benar hari itu (CO-3).
 *
 * 3. **`SELECT … FOR UPDATE` sebelum setiap penulisan.** Itu titik serialisasi
 *    per pengguna, dan satu-satunya alasan dua request paralel tidak bisa
 *    sama-sama membaca saldo 100 lalu sama-sama mendebit 80 (CO-4).
 *
 * 4. **Setiap method menerima `trx`.** Tidak ada satu pun yang membuka
 *    transaksinya sendiri — pemanggilnya yang memiliki batas transaksi, karena
 *    penulisan koin selalu bagian dari sesuatu yang lebih besar (attempt,
 *    order, scan) dan harus ikut di-rollback bersamanya.
 */
@Injectable()
export class CoinLedgerService {
  /**
   * Menulis satu entri ledger dan memperbarui cache saldo, atomik.
   *
   * Idempoten dua lapis (CO-5):
   *   - `idempotency_key UNIQUE`
   *   - partial unique index `(ref_type, ref_id, entry_type) WHERE ref_id IS NOT NULL`
   *
   * Kalau salah satu kunci itu sudah ada, entri LAMA dikembalikan apa adanya
   * dan tidak ada saldo yang berubah. Itu yang membuat worker yang retry — dan
   * webhook yang dikirim tiga kali — tidak menggandakan koin.
   */
  async write(trx: Trx, params: WriteParams): Promise<LedgerEntry> {
    const { userId, entryType, amount, refType, refId, idempotencyKey, note } = params;

    // Cek idempotensi SEBELUM mengunci: kalau entrinya sudah ada, tidak ada
    // alasan menahan baris users dan memperlambat request lain.
    const existing = await this.findExisting(trx, params);
    if (existing) return existing;

    // Titik serialisasi. Sejak baris ini sampai commit, tidak ada transaksi
    // lain yang bisa membaca saldo pengguna ini — itulah yang membuat
    // pemeriksaan saldo di bawah bisa dipercaya.
    const user = await trx
      .selectFrom('users')
      .select(['id', 'coin_balance'])
      .where('id', '=', userId)
      .forUpdate()
      .executeTakeFirst();

    if (!user) throw new Error(`Pengguna tidak ditemukan: ${userId}`);

    // Entri bisa saja ditulis transaksi lain selagi kita menunggu kunci.
    // Diperiksa ulang SETELAH mengunci, bukan cuma sebelum.
    const afterLock = await this.findExisting(trx, params);
    if (afterLock) return afterLock;

    const balanceAfter = user.coin_balance + amount;

    // CO-6: saldo TIDAK PERNAH negatif — termasuk untuk `adjust`.
    //
    // Isu #27: teks CO-6 versi lama menjanjikan pengecualian untuk koreksi
    // Superadmin, padahal CHECK `users_coin_balance_non_negative` tidak punya
    // pengecualian apa pun. Jadi `adjust` yang melewati saldo lolos di sini
    // lalu ditolak database dengan pelanggaran constraint mentah — separuh
    // CO-6 tidak pernah bisa dijalankan, dan pemanggil tidak dapat petunjuk
    // apa pun tentang apa yang salah.
    //
    // Diputuskan: saldo tidak pernah negatif, koreksi Superadmin dibatasi
    // saldo yang tersedia. Kedua lapis sekarang sepakat; yang ini ada supaya
    // pesannya berguna, bukan supaya aturannya berbeda.
    if (balanceAfter < 0) {
      throw new InsufficientCoinsError(user.coin_balance, Math.abs(amount));
    }

    const inserted = await trx
      .insertInto('coin_ledger')
      .values({
        user_id: userId,
        entry_type: entryType,
        amount,
        balance_after: balanceAfter,
        ref_type: refType ?? null,
        ref_id: refId ?? null,
        idempotency_key: idempotencyKey ?? null,
        note: note ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    await trx
      .updateTable('users')
      .set({ coin_balance: balanceAfter, updated_at: new Date() })
      .where('id', '=', userId)
      .execute();

    // CO-12: outbox ditulis DI DALAM transaksi yang sama. Event yang ikut
    // ter-commit bersama datanya — bukan penulisan Redis langsung, yang akan
    // bertahan meski transaksinya di-rollback (CLAUDE.md aturan 6).
    await trx
      .insertInto('outbox_events')
      .values({
        topic: 'wallet.updated',
        payload: JSON.stringify({
          user_id: userId,
          balance: balanceAfter,
          entry_type: entryType,
          amount,
        }),
      })
      .execute();

    return this.toEntry(inserted);
  }

  /**
   * Menahan koin untuk pekerjaan yang belum tentu berhasil (CO-7).
   *
   * Hold MEMOTONG saldo langsung — itu bukan pencadangan lunak. Yang
   * membedakannya dari `spend_*` adalah ia punya dua akhir yang mungkin:
   * `settle` (pekerjaan berhasil, potongan jadi permanen) atau `release`
   * (gagal, koin kembali).
   *
   * Polanya wajib untuk semua efek samping berbayar, dan alasannya bukan
   * kerapian: "debit lalu refund manual" berarti ada manusia yang harus tahu
   * bahwa refund dibutuhkan — dan itu tidak terjadi.
   */
  async hold(trx: Trx, params: HoldParams): Promise<LedgerEntry> {
    if (params.amount <= 0) {
      throw new Error(`hold() menerima jumlah POSITIF, dapat: ${params.amount}`);
    }
    return this.write(trx, {
      userId: params.userId,
      entryType: 'hold',
      amount: -params.amount,
      refType: params.refType,
      refId: params.refId,
      idempotencyKey: params.idempotencyKey,
      note: params.note,
    });
  }

  /**
   * Menjadikan hold permanen karena pekerjaannya berhasil.
   *
   * TIDAK MENULIS ENTRI LEDGER, dan itu poin yang paling mudah salah: hold
   * SUDAH memotong saldo. Menulis entri lagi di sini akan memotong dua kali.
   * Settle adalah perubahan status, dan jejaknya di `audit_log` (CO-8).
   *
   * Karena itu idempotensinya dicek di `audit_log`, BUKAN di `coin_ledger` —
   * dua worker yang sama-sama menyetel hold yang sama menghasilkan satu baris
   * audit, yang kedua no-op.
   */
  async settle(trx: Trx, params: SettleParams): Promise<{ settled: boolean }> {
    const { userId, refType, refId, actorId, note } = params;

    const holdEntry = await trx
      .selectFrom('coin_ledger')
      .selectAll()
      .where('user_id', '=', userId)
      .where('ref_type', '=', refType)
      .where('ref_id', '=', refId)
      .where('entry_type', '=', 'hold')
      .executeTakeFirst();

    if (!holdEntry) {
      throw new Error(`Tidak ada hold untuk ${refType}:${refId} milik pengguna ${userId}`);
    }

    // Kunci baris users juga di sini. Settle tidak mengubah saldo, tapi ia
    // mengubah nasib sebuah hold — mengurutkannya terhadap release yang
    // mungkin berjalan bersamaan mencegah keduanya lolos sekaligus.
    await trx
      .selectFrom('users')
      .select('id')
      .where('id', '=', userId)
      .forUpdate()
      .executeTakeFirst();

    // Sudah pernah disetel? Kalau ya, ini no-op.
    const already = await this.findAudit(trx, 'coin.settle', refType, refId);
    if (already) return { settled: false };

    // Hold yang sudah dilepas tidak boleh disetel — koinnya sudah kembali.
    const released = await trx
      .selectFrom('coin_ledger')
      .select('id')
      .where('user_id', '=', userId)
      .where('ref_type', '=', refType)
      .where('ref_id', '=', refId)
      .where('entry_type', '=', 'release')
      .executeTakeFirst();

    if (released) {
      throw new Error(
        `Hold ${refType}:${refId} sudah di-release, tidak bisa di-settle. ` +
          'Ini menandakan ada dua jalur yang mengklaim hold yang sama.',
      );
    }

    await trx
      .insertInto('audit_log')
      .values({
        actor_id: actorId ?? null,
        action: 'coin.settle',
        subject_type: refType,
        subject_id: refId,
        after: JSON.stringify({
          hold_ledger_id: String(holdEntry.id),
          amount: holdEntry.amount,
          note: note ?? null,
        }),
      })
      .execute();

    return { settled: true };
  }

  /**
   * Mengembalikan hold penuh karena pekerjaannya gagal (CO-9).
   *
   * Idempoten: dipanggil dua kali hanya menulis satu entri `release`, dan
   * saldo kembali tepat satu kali. Jaminannya bukan dari pengecekan di kode
   * ini saja tapi dari partial unique index `(ref_type, ref_id, entry_type)` —
   * dua worker paralel pun tidak bisa menembusnya.
   *
   * Mengembalikan `null` kalau tidak ada hold untuk referensi itu, bukan
   * melempar — reaper memanggil ini untuk banyak referensi sekaligus dan
   * sebagiannya mungkin sudah selesai.
   */
  async release(trx: Trx, params: ReleaseParams): Promise<LedgerEntry | null> {
    const { userId, refType, refId, reason, actorId } = params;

    const holdEntry = await trx
      .selectFrom('coin_ledger')
      .selectAll()
      .where('user_id', '=', userId)
      .where('ref_type', '=', refType)
      .where('ref_id', '=', refId)
      .where('entry_type', '=', 'hold')
      .executeTakeFirst();

    if (!holdEntry) return null;

    // Hold yang sudah disetel tidak boleh dilepas — potongannya sudah permanen.
    const settled = await this.findAudit(trx, 'coin.settle', refType, refId);
    if (settled) return null;

    // `hold.amount` negatif; dibalik jadi positif untuk dikembalikan.
    const entry = await this.write(trx, {
      userId,
      entryType: 'release',
      amount: -holdEntry.amount,
      refType,
      refId,
      note: reason,
    });

    await trx
      .insertInto('audit_log')
      .values({
        actor_id: actorId ?? null,
        action: 'coin.release',
        subject_type: refType,
        subject_id: refId,
        after: JSON.stringify({ hold_ledger_id: String(holdEntry.id), reason }),
      })
      .execute();

    return entry;
  }

  /**
   * Mencari pengguna yang cache saldonya menyimpang dari jumlah ledger (CO-11).
   *
   * Dipakai job rekonsiliasi harian. Sengaja hanya MEMBACA: selisih TIDAK
   * diperbaiki otomatis, karena memperbaikinya diam-diam menghapus satu-satunya
   * bukti tentang apa yang menyebabkannya. Catat, alarmkan, lalu lacak.
   */
  async findDrift(trx: Trx): Promise<DriftRow[]> {
    const rows = await sql<{
      user_id: string;
      cached_balance: number;
      ledger_sum: string | number | null;
    }>`
      SELECT u.id AS user_id,
             u.coin_balance AS cached_balance,
             COALESCE(SUM(l.amount), 0) AS ledger_sum
      FROM users u
      LEFT JOIN coin_ledger l ON l.user_id = u.id
      GROUP BY u.id, u.coin_balance
      HAVING u.coin_balance <> COALESCE(SUM(l.amount), 0)
    `.execute(trx);

    return rows.rows.map((r) => {
      const ledgerSum = Number(r.ledger_sum ?? 0);
      return {
        userId: r.user_id,
        cachedBalance: r.cached_balance,
        ledgerSum,
        drift: r.cached_balance - ledgerSum,
      };
    });
  }

  /** Saldo menurut LEDGER, bukan menurut cache. Dipakai test dan rekonsiliasi. */
  async trueBalance(trx: Trx, userId: string): Promise<number> {
    const row = await trx
      .selectFrom('coin_ledger')
      .select((eb) => eb.fn.sum<string>('amount').as('total'))
      .where('user_id', '=', userId)
      .executeTakeFirst();
    return Number(row?.total ?? 0);
  }

  // ── internal ────────────────────────────────────────────────────────────

  /** Mencari entri yang sudah ada lewat salah satu dari dua kunci idempotensi. */
  private async findExisting(trx: Trx, params: WriteParams): Promise<LedgerEntry | null> {
    if (params.idempotencyKey) {
      const byKey = await trx
        .selectFrom('coin_ledger')
        .selectAll()
        .where('idempotency_key', '=', params.idempotencyKey)
        .executeTakeFirst();
      if (byKey) return this.toEntry(byKey);
    }

    if (params.refType && params.refId) {
      const byRef = await trx
        .selectFrom('coin_ledger')
        .selectAll()
        .where('ref_type', '=', params.refType)
        .where('ref_id', '=', params.refId)
        .where('entry_type', '=', params.entryType)
        .executeTakeFirst();
      if (byRef) return this.toEntry(byRef);
    }

    return null;
  }

  private async findAudit(
    trx: Trx,
    action: string,
    refType: string,
    refId: string,
  ): Promise<boolean> {
    const row = await trx
      .selectFrom('audit_log')
      .select('id')
      .where('action', '=', action)
      .where('subject_type', '=', refType)
      .where('subject_id', '=', refId)
      .executeTakeFirst();
    return row !== undefined;
  }

  private toEntry(row: {
    id: string | number | bigint;
    user_id: string;
    entry_type: LedgerEntry['entryType'];
    amount: number;
    balance_after: number;
    ref_type: string | null;
    ref_id: string | null;
    created_at: Date;
  }): LedgerEntry {
    return {
      id: String(row.id),
      userId: row.user_id,
      entryType: row.entry_type,
      amount: row.amount,
      balanceAfter: row.balance_after,
      refType: row.ref_type,
      refId: row.ref_id,
      createdAt: row.created_at,
    };
  }
}
