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
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

import { resolveBin } from './resolve-bin.mjs';

import { muatEnv } from './env-berkas.mjs';

// `.env` dimuat lebih dulu supaya petunjuk di galat di bawah benar-benar
// menolong. Shell menang atas berkas — lihat scripts/env-berkas.mjs.
muatEnv();

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'apps', 'api', 'src', 'infra', 'kysely', 'database.d.ts');

if (!process.env.DATABASE_URL) {
  console.error(
    '[db:types] DATABASE_URL belum diset.\n' +
      '          Jalankan `docker compose up -d` lalu `pnpm db:migrate` dulu.',
  );
  process.exit(1);
}

// ── Koneksi diperiksa SENDIRI, sebelum codegen dijalankan ─────────────────
//
// `kysely-codegen` **keluar 0** saat database tidak bisa dihubungi. Yang
// dicetaknya hanya tanda `✗` dengan pesan KOSONG, lalu
// `database.d.ts … (unchanged)` — dan penjaga `result.status !== 0` di bawah
// tidak pernah menyala. Akibatnya skrip ini mencetak "tipe ditulis" sambil
// meninggalkan berkas yang basi.
//
// Itu bukan ketidaknyamanan: `database.d.ts` ikut di-commit dan CI
// membandingkannya dengan hasil regenerasi (`git diff --exit-code`). Jadi
// orang yang menjalankan `pnpm db:migrate && pnpm db:types` dengan Postgres
// mati mendapat DUA pesan sukses dan tipe yang tidak pernah diperbarui — dan
// yang memberitahunya CI, beberapa menit kemudian, dengan galat yang menunjuk
// ke drift alih-alih ke database yang mati.
//
// Ditemukan 14 Okt saat mengerjakan isu #98: `ALTER TYPE … ADD VALUE` tidak
// pernah teraplikasi (daemon Docker mati), `db:types` melapor sukses, dan
// `spend_freeze` tidak ada di berkasnya.
async function pastikanBisaDihubungi() {
  const klien = new pg.Client({ connectionString: process.env.DATABASE_URL });
  try {
    await klien.connect();
    await klien.query('select 1');
  } catch (e) {
    // `message` bisa KOSONG untuk galat soket `pg` (ECONNREFUSED pada
    // AggregateError membawa detailnya di `code` dan `errors[]`, bukan di
    // `message`). Pesan yang menjanjikan alasan lalu memberi string kosong
    // adalah cacat yang sama dengan yang sedang diperbaiki berkas ini.
    const sebab =
      (e instanceof Error && e.message) ||
      (e && typeof e === 'object' && 'code' in e && String(e.code)) ||
      String(e);
    console.error(
      `[db:types] TIDAK bisa menghubungi database: ${sebab}\n` +
        '          Jalankan `docker compose up -d` lalu `pnpm db:migrate`.\n' +
        '          (kysely-codegen keluar 0 saat koneksi gagal dan membiarkan\n' +
        '           database.d.ts basi — karena itu koneksinya diperiksa di sini.)',
    );
    process.exit(1);
  } finally {
    await klien.end().catch(() => {});
  }
}

await pastikanBisaDihubungi();

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
    // Kolom DATE dipetakan ke STRING, bukan objek Date.
    //
    // `attempt_date`, `quest_date`, `last_activity_date`, dan
    // `freeze_used_date` adalah TANGGAL KALENDER — tidak punya zona waktu.
    // Objek Date punya, dan itu mengundang konversi zona pada nilai yang tidak
    // boleh dikonversi: persis kelas bug yang CLAUDE.md aturan 5 ada untuk
    // mencegahnya. Runtime-nya diselaraskan di infra/kysely/database.ts.
    '--date-parser',
    'string',
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

// Lapis kedua, murah: hasil introspeksi yang sah SELALU memuat antarmuka akar.
// Kalau codegen gagal dengan cara lain yang juga keluar 0, ini yang menangkapnya
// alih-alih membiarkan pesan sukses di bawah tercetak.
if (!fs.existsSync(out) || !fs.readFileSync(out, 'utf8').includes('export interface DB')) {
  console.error(
    `[db:types] codegen keluar 0 tapi ${path.relative(root, out)} tidak memuat ` +
      '`export interface DB` — hasilnya tidak sah, dan TIDAK ditulis sebagai sukses.',
  );
  process.exit(1);
}

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
