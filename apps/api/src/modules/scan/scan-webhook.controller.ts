import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Inject,
  Logger,
  Post,
  Req,
} from '@nestjs/common';

import {
  PLAGIARISM_PROVIDER,
  type PlagiarismProvider,
  isWebhookFailure,
} from './plagiarism-provider';
import { ScanService } from './scan.service';

/** Request Express dengan `rawBody` — lihat catatan di kelas. */
interface RawBodyRequest {
  rawBody?: Buffer;
}

/**
 * `POST /webhooks/copyleaks` — PRD §10.3, `K-03`.
 *
 * ── TIDAK dijaga peran, dan itu keputusan, bukan kelalaian ──
 *
 * Vendor tidak punya sesi dan tidak akan pernah punya. Yang membuktikan
 * request ini sah adalah **tanda tangannya**, sama seperti
 * `POST /webhooks/payment`. `ACCESS_MATRIX` menandainya `allow: []` dengan
 * catatan yang menyebut alasannya — karena rute publik yang tidak dijelaskan
 * tidak bisa dibedakan dari rute yang lupa dijaga.
 *
 * Jebakan yang dihindari di sini tercatat di `CLAUDE.md`: *"menambah koin dari
 * redirect client → koin gratis untuk siapa pun yang tahu URL-nya"*. Webhook
 * scan tidak menambah koin, tapi ia **menyetel hold** — dan hold yang disetel
 * atas perintah orang asing adalah koin yang hilang.
 *
 * ── `rawBody`, bukan `@Body()` yang sudah di-parse ──
 *
 * Tanda tangan dihitung atas **byte yang dikirim**. `JSON.parse` lalu
 * `JSON.stringify` mengubah urutan kunci dan spasi; tanda tangan yang dihitung
 * ulang dari hasil parse tidak akan pernah cocok — atau, kalau seseorang
 * "memperbaikinya" dengan membandingkan bentuk yang sudah dinormalkan, ia
 * berhenti memeriksa apa pun.
 */
@Controller('webhooks')
export class ScanWebhookController {
  private readonly logger = new Logger(ScanWebhookController.name);

  constructor(
    @Inject(PLAGIARISM_PROVIDER) private readonly provider: PlagiarismProvider,
    private readonly scans: ScanService,
  ) {}

  @Post('copyleaks')
  async copyleaks(
    @Headers() headers: Record<string, string>,
    @Body() body: unknown,
    @Req() req: RawBodyRequest,
  ): Promise<{ received: true }> {
    const raw = req.rawBody ?? Buffer.from(JSON.stringify(body ?? {}), 'utf8');

    if (!this.provider.verifyWebhook(headers, raw)) {
      // Dicatat `warn`, dan sengaja TIDAK memuat badan request: kalau ini
      // benar-benar serangan, isinya dikendalikan penyerang dan log kita
      // bukan tempat untuk menyimpannya.
      this.logger.warn(
        `Webhook ${this.provider.name} dengan tanda tangan tidak sah ditolak. ` +
          `Kalau ini sering muncul, ada yang tahu URL webhook kita.`,
      );
      throw new BadRequestException({
        error: {
          code: 'INVALID_SIGNATURE',
          message: 'Tanda tangan webhook tidak sah',
          details: {},
        },
      });
    }

    const hasil = this.provider.parseWebhook(body);

    if (isWebhookFailure(hasil)) {
      // KL-7: kegagalan vendor mengembalikan koin PENUH.
      await this.scans.fail(hasil.scanId, `vendor: ${hasil.error}`);
      return { received: true };
    }

    await this.scans.completeFromWebhook(hasil);
    return { received: true };
  }
}
