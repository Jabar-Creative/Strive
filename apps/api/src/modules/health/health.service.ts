import { Injectable } from '@nestjs/common';
import type { HealthResponse } from '@strive/contracts';

/**
 * Service satu-satunya yang lengkap di sesi fondasi ini.
 *
 * Ada bukan karena /health penting, tapi karena developer berikutnya perlu
 * melihat BENTUK yang diharapkan: service memegang logika, controller hanya
 * memetakan HTTP, tipe datang dari `@strive/contracts`, dan ada test-nya.
 */
@Injectable()
export class HealthService {
  check(): HealthResponse {
    return {
      status: 'ok',
      service: 'api',
      mode: process.env['MODE'] === 'worker' ? 'worker' : 'api',
      timestamp: new Date().toISOString(),
    };
  }
}
