import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';

import { CurrentUserId, Roles, RolesGuard, SessionGuard } from '../../common/guards';
import { MentorService, type AntreanMentorItem, type HasilValidasi } from './mentor.service';

/** Bentuk body `POST /mentor/reviews/:id/validate`. Divalidasi di service. */
interface ValidateBody {
  decision?: unknown;
  note?: unknown;
}

/**
 * `GET /mentor/queue` dan `POST /mentor/reviews/:id/validate` — PRD §10.3,
 * `PR-04` (Dev B).
 *
 * ── Dua rute, dua himpunan peran — dan keduanya disengaja ──
 *
 * `GET /mentor/queue` = KONSOL (mentor + superadmin): membaca antrean tidak
 * mengubah apa pun, dan ACCESS_MATRIX sudah menuliskannya begitu. Superadmin
 * tetap melihat ANTREAN KOSONG — ia bukan `squads.mentor_id` siapa pun,
 * scope-nya dihitung di service dari aktornya.
 *
 * `POST /mentor/reviews/:id/validate` = mentor SAJA. Memvalidasi review
 * mencetak koin, dan itu pekerjaan mentor, bukan tombol darurat admin —
 * "superadmin boleh segalanya" justru yang dihindari PRD §2.4.
 *
 * ── Tanpa `⚡` idempotency-key, dan itu bukan kelalaian ──
 *
 * PRD §10.3 tidak menandai rute ini ⚡. Idempotensinya NATURAL: `mentor_checked`
 * + `coin_ledger_ref_uniq` — dua approve atas review yang sama menghasilkan
 * SATU entri koin apa pun kuncinya. Kunci yang dikirim klien tidak menambah
 * perlindungan apa pun di atas itu.
 */
@UseGuards(SessionGuard, RolesGuard)
@Controller('mentor')
export class MentorController {
  constructor(private readonly mentor: MentorService) {}

  /**
   * Antrean validasi review anggota squad binaan pemanggil.
   *
   * Respons tidak memuat identitas PENULIS attempt — `AntreanMentorItem`
   * tidak punya field-nya (semangat PR-2: identitas penulis tidak berpindah
   * ke layar mana pun tanpa keputusan eksplisit).
   */
  @Get('queue')
  @Roles('mentor', 'superadmin')
  async queue(@CurrentUserId() actorId: string): Promise<AntreanMentorItem[]> {
    return this.mentor.queueFor(actorId);
  }

  /**
   * Menyetujui / menolak satu review (`:id` = peer_reviews.id).
   *
   * Bentuk body divalidasi `validasiKeputusan()` di service — bukan hanya di
   * sini — supaya jalur non-HTTP tidak bisa melewatinya.
   */
  @Post('reviews/:id/validate')
  @Roles('mentor')
  async validate(
    @CurrentUserId() mentorId: string,
    @Param('id') reviewId: string,
    @Body() body: ValidateBody,
  ): Promise<HasilValidasi> {
    return this.mentor.validate({
      mentorId,
      reviewId,
      decision: body?.decision,
      note: body?.note,
    });
  }
}
