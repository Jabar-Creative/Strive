#!/usr/bin/env node
// Menjalankan AI service (FastAPI) dari root repo.
//
// Pengganti scripts/dev-ai.sh. Versi shell tidak bisa dipakai di Windows
// karena tiga hal sekaligus:
//   1. `bash` di PATH Windows menunjuk stub WSL, dan mesin tanpa distro
//      WSL langsung gagal di situ.
//   2. `python3` menunjuk App Execution Alias milik Microsoft Store, yang
//      bukan interpreter: keluar dengan kode 9009 dan membuka halaman Store.
//   3. venv Windows menaruh interpreter di .venv/Scripts, bukan .venv/bin.
//
// Logika venv-nya sengaja dipertahankan sama persis: penanda .venv/.installed
// berisi hash requirements.txt dan HANYA ditulis setelah pip selesai, supaya
// venv setengah jadi tidak ikut dipakai dan requirements yang berubah memicu
// install ulang.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const isWindows = process.platform === 'win32';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serviceDir = path.join(root, 'services', 'ai');
const venvDir = path.join(serviceDir, '.venv');
const venvBin = path.join(venvDir, isWindows ? 'Scripts' : 'bin');
const venvPython = path.join(venvBin, isWindows ? 'python.exe' : 'python');
const stampFile = path.join(venvDir, '.installed');
const requirements = path.join(serviceDir, 'requirements.txt');

// Interpreter dianggap sah hanya kalau benar-benar menjawab --version.
// Itu yang menyaring stub Microsoft Store, yang ada di PATH tapi tidak jalan.
function findSystemPython() {
  const candidates = isWindows
    ? [
        ['py', ['-3']],
        ['python', []],
        ['python3', []],
      ]
    : [
        ['python3', []],
        ['python', []],
      ];

  for (const [cmd, prefix] of candidates) {
    const probe = spawnSync(cmd, [...prefix, '--version'], { encoding: 'utf8' });
    if (probe.status === 0 && /^Python 3\./.test(`${probe.stdout}${probe.stderr}`.trim())) {
      return { cmd, prefix };
    }
  }
  return null;
}

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { stdio: 'inherit', cwd: serviceDir, ...opts });
  if (result.status !== 0) {
    console.error(`[ai] gagal menjalankan: ${cmd} ${args.join(' ')}`);
    process.exit(result.status ?? 1);
  }
}

const want = createHash('sha256').update(fs.readFileSync(requirements)).digest('hex');
const have = fs.existsSync(stampFile) ? fs.readFileSync(stampFile, 'utf8').trim() : '';

if (!fs.existsSync(venvPython) || want !== have) {
  console.log('[ai] menyiapkan .venv (requirements berubah atau venv belum lengkap)...');
  const python = findSystemPython();
  if (!python) {
    console.error(
      '[ai] Python 3 tidak ditemukan.\n' +
        '     Pasang Python 3.12 lalu pastikan `python --version` menjawab dari terminal ini.\n' +
        '     Di Windows, matikan App Execution Alias "python"/"python3" lewat\n' +
        '     Settings > Apps > Advanced app settings > App execution aliases.',
    );
    process.exit(1);
  }
  fs.rmSync(venvDir, { recursive: true, force: true });
  run(python.cmd, [...python.prefix, '-m', 'venv', '.venv']);
  run(venvPython, ['-m', 'pip', 'install', '--quiet', '--upgrade', 'pip']);
  run(venvPython, ['-m', 'pip', 'install', '--quiet', '-r', 'requirements.txt']);
  fs.writeFileSync(stampFile, want);
  console.log('[ai] .venv siap.');
}

const port = process.env.AI_SERVICE_PORT || '8000';
const child = spawn(venvPython, ['-m', 'uvicorn', 'app.main:app', '--reload', '--port', port], {
  cwd: serviceDir,
  stdio: 'inherit',
});
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
