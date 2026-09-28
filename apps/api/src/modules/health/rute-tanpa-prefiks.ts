import { PATH_METADATA } from '@nestjs/common/constants';

import { HealthController } from './health.controller';

/**
 * Rute health yang DIKECUALIKAN dari prefiks global `/api/v1` — `main.ts`.
 *
 * ── Kenapa daftarnya di sini, bukan ditulis langsung di main.ts ──
 *
 * Karena versi pertamanya salah, dan salahnya tidak terlihat dari mana pun.
 * `setGlobalPrefix('api/v1', { exclude: ['health'] })` mengecualikan path
 * PERSIS `health` — bukan `health/*`. Jadi `GET /health/ready` yang baru
 * ditambahkan (isu #155) mendarat di `/api/v1/health/ready`, sementara
 * seluruh alasan pengecualian itu ada adalah supaya **probe orkestrator
 * tidak ikut berubah saat versi API naik**.
 *
 * Gejalanya paling buruk justru untuk probe: orkestrator yang dikonfigurasi
 * ke `/health/ready` mendapat 404, menyimpulkan service tidak sehat, dan
 * me-restart proses yang sebenarnya baik-baik saja. Ditemukan di staging
 * setelah PR-nya merge — `curl /health/ready` menjawab 404 sementara
 * `curl /api/v1/health/ready` menjawab `{"status":"siap"}`.
 *
 * Daftar ini diturunkan dari METADATA controller-nya, bukan diketik ulang.
 * Rute health berikutnya ikut terkecuali tanpa ada yang perlu mengingatnya,
 * dan `rute-tanpa-prefiks.spec.ts` memerah kalau turunannya berhenti cocok.
 */
export function ruteHealthTanpaPrefiks(): string[] {
  const dasar = String(Reflect.getMetadata(PATH_METADATA, HealthController) ?? '');
  const proto = HealthController.prototype as unknown as Record<string, unknown>;

  const jalur = Object.getOwnPropertyNames(proto)
    .filter((nama) => nama !== 'constructor' && typeof proto[nama] === 'function')
    .map((nama) => String(Reflect.getMetadata(PATH_METADATA, proto[nama] as object) ?? ''))
    .map((sub) => [dasar, sub].filter((x) => x.length > 0 && x !== '/').join('/'));

  return [...new Set(jalur)].sort();
}
