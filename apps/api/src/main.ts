import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
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
  const app = await NestFactory.create(AppModule);

  // Prefiks /api/v1 — docs/PRD.md §10. `/health` dikecualikan agar probe
  // orkestrator tidak ikut terpengaruh saat versi API naik.
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });

  // CORS SEKALI DI SINI, terbatas ketat (A-03): web dan API berjalan di port
  // berbeda, dan cookie sesi httpOnly hanya terkirim lintas origin kalau
  // respons eksplisit mengizinkan origin + credentials. Origin dipin ke
  // APP_URL — BUKAN true/false, memakai `origin: true` berarti CORS longgar
  // dan itu masuk daftar jebakan keamanan repo ini.
  app.enableCors({
    origin: process.env['APP_URL'] ?? 'http://localhost:3000',
    credentials: true,
  });

  await app.listen(port);
  new Logger('bootstrap').log(`API mendengarkan di :${port} (MODE=api)`);
}

async function bootstrapWorker(): Promise<void> {
  // Konteks aplikasi tanpa HTTP listener.
  await NestFactory.createApplicationContext(WorkerModule);
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
