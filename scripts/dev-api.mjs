#!/usr/bin/env node
// Menjalankan NestJS dev server. Argumen pertama menentukan peran proses:
//   node scripts/dev-api.mjs api      -> MODE=api
//   node scripts/dev-api.mjs worker   -> MODE=worker
//
// Kenapa tidak `MODE=api nest start --watch` di package.json: awalan variabel
// environment gaya POSIX tidak dikenal cmd.exe, yang dipakai pnpm di Windows.
// Yang terjadi di sana: `Invalid parameter - =api`. Menyetel lewat env proses
// anak membuat perilakunya sama di semua sistem operasi, tanpa dependensi baru.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveBin } from './resolve-bin.mjs';

const MODES = ['api', 'worker'];
const mode = process.argv[2];
if (!MODES.includes(mode)) {
  console.error(
    `[api] MODE tidak dikenal: ${mode ?? '(kosong)'}. Pakai salah satu dari: ${MODES.join(', ')}`,
  );
  process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkgDir = path.join(root, 'apps', 'api');

const child = spawn(
  process.execPath,
  [resolveBin(pkgDir, '@nestjs/cli', 'nest'), 'start', '--watch'],
  {
    cwd: pkgDir,
    stdio: 'inherit',
    env: { ...process.env, MODE: mode },
  },
);
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
