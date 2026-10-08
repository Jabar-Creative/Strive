import {
  WALLET_LEDGER_LIMIT_DEFAULT as DEFAULT_KONTRAK,
  WALLET_LEDGER_LIMIT_MAX as MAX_KONTRAK,
} from '@strive/contracts';

import { LEDGER_LIMIT_DEFAULT, LEDGER_LIMIT_MAX } from './wallet.service';

/**
 * Penjaga paritas batas ledger dompet — isu #182.
 *
 * Angka batas hidup di DUA tempat karena batas yang sah:
 * - `packages/contracts` (dipakai web sebagai NILAI, dan dipakai skema
 *   `walletResponseSchema.max()`), dan
 * - `wallet.service.ts` di sini — karena kode PRODUKSI `apps/api` hanya
 *   boleh `import type` dari `@strive/contracts` (`nest build` mengirim
 *   `.ts` mentah; `ERR_UNSUPPORTED_DIR_IMPORT` di CLAUDE.md).
 *
 * Dua angka yang bisa menyimpang diam-diam adalah kelas yang sama dengan
 * "32 tabel ditulis tangan di TIGA tempat". Test inilah yang memerah saat
 * keduanya menyimpang — penjaga bagi siapa pun yang mengubah satu sisi saja.
 *
 * (Impor NILAI di berkas SPEC sah: vitest mentranspilasi sendiri, berkas
 * test tidak pernah masuk `dist/` — preseden `health.service.spec.ts`.)
 */
describe('paritas batas ledger: wallet.service ↔ contracts', () => {
  it('LEDGER_LIMIT_MAX sama dengan WALLET_LEDGER_LIMIT_MAX', () => {
    expect(LEDGER_LIMIT_MAX).toBe(MAX_KONTRAK);
  });

  it('LEDGER_LIMIT_DEFAULT sama dengan WALLET_LEDGER_LIMIT_DEFAULT', () => {
    expect(LEDGER_LIMIT_DEFAULT).toBe(DEFAULT_KONTRAK);
  });
});
