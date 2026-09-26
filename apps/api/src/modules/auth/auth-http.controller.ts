import { All, Controller, Inject, Logger, Req, Res } from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { toNodeHandler } from 'better-auth/node';

import { pasangIpBetterAuth, type SumberIp } from '../../common/client-ip';
import { AUTH, type StriveAuth } from './auth.types';

/**
 * Jembatan HTTP untuk Better-Auth (A-03) — DIBELI, BUKAN DIBANGUN.
 *
 * Seluruh endpoint hidup di sisi Better-Auth (/sign-up/email, /sign-in/email,
 * /sign-out, /get-session, /verify-email, /request-password-reset, dst).
 * Controller ini hanya meneruskan request mentah; ia sengaja TIDAK membaca
 * body, tidak memvalidasi, dan tidak membentuk respons — semua itu milik
 * Better-Auth, dan menyalinnya ke sini berarti menulis logika auth sendiri
 * lewat pintu belakang (CLAUDE.md §Yang dibeli).
 *
 * Tipe req/res memakai node:http, bukan express: toNodeHandler bekerja pada
 * IncomingMessage/ServerResponse, objek express adalah perluasannya, dan
 * memakai tipe express berarti menambah @types/express hanya untuk anotasi
 * yang tidak dipakai isinya.
 */
@Controller()
export class AuthHttpController {
  private readonly log = new Logger(AuthHttpController.name);
  private readonly handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>;

  constructor(@Inject(AUTH) auth: StriveAuth) {
    this.handler = toNodeHandler(auth);
  }

  /**
   * Better-Auth 1.7.5 menolak rantai `X-Forwarded-For` dan, di produksi,
   * semua pengguna lalu berbagi satu ember per path. Header ditimpa menjadi
   * satu IP dari `TRUST_PROXY_HOPS` sebelum handler-nya membaca request.
   * Log ini hanya tiga angka: IP yang dipilih, jumlah entri, dan hop.
   * Rantainya tidak dicetak.
   */
  private teruskan(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const sumber = req as IncomingMessage & SumberIp;
    const ringkas = pasangIpBetterAuth({
      ip: sumber.ip,
      headers: req.headers,
      socket: req.socket,
    });
    this.log.log(
      `pengukuran proxy client_ip=${ringkas.clientIp ?? '-'} xff_count=${ringkas.xffCount} trust_proxy_hops=${ringkas.hops}`,
    );
    return this.handler(req, res);
  }

  /** Rute tanpa segmen (mis. GET /api/v1/auth/ok untuk probe). */
  @All('auth')
  async root(@Req() req: IncomingMessage, @Res() res: ServerResponse): Promise<void> {
    await this.teruskan(req, res);
  }

  /** Seluruh endpoint Better-Auth bercabang di bawah sini. */
  // `auth/*` — wildcard POLOS. Sintaks bernama `auth/*path` adalah grammar
  // Express 5 / path-to-regexp v6; di Express 4 yang terpasang di repo ini
  // ia dikira splat + literal "path", rute tidak pernah cocok, dan semua
  // endpoint 404. (Dibuktikan lewat spec isolasi rute sebelum fix ini.)
  @All('auth/*')
  async proxy(@Req() req: IncomingMessage, @Res() res: ServerResponse): Promise<void> {
    await this.teruskan(req, res);
  }
}
