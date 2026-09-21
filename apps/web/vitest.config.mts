import path from 'node:path';

import { defineConfig } from 'vitest/config';

/**
 * Vitest untuk web. Dibutuhkan A-04: middleware dan guard console diimpor
 * lewat alias `@/` supaya spec dan kode produksi memakai jalur yang sama
 * dengan build Next (tsconfig `paths`). Tanpa ini, spec hanya bisa impor
 * relatif dan berhenti bekerja begitu file pindah folder.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname),
    },
  },
});
