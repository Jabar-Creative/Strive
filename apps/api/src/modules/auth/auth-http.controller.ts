import { All, Controller, Inject, Req, Res } from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { toNodeHandler } from 'better-auth/node';

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
  private readonly handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>;

  constructor(@Inject(AUTH) auth: StriveAuth) {
    this.handler = toNodeHandler(auth);
  }

  /** Rute tanpa segmen (mis. GET /api/v1/auth/ok untuk probe). */
  @All('auth')
  async root(@Req() req: IncomingMessage, @Res() res: ServerResponse): Promise<void> {
    await this.handler(req, res);
  }

  /** Seluruh endpoint Better-Auth bercabang di bawah sini. */
  // `auth/*` — wildcard POLOS. Sintaks bernama `auth/*path` adalah grammar
  // Express 5 / path-to-regexp v6; di Express 4 yang terpasang di repo ini
  // ia dikira splat + literal "path", rute tidak pernah cocok, dan semua
  // endpoint 404. (Dibuktikan lewat spec isolasi rute sebelum fix ini.)
  @All('auth/*')
  async proxy(@Req() req: IncomingMessage, @Res() res: ServerResponse): Promise<void> {
    await this.handler(req, res);
  }
}
