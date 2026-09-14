#!/usr/bin/env node
// Menghasilkan tipe Kysely dari skema yang BENAR-BENAR ada di database,
// bukan dari model yang ditulis tangan.
//
// Arahnya disengaja: SQL adalah sumber kebenaran, tipe TypeScript turunannya.
// Kalau tipe ditulis tangan, dua-duanya akan berbeda dan yang ketahuan belakangan
// adalah yang di produksi.
//
// Skema `strive_meta` (ledger migrasi) sengaja tidak ikut — itu perkakas,
// bukan domain.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveBin } from './resolve-bin.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'apps', 'api', 'src', 'infra', 'kysely', 'database.d.ts');

if (!process.env.DATABASE_URL) {
  console.error(
    '[db:types] DATABASE_URL belum diset.\n' +
      '          Jalankan `docker compose up -d` lalu `pnpm db:migrate` dulu.',
  );
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  [
    resolveBin(root, 'kysely-codegen', 'kysely-codegen'),
    '--dialect',
    'postgres',
    // URL diteruskan eksplisit. Tanpa ini kysely-codegen mencari file .env dan
    // gagal di mesin yang memakai variabel dari shell (termasuk CI).
    '--url',
    process.env.DATABASE_URL,
    '--schema',
    'public',
    // Ledger migrasi adalah perkakas, bukan domain — jangan sampai muncul di
    // tipe yang dipakai kode aplikasi.
    '--exclude-pattern',
    'strive_meta.*',
    '--out-file',
    out,
  ],
  { stdio: 'inherit', cwd: root },
);

if (result.status !== 0) process.exit(result.status ?? 1);

// Diformat prettier di sini, bukan dibiarkan apa adanya.
//
// Berkas ini ikut di-commit, jadi hook lint-staged akan memformatnya saat
// commit — sementara kysely-codegen mengeluarkan gaya kutip yang berbeda.
// Tanpa langkah ini, pemeriksaan drift di CI (`git diff --exit-code`) selalu
// merah karena beda tanda kutip, bukan karena skemanya benar-benar berubah.
const format = spawnSync(
  process.execPath,
  [resolveBin(root, 'prettier', 'prettier'), '--write', out],
  {
    stdio: 'inherit',
    cwd: root,
  },
);
if (format.status !== 0) process.exit(format.status ?? 1);

console.log(`[db:types] tipe ditulis ke ${path.relative(root, out)}`);
