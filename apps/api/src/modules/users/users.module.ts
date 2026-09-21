import { Module } from '@nestjs/common';

import { KyselyModule } from '../../infra/kysely';
import { ProfileService } from './profile.service';
import { UsersController } from './users.controller';

/**
 * Profil pengguna, zona waktu, peran — docs/PRD.md §2, §9.3
 *
 * `users.coin_balance` adalah CACHE, bukan kebenaran. Kebenarannya
 * SUM(coin_ledger.amount). Modul ini TIDAK PERNAH menulis kolom itu —
 * hanya CoinLedgerService yang boleh (CLAUDE.md aturan 2 & 3). `PATCH /me`
 * memakai daftar putih field, jadi larangan itu berlaku secara konstruksi.
 */
@Module({
  imports: [KyselyModule],
  controllers: [UsersController],
  providers: [ProfileService],
  exports: [ProfileService],
})
export class UsersModule {}
