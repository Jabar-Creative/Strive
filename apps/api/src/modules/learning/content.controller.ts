import { CurrentUserId, Roles, RolesGuard, SessionGuard } from '../../common/guards';
import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';

import { ContentService } from './content.service';
import type { LessonCards, TrackDetail, TrackSummary } from './content.types';

/**
 * Tiga rute baca konten — docs/PRD.md §10.3.
 *
 * Peran yang diizinkan adalah student dan mentor, BUKAN superadmin (§2.4).
 * Penegakannya lewat `@Roles` di item `A-02`; sampai itu ada, `CurrentUserId`
 * menolak request tanpa pengguna, jadi rute ini tertutup — bukan terbuka
 * dengan peran yang salah.
 */
// PRD §2.4: `GET /tracks`, `/lessons/:id/cards` -> student & mentor.
// Superadmin DITOLAK — panel admin bukan pintu ke konten belajar.
@UseGuards(SessionGuard, RolesGuard)
@Roles('student', 'mentor')
@Controller()
export class ContentController {
  constructor(private readonly content: ContentService) {}

  @Get('tracks')
  listTracks(@CurrentUserId() userId: string): Promise<TrackSummary[]> {
    return this.content.listTracks(userId);
  }

  @Get('tracks/:id')
  getTrack(
    @CurrentUserId() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TrackDetail> {
    return this.content.getTrack(userId, id);
  }

  /** Kunci jawaban dibuang di ContentService, bukan di sini — satu tempat. */
  @Get('lessons/:id/cards')
  getLessonCards(@Param('id', ParseUUIDPipe) id: string): Promise<LessonCards> {
    return this.content.getLessonCards(id);
  }
}
