#!/usr/bin/env node
// Menjalankan Next.js dengan port dari WEB_PORT. Argumen pertama memilih
// perintahnya: `dev` (default) atau `start`.
//
// Kenapa tidak langsung di package.json: pnpm menjalankan script lewat
// cmd.exe di Windows, dan cmd.exe tidak mengembangkan `${WEB_PORT:-3000}`.
// Teks itu diteruskan apa adanya lalu Next menolaknya:
//   option '-p, --port <port>' argument '${WEB_PORT:-3000}' is invalid
// Default port karena itu diselesaikan di Node, yang perilakunya sama di
// semua sistem operasi dan tidak butuh dependensi baru.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveBin } from './resolve-bin.mjs';

const COMMANDS = ['dev', 'start'];
const command = process.argv[2] ?? 'dev';
if (!COMMANDS.includes(command)) {
  console.error(
    `[web] perintah tidak dikenal: ${command}. Pakai salah satu dari: ${COMMANDS.join(', ')}`,
  );
  process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkgDir = path.join(root, 'apps', 'web');
const port = process.env.WEB_PORT || '3000';
if (!/^[0-9]+$/.test(port)) {
  console.error(`[web] WEB_PORT harus berupa angka, dapat: ${port}`);
  process.exit(1);
}

const child = spawn(
  process.execPath,
  [resolveBin(pkgDir, 'next', 'next'), command, '--port', port],
  {
    cwd: pkgDir,
    stdio: 'inherit',
  },
);
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
