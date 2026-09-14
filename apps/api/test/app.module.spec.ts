import { describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { HealthService } from '../src/modules/health';

describe('AppModule', () => {
  it('seluruh modul yang terdaftar bisa di-instantiate', async () => {
    // Test ini murah tapi menangkap satu kelas kesalahan yang mahal:
    // modul baru yang lupa didaftarkan, atau dependensi melingkar antar-modul.
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    expect(moduleRef.get(HealthService)).toBeInstanceOf(HealthService);
    await moduleRef.close();
  });
});
