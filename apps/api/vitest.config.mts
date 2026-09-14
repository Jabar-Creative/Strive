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
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
  },
});
