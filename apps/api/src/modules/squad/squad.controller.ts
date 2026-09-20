import { Controller, Get, Header, Param, UseGuards } from '@nestjs/common';

import { CurrentUser, Roles, RolesGuard, SessionGuard } from '../../common/guards';
import type { UserRole } from '../../common/guards';
import { type MySquad, type SquadMemberView, SquadReadService } from './squad-read.service';

/**
 * `GET /squads/me` dan `GET /squads/:id/leaderboard` — PRD §10.3, item `Q-06`.
 *
 * Superadmin DITOLAK di kedua rute, sesuai `ACCESS_MATRIX`. Squad adalah
 * tempat orang belajar bersama, bukan objek administrasi; untuk keperluan
 * audit ada view `admin_*` yang tercatat (`SA-01`).
 */
@UseGuards(SessionGuard, RolesGuard)
@Roles('student', 'mentor')
@Controller('squads')
export class SquadController {
  constructor(private readonly squads: SquadReadService) {}

  /**
   * Squad milik si pemanggil.
   *
   * **Bukan 404 kalau belum punya squad.** Pengguna baru memang belum punya:
   * squad dibentuk job mingguan (`Q-01`), bukan saat registrasi. 404 akan
   * membuat layar Hub menampilkan galat di hari pertama seseorang memakai
   * produk ini.
   *
   * Dibungkus `{ squad }`, TIDAK mengembalikan `null` telanjang. Handler Nest
   * yang mengembalikan `null` mengirim **200 dengan body KOSONG**, dan
   * `response.json()` melempar `Unexpected end of JSON input` — di test maupun
   * di peramban. Ketahuan dari test, bukan dari kode; sebelum itu bentuknya
   * terlihat benar.
   */
  @Get('me')
  async me(
    @CurrentUser() actor: { id: string; role: UserRole },
  ): Promise<{ squad: MySquad | null }> {
    return { squad: await this.squads.mySquad(actor.id) };
  }

  /**
   * Papan peringkat satu squad, dari ZSET Redis.
   *
   * `max-age=30` sesuai PRD §10.3 — sama dengan interval polling fallback di
   * `Q-05`/`RT-02`. Klien yang sudah punya WebSocket tidak akan memintanya
   * sesering itu; yang tidak punya, memintanya tiap 30 detik dan seharusnya
   * mendapat jawaban dari cache-nya sendiri, bukan dari Redis kami.
   *
   * `private`, bukan `public`: isinya bergantung siapa yang bertanya (hanya
   * anggota yang boleh), jadi proxy bersama tidak boleh menyimpannya untuk
   * orang berikutnya.
   */
  @Get(':id/leaderboard')
  @Header('Cache-Control', 'private, max-age=30')
  async leaderboard(
    @Param('id') squadId: string,
    @CurrentUser() actor: { id: string; role: UserRole },
  ): Promise<SquadMemberView[]> {
    return this.squads.leaderboardOf(squadId, actor);
  }
}
