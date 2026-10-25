import { Module } from '@nestjs/common';

import { WalletModule } from '../wallet';

import { MentorController } from './mentor.controller';
import { MentorService } from './mentor.service';

/**
 * E11 · Konsol mentor — docs/PRD.md §7 E11, `PR-04` (Dev B).
 *
 * `PR-6`: approve → `earn_review` 15 koin untuk reviewer, tepat sekali —
 * koin lahir DI SINI, bukan saat submit (PR-02 memang tidak menulis koin).
 * `PR-7`: antrean dan validasi scoped ke squad binaan AKTOR — cek KEPEMILIKAN
 * di service (PRD §2.5), guard hanya tahu peran.
 *
 * `CoinLedgerService` datang dari `WalletModule` (aturan keras 3: tidak ada
 * kode lain yang boleh INSERT ke coin_ledger). Tidak ada migrasi — kolom
 * `mentor_checked` sudah ada sejak 001, catatan mentor masuk `audit_log`.
 *
 * `GET /mentor/squads` (PRD §10.3) BELUM dibangun: tidak ada di acceptance
 * criteria PR-04, dan datanya lintas epik ("anggota berisiko putus streak"
 * butuh pembacaan streak per anggota). Item terpisah, bukan diam-diam
 * dikerdilkan di sini.
 */
@Module({
  imports: [WalletModule],
  controllers: [MentorController],
  providers: [MentorService],
  exports: [MentorService],
})
export class MentorModule {}
