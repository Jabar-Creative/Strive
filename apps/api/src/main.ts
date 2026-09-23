import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { StructuredLogger, appOrigins, headerKeamanan } from './common';
import { RedisIoAdapter } from './realtime';
import { WorkerModule } from './workers';

/**
 * Satu image, dua peran — dipilih lewat `MODE`.
 *
 *   MODE=api     REST + WebSocket gateway dalam SATU proses (docs/PRD.md §8.1)
 *   MODE=worker  pool BullMQ: outbox, scan, ai-dispatch, notify, league-rollup,
 *                reconcile-balance, reaper. Tidak mendengarkan HTTP.
 *
 * Worker dipisah dari API karena pekerjaan menit-an tidak boleh menahan koneksi
 * HTTP, dan skalanya independen dari trafik (docs/PRD.md §8.2).
 */
type Mode = 'api' | 'worker';

function resolveMode(): Mode {
  const raw = process.env['MODE'] ?? 'api';
  if (raw !== 'api' && raw !== 'worker') {
    throw new Error(`MODE tidak dikenal: "${raw}". Yang sah: api | worker.`);
  }
  return raw;
}

async function bootstrapApi(): Promise<void> {
  const port = Number(process.env['API_PORT'] ?? 3001);
  // `rawBody: true` — WAJIB, dan kalau hilang yang rusak cuma di PRODUKSI.
  //
  // Verifikasi tanda tangan webhook (Midtrans & Copyleaks) dihitung atas BYTE
  // yang dikirim. Tanpa opsi ini `req.rawBody` undefined, controller jatuh ke
  // `JSON.stringify(body)`, dan hasilnya berbeda dari aslinya begitu urutan
  // kunci atau spasi berbeda — tanda tangan yang sah pun ditolak.
  //
  // Test integrasi memakai `createNestApplication({ rawBody: true })` sendiri,
  // jadi ia TIDAK akan menangkap kalau baris ini hilang dari sini.
  // Logger JSON terstruktur (R-04, §17.1) dipasang SEBELUM modul dirakit,
  // supaya galat saat boot pun ikut terstruktur — dan galat saat boot justru
  // yang paling sering dibaca dari log agregat, bukan dari terminal.
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
    logger: new StructuredLogger(),
  });

  // Prefiks /api/v1 — docs/PRD.md §10. `/health` dikecualikan agar probe
  // orkestrator tidak ikut terpengaruh saat versi API naik.
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });

  // Header keamanan §16.1 — DIPASANG SEBELUM rute apa pun, supaya respons
  // galat dan 404 ikut membawanya.
  app.use(headerKeamanan());

  // CORS SEKALI DI SINI, terbatas ketat (A-03): web dan API berjalan di port
  // berbeda, dan cookie sesi httpOnly hanya terkirim lintas origin kalau
  // respons eksplisit mengizinkan origin + credentials. Origin dipin ke
  // APP_URL — BUKAN true/false, memakai `origin: true` berarti CORS longgar
  // dan itu masuk daftar jebakan keamanan repo ini.
  //
  // `appOrigins()`, bukan `process.env['APP_URL'] ?? …` — `??` meloloskan
  // string KOSONG, dan paket `cors` membaca origin falsy sebagai `*`
  // (temuan audit R-03).
  app.enableCors({ origin: appOrigins(), credentials: true });

  // Adapter Redis pub/sub untuk WebSocket (RT-2) — DITUNGGU sebelum listen.
  // Tanpa adapter, event hanya sampai ke klien di instance yang sama; dengan
  // dua instance, separuh anggota squad tidak pernah menerima pembaruan, dan
  // tidak ada galat apa pun karena tiap instance mengira pengirimannya sukses.
  const wsAdapter = new RedisIoAdapter(app);
  await wsAdapter.connect();
  app.useWebSocketAdapter(wsAdapter);

  await app.listen(port);
  new Logger('bootstrap').log(`API mendengarkan di :${port} (MODE=api)`);
}

async function bootstrapWorker(): Promise<void> {
  // Konteks aplikasi tanpa HTTP listener.
  await NestFactory.createApplicationContext(WorkerModule, { logger: new StructuredLogger() });
  new Logger('bootstrap').log('Worker pool hidup (MODE=worker)');
}

async function bootstrap(): Promise<void> {
  const mode = resolveMode();
  if (mode === 'worker') {
    await bootstrapWorker();
    return;
  }
  await bootstrapApi();
}

void bootstrap();
