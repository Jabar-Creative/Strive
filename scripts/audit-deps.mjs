#!/usr/bin/env node
// Gerbang audit dependensi — R-03, PRD §16.1:
//
//   "Dependency audit (pnpm audit, pip-audit) nol kerentanan tinggi"
//
// Kenapa ini tidak sekadar `pnpm audit --audit-level high` di CI: saat R-03
// dikerjakan, perintah itu melaporkan 15 tinggi + 1 kritis, dan HAMPIR SEMUANYA
// ada di perkakas build/test — vitest, vite, postcss, glob. Menjadikannya
// blocking apa adanya berarti CI merah sejak menit pertama dan seseorang akan
// mematikannya dalam seminggu; membiarkannya non-blocking berarti tidak ada
// yang membacanya. Keduanya berakhir sama: nol perlindungan.
//
// Jadi setiap advisory yang dikecualikan WAJIB tertulis di
// `security/pengecualian.json` dengan alasan dan tanggal tinjau ulang. Daftar
// yang kedaluwarsa memerahkan CI sama seperti advisory baru — supaya
// pengecualian punya biaya, bukan jadi tempat sampah.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const AKAR = join(dirname(fileURLToPath(import.meta.url)), '..');
const BERAT = new Set(['high', 'critical']);

function auditJson() {
  try {
    // `pnpm audit` keluar non-nol saat menemukan sesuatu — itu bukan kegagalan
    // perintahnya, jadi stdout tetap dibaca.
    return execFileSync('pnpm', ['audit', '--json'], { cwd: AKAR, encoding: 'utf8' });
  } catch (e) {
    if (typeof e.stdout === 'string' && e.stdout.length > 0) return e.stdout;
    throw e;
  }
}

const data = JSON.parse(auditJson());
const pengecualian = JSON.parse(readFileSync(join(AKAR, 'security', 'pengecualian.json'), 'utf8'));
const hariIni = new Date().toISOString().slice(0, 10);

const sah = new Map();
const basi = [];
for (const p of pengecualian.dikecualikan) {
  if (p.tinjau_ulang < hariIni) basi.push(p);
  else sah.set(p.id, p);
}

const temuan = Object.values(data.advisories ?? {}).filter((a) => BERAT.has(a.severity));
const baru = temuan.filter((a) => !sah.has(a.github_advisory_id ?? String(a.id)));

for (const a of temuan) {
  const id = a.github_advisory_id ?? String(a.id);
  const tanda = sah.has(id) ? 'dikecualikan' : 'BARU';
  console.log(`[${a.severity}] ${a.module_name} ${id} — ${tanda}`);
}

if (basi.length > 0) {
  console.error(`\n${basi.length} pengecualian sudah lewat tanggal tinjau ulang:`);
  for (const p of basi) console.error(`  ${p.id} (${p.paket}) — tinjau_ulang ${p.tinjau_ulang}`);
}
if (baru.length > 0) {
  console.error(`\n${baru.length} kerentanan tinggi/kritis BARU tanpa pengecualian tertulis:`);
  for (const a of baru) {
    const id = a.github_advisory_id ?? String(a.id);
    console.error(`  ${a.module_name} ${id} — ${a.title}`);
    console.error(`    tambal ke: ${a.patched_versions}`);
  }
  console.error(
    '\nPerbaiki, atau tambahkan ke security/pengecualian.json DENGAN alasan dan tanggal tinjau ulang.',
  );
}

const gagal = basi.length > 0 || baru.length > 0;
console.log(
  `\n${temuan.length} tinggi/kritis · ${temuan.length - baru.length} dikecualikan · ${baru.length} baru · ${basi.length} pengecualian basi`,
);
process.exit(gagal ? 1 : 0);
