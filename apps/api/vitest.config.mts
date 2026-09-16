import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * Transform SWC, BUKAN esbuild bawaan Vitest.
 *
 * Alasannya bukan kecepatan: esbuild TIDAK mengemisi `design:paramtypes`
 * (`emitDecoratorMetadata`). Tanpa metadata itu, Nest tidak melihat parameter
 * konstruktor sama sekali — sehingga modul yang kabelnya SALAH tetap lulus test
 * dan baru meledak saat aplikasi benar-benar dijalankan.
 *
 * Sudah terjadi sekali di sesi fondasi ini. Jangan diganti kembali ke esbuild.
 */
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    // Test integrasi butuh PostgreSQL yang sudah dimigrasi, jadi TIDAK ikut
    // `pnpm test`. Ia dijalankan `pnpm test:integration`, dan di CI oleh job
    // `migrasi kering` yang memang punya database.
    //
    // Dipisah setelah CI merah: job `node` tidak punya Postgres, dan test
    // jalur uang yang dilewati diam-diam sama tidak bergunanya dengan tidak
    // ada. CLAUDE.md menuntut setiap jalur uang punya test integrasi dengan
    // database NYATA — jadi yang diperbaiki tempat menjalankannya, bukan
    // assertion-nya.
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.integration.spec.ts'],
  },
});
