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

// Versi Python — keputusan F-01 (lihat PR #3, jawaban keputusan 1).
//
// LANTAI ditegakkan keras: di bawah ini, venv tidak dibuat sama sekali.
// Sumbernya `requires-python` di services/ai/pyproject.toml, dibaca dari file
// itu supaya tidak ada dua angka yang bisa berbeda.
//
// VERSI RUJUKAN adalah yang dipakai CI. Selisih di atas lantai TIDAK menolak —
// docs/PRD.md §8.4 menulis kolomnya "Versi minimum", dan pyproject.toml menulis
// ">=3.12", jadi menolak 3.13 akan bertentangan dengan spek repo ini sendiri.
// Yang dilakukan: memperingatkan tiap run, supaya penyimpangan versi antar
// developer terlihat sejak hari pertama dan bukan jadi bug misterius di minggu
// ke-6. Kalau nanti diputuskan harus persis, ubah WARN jadi exit di sini.
const CI_PYTHON = '3.12';

const isWindows = process.platform === 'win32';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serviceDir = path.join(root, 'services', 'ai');
const venvDir = path.join(serviceDir, '.venv');
const venvBin = path.join(venvDir, isWindows ? 'Scripts' : 'bin');
const venvPython = path.join(venvBin, isWindows ? 'python.exe' : 'python');
const stampFile = path.join(venvDir, '.installed');
const requirements = path.join(serviceDir, 'requirements.txt');

/** Lantai versi dibaca dari pyproject.toml — satu angka, satu tempat. */
function readMinimumPython() {
  const toml = fs.readFileSync(path.join(serviceDir, 'pyproject.toml'), 'utf8');
  const m = toml.match(/^\s*requires-python\s*=\s*"[><=~^]*\s*(\d+)\.(\d+)/m);
  if (!m) {
    throw new Error('[ai] requires-python tidak terbaca di services/ai/pyproject.toml');
  }
  return [Number(m[1]), Number(m[2])];
}

/** `3.12.4` -> [3, 12]. Mengembalikan null kalau bukan keluaran Python. */
function parseVersion(output) {
  const m = /Python (\d+)\.(\d+)/.exec(output);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

// Interpreter dianggap sah hanya kalau benar-benar menjawab --version DAN
// versinya memenuhi lantai. Pengecekan --version itu juga yang menyaring stub
// Microsoft Store, yang ada di PATH tapi tidak jalan.
//
// Kandidat diurutkan: versi rujukan CI dicoba lebih dulu, supaya mesin yang
// punya beberapa Python otomatis memilih yang sama dengan CI.
function findSystemPython(minimum) {
  const candidates = isWindows
    ? [
        ['py', [`-${CI_PYTHON}`]],
        ['py', ['-3']],
        ['python', []],
        ['python3', []],
      ]
    : [
        [`python${CI_PYTHON}`, []],
        ['python3', []],
        ['python', []],
      ];

  const tooOld = [];
  for (const [cmd, prefix] of candidates) {
    const probe = spawnSync(cmd, [...prefix, '--version'], { encoding: 'utf8' });
    if (probe.status !== 0) continue;
    const version = parseVersion(`${probe.stdout}${probe.stderr}`.trim());
    if (!version) continue;

    const [major, minor] = version;
    if (major < minimum[0] || (major === minimum[0] && minor < minimum[1])) {
      tooOld.push(`${cmd} ${prefix.join(' ')}`.trim() + ` -> ${major}.${minor}`);
      continue;
    }
    return { cmd, prefix, version };
  }
  return { cmd: null, prefix: null, version: null, tooOld };
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
  const minimum = readMinimumPython();
  const python = findSystemPython(minimum);
  if (!python.cmd) {
    const floor = minimum.join('.');
    console.error(
      `[ai] Python ${floor} atau lebih baru tidak ditemukan.\n` +
        (python.tooOld?.length
          ? `     Yang ada tapi TERLALU LAMA: ${python.tooOld.join(', ')}\n`
          : '') +
        `     Pasang Python ${CI_PYTHON} lalu pastikan \`python --version\` menjawab dari terminal ini.\n` +
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

// Versi diperiksa pada venv-nya sendiri, SETIAP run — bukan cuma saat dibuat.
// Venv di-cache, jadi kalau pemeriksaan hanya terjadi saat pembuatan, developer
// yang sudah terlanjur punya venv versi salah tidak akan pernah diperingatkan.
const venvVersion = parseVersion(
  `${spawnSync(venvPython, ['--version'], { encoding: 'utf8' }).stdout}` +
    `${spawnSync(venvPython, ['--version'], { encoding: 'utf8' }).stderr}`,
);
if (venvVersion) {
  const floor = readMinimumPython();
  const [major, minor] = venvVersion;
  if (major < floor[0] || (major === floor[0] && minor < floor[1])) {
    console.error(
      `[ai] .venv memakai Python ${venvVersion.join('.')}, di bawah lantai ` +
        `requires-python (>=${floor.join('.')}).\n` +
        '     Hapus services/ai/.venv lalu jalankan ulang dengan interpreter yang benar.',
    );
    process.exit(1);
  }
  if (venvVersion.join('.') !== CI_PYTHON) {
    console.warn(
      `[ai] PERINGATAN: .venv memakai Python ${venvVersion.join('.')}, CI memakai ${CI_PYTHON}.\n` +
        `     Memenuhi lantai (>=${floor.join('.')}) jadi tidak diblokir — tapi selisih versi\n` +
        '     antar developer adalah sumber bug yang baru muncul belakangan.\n' +
        `     Kalau bisa, pasang Python ${CI_PYTHON} lalu hapus services/ai/.venv.`,
    );
  }
}

const port = process.env.AI_SERVICE_PORT || '8000';
if (!/^[0-9]+$/.test(port)) {
  console.error(`[ai] AI_SERVICE_PORT harus berupa angka, dapat: ${port}`);
  process.exit(1);
}
const child = spawn(venvPython, ['-m', 'uvicorn', 'app.main:app', '--reload', '--port', port], {
  cwd: serviceDir,
  stdio: 'inherit',
});
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
