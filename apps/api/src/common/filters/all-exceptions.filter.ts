import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Inject,
} from '@nestjs/common';

import { HEADER_REQUEST_ID } from '../observability/request-log.interceptor';
import { PELACAK_GALAT, type PelacakGalat } from '../observability/error-tracker';

interface ReqFilter {
  path?: string;
  url?: string;
  route?: { path?: string };
  user?: { id?: string };
  headers: Record<string, string | string[] | undefined>;
}

/**
 * Satu-satunya tempat respons galat dibentuk — `R-04`, temuan `R-03` T-2,
 * PRD §10.1.
 *
 * > `{ "error": { "code": "...", "message": "...", "details": {} } }` —
 * > **`code` adalah kontrak, `message` bukan.**
 *
 * Sebelum ini **tidak ada exception filter sama sekali** (`common/filters/`
 * hanya berisi `export {}`). Respons 4xx patuh karena dilempar manual dengan
 * bentuk itu; respons **500 tidak**, karena `BaseExceptionFilter` bawaan Nest
 * menjawab `{"statusCode":500,"message":"Internal server error"}`. Klien yang
 * mencabang pada `error.code` — yang persis diminta §10.1 — mendapat
 * `undefined` tepat di saat terburuk.
 *
 * ── Apa yang TIDAK berubah, dan itu disengaja ──
 *
 * Isi respons 500 tetap tidak memuat pesan galat aslinya, apalagi stack. Yang
 * berubah hanya BENTUKNYA. Galat internal sering memuat nama tabel, potongan
 * query, dan sesekali nilai parameter — dan tidak satu pun dari itu urusan
 * klien.
 *
 * ── Kenapa di sini juga tempat pelacak galat dipanggil ──
 *
 * Karena ini satu-satunya jalur yang dilewati SETIAP galat yang tidak
 * tertangani. Memanggil pelacak dari titik-titik lemparan berarti
 * mengandalkan setiap penulis kode mengingatnya.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(@Inject(PELACAK_GALAT) private readonly pelacak: PelacakGalat) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') throw exception;

    const ctx = host.switchToHttp();
    const req = ctx.getRequest<ReqFilter>();
    const res = ctx.getResponse<{
      status(code: number): { json(body: unknown): void };
      getHeader(n: string): unknown;
    }>();

    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    if (status >= 500) {
      const id = res.getHeader(HEADER_REQUEST_ID);
      this.pelacak.tangkap(exception, {
        request_id: typeof id === 'string' ? id : undefined,
        user_id: req.user?.id ?? null,
        route: req.route?.path ?? req.path ?? req.url ?? null,
        status,
      });
    }

    res.status(status).json(bentukGalat(exception, status));
  }
}

/**
 * Bentuk §10.1, apa pun yang dilempar.
 *
 * Exception yang SUDAH membawa bentuk itu diteruskan apa adanya — seluruh
 * modul melempar `{ error: { code, … } }` dan membungkusnya lagi akan
 * mengubur `code` yang justru kontraknya.
 */
function bentukGalat(exception: unknown, status: number): unknown {
  if (exception instanceof HttpException) {
    const isi = exception.getResponse();
    // Diperiksa bahwa `error` adalah OBJEK ber-`code`, bukan sekadar ada.
    // Exception bawaan Nest memakai bentuk
    // `{ statusCode, message, error: 'Not Found' }` — `error`-nya STRING, dan
    // pemeriksaan `'error' in isi` meloloskannya apa adanya. Akibatnya setiap
    // 404/403 dari framework lolos dalam bentuk Nest, bukan bentuk §10.1,
    // sementara test yang hanya memeriksa 500 tetap hijau.
    if (berbentukKontrak(isi)) return isi;

    // Exception Nest bawaan (`NotFoundException` dari router, `ForbiddenException`
    // dari guard) memakai bentuknya sendiri. Dipetakan, bukan dibiarkan bocor
    // dalam dua bentuk berbeda untuk satu API.
    return {
      error: {
        code: KODE_HTTP[status] ?? 'VALIDATION_ERROR',
        message: pesanDari(isi),
        details: {},
      },
    };
  }

  return {
    error: {
      code: 'INTERNAL_ERROR',
      // Pesan statis. Galat internal memuat nama tabel dan potongan query.
      message: 'Terjadi kesalahan di server',
      details: {},
    },
  };
}

/** `true` hanya untuk badan yang SUDAH berbentuk `{ error: { code, … } }`. */
function berbentukKontrak(isi: unknown): boolean {
  if (typeof isi !== 'object' || isi === null) return false;
  const e = (isi as { error?: unknown }).error;
  return typeof e === 'object' && e !== null && typeof (e as { code?: unknown }).code === 'string';
}

/** Kode §10.2 untuk status yang dihasilkan framework, bukan kode kita. */
const KODE_HTTP: Record<number, string> = {
  400: 'VALIDATION_ERROR',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN_ROLE',
  404: 'NOT_FOUND',
  429: 'RATE_LIMITED',
};

function pesanDari(isi: unknown): string {
  if (typeof isi === 'string') return isi;
  if (typeof isi === 'object' && isi !== null) {
    const m = (isi as { message?: unknown }).message;
    if (typeof m === 'string') return m;
    if (Array.isArray(m)) return m.join(', ');
  }
  return 'Permintaan tidak bisa diproses';
}
