import { Injectable } from '@nestjs/common';

import { barisLog, formatJson } from './structured-logger';

export interface KonteksGalat {
  request_id?: string;
  user_id?: string | null;
  route?: string | null;
  status?: number;
}

/**
 * Pelacak galat — `R-04`, PRD §17.
 *
 * ── Antarmuka dulu, vendor belakangan (keputusan Fatih, 23 Sep) ──
 *
 * `.env.example` sudah memuat `SENTRY_DSN`, tapi Sentry **tidak ada di daftar
 * vendor PRD §12**, dan menambah SDK-nya berarti dependensi runtime baru untuk
 * sesuatu yang belum bisa dinyalakan (DSN-nya belum ada, seperti staging di
 * isu #29).
 *
 * Yang dibangun: batasnya. Implementasi hari ini menulis satu baris
 * terstruktur; mengganti implementasinya nanti tidak menyentuh satu pun
 * pemanggil, karena tidak ada pemanggil yang tahu vendornya.
 */
export interface PelacakGalat {
  readonly name: string;
  tangkap(err: unknown, konteks: KonteksGalat): void;
}

export const PELACAK_GALAT = Symbol('PELACAK_GALAT');

/**
 * Implementasi bawaan: satu baris `error` terstruktur.
 *
 * ── Stack trace ikut di LOG, tidak pernah di respons ──
 *
 * Itu pembagian yang penting: stack adalah hal paling berguna saat menelusuri
 * dan paling berbahaya saat bocor. `saring()` di `barisLog` sudah membuang
 * bidang rahasia dari konteksnya.
 */
@Injectable()
export class LoggingErrorTracker implements PelacakGalat {
  readonly name = 'log';

  tangkap(err: unknown, konteks: KonteksGalat): void {
    const pesan = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;

    if (!formatJson()) {
      process.stderr.write(`[galat] ${pesan}\n${stack ?? ''}\n`);
      return;
    }
    process.stderr.write(
      `${barisLog('error', pesan, {
        ...konteks,
        error_name: err instanceof Error ? err.name : typeof err,
        stack: stack ?? null,
      })}\n`,
    );
  }
}
