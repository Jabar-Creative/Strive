import { Controller, Get, Query, UseGuards } from '@nestjs/common';

import { CurrentUserId, Roles, RolesGuard, SessionGuard } from '../../common/guards';
import type { HistoryPage } from '../../common/cursor';
import { type MasterySessionSummary, MasteryService } from './mastery.service';

/**
 * `GET /mastery/sessions` — PRD §10.3, item `F-14`.
 *
 * `MT-01` membangun service-nya lengkap dengan pemeriksaan kepemilikan, tapi
 * tidak pernah memasang satu pun rute HTTP — jadi `mastery_sessions` tidak
 * bisa dibaca klien mana pun sampai item ini.
 *
 * ── Kenapa TIDAK ada `GET /mastery/sessions/:id` di sini ──
 *
 * `MasteryService.byId()` sudah ada dan sudah benar, dan rute untuknya terasa
 * wajar. Tapi **PRD §10.3 tidak menjanjikannya**, dan menambah rute yang tidak
 * ada di kontrak adalah penyimpangan yang sama — hanya arahnya terbalik —
 * dengan 12 rute yatim yang ditemukan penyisiran isu #88.
 *
 * Konsekuensinya bentuk riwayat di bawah: `feedback` dan `mentor_note` IKUT,
 * karena tanpa rute detail merekalah satu-satunya cara pengguna membaca ulang
 * umpan balik sesi lama. `turns` tetap tidak ikut — satu sesi wawancara bisa
 * memuat puluhan giliran, dan daftar riwayat tidak menampilkan satu pun.
 * Giliran lengkap dikembalikan `POST /mastery/*` (`MT-02`).
 *
 * `POST /mastery/*` bukan milik `F-14`: membuat sesi dan menambah giliran
 * memanggil AI service lewat `ai_jobs` (aturan 8).
 */
@UseGuards(SessionGuard, RolesGuard)
@Roles('student', 'mentor')
@Controller('mastery/sessions')
export class MasteryController {
  constructor(private readonly mastery: MasteryService) {}

  @Get()
  async history(
    @CurrentUserId() userId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ): Promise<HistoryPage<MasterySessionSummary>> {
    return this.mastery.historyFor(userId, { cursor, limit });
  }
}
