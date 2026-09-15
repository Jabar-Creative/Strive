import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * Konfigurasi khusus test integrasi jalur uang.
 *
 * Dipisah dari vitest.config.mts karena keduanya punya prasyarat berbeda:
 * test unit jalan di mana saja, test ini WAJIB punya PostgreSQL yang sudah
 * dimigrasi. Menggabungkannya berarti salah satu dari dua hal buruk —
 * test unit ikut gagal di mesin tanpa database, atau test jalur uang
 * dilewati diam-diam di CI. Keduanya sudah terjadi sekali.
 *
 * Dijalankan lewat `pnpm test:integration`, dan di CI oleh job
 * `migrasi kering` yang memang menyediakan PostgreSQL.
 */
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.integration.spec.ts'],
    // Test ini berbagi satu database; menjalankannya paralel membuat
    // beforeEach saling menghapus data test lain.
    fileParallelism: false,
  },
});
