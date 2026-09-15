#!/usr/bin/env node
// Runner migrasi — forward-only, berurut, satu transaksi per file.
//
// Aturan yang dijaga di sini (docs/PRD.md §19.4, CLAUDE.md §Migrasi):
//   - SQL murni, dijalankan apa adanya. Tidak ada DSL, tidak ada `down`.
//   - Urutan dari nama file, bukan dari timestamp jam berapa seseorang menulis.
//   - Satu file = satu transaksi. Gagal di tengah = tidak ada yang tertulis.
//   - File yang sudah diterapkan dilewati, dan checksum-nya diperiksa: mengubah
//     migrasi yang sudah jalan adalah cara paling senyap membuat staging dan
//     produksi berbeda skema.
//
// Ledger-nya tinggal di skema `strive_meta`, bukan `public`, supaya jumlah
// tabel domain di `public` tetap persis seperti docs/PRD.md §9.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'db', 'migrations');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error(
    '[db:migrate] DATABASE_URL belum diset.\n' +
      '            Salin .env.example ke .env, atau set variabelnya di shell ini.',
  );
  process.exit(1);
}

const files = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .sort();

if (files.length === 0) {
  console.log('[db:migrate] belum ada file migrasi di db/migrations/');
  process.exit(0);
}

const client = new pg.Client({ connectionString: url });
await client.connect();

// Ledger harus ada sebelum bisa mencatat apa pun. Dibuat di luar transaksi
// migrasi supaya migrasi pertama tetap bisa dicatat.
await client.query('CREATE SCHEMA IF NOT EXISTS strive_meta');
await client.query(`
  CREATE TABLE IF NOT EXISTS strive_meta.schema_migrations (
    filename   text PRIMARY KEY,
    checksum   text        NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )
`);

const { rows } = await client.query('SELECT filename, checksum FROM strive_meta.schema_migrations');
const applied = new Map(rows.map((r) => [r.filename, r.checksum]));

let ran = 0;
for (const filename of files) {
  const sql = fs.readFileSync(path.join(dir, filename), 'utf8');
  const checksum = createHash('sha256').update(sql).digest('hex');

  const previous = applied.get(filename);
  if (previous) {
    if (previous !== checksum) {
      console.error(
        `[db:migrate] ${filename} SUDAH diterapkan tapi isinya berubah.\n` +
          '             Migrasi bersifat forward-only: tulis file baru, jangan ubah yang lama.',
      );
      await client.end();
      process.exit(1);
    }
    continue;
  }

  process.stdout.write(`[db:migrate] menerapkan ${filename} ... `);
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query(
      'INSERT INTO strive_meta.schema_migrations (filename, checksum) VALUES ($1, $2)',
      [filename, checksum],
    );
    await client.query('COMMIT');
    ran += 1;
    console.log('ok');
  } catch (error) {
    await client.query('ROLLBACK');
    console.log('GAGAL');
    console.error(`[db:migrate] ${filename}: ${error.message}`);
    await client.end();
    process.exit(1);
  }
}

await client.end();
console.log(
  ran === 0
    ? `[db:migrate] skema sudah mutakhir (${files.length} migrasi).`
    : `[db:migrate] ${ran} migrasi diterapkan, ${files.length} total.`,
);
