import { Module } from '@nestjs/common';

/**
 * Profil pengguna, zona waktu, peran — docs/PRD.md §2, §9.3
 *
 * KERANGKA KOSONG. Controller & service menyusul di item: A-01.
 *
 * `users.coin_balance` adalah CACHE, bukan kebenaran. Kebenarannya
 * SUM(coin_ledger.amount). Modul ini TIDAK PERNAH menulis kolom itu —
 * hanya CoinLedgerService yang boleh (CLAUDE.md aturan 2 & 3).
 */
@Module({})
export class UsersModule {}
