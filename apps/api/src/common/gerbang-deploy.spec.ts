import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Penjaga daftar ABAIKAN gerbang deploy staging — isu #160.
 *
 * Gerbang di `.github/workflows/deploy-staging.yml` melewati deploy kalau
 * seluruh berkas yang berubah sejak penanda `staging-live` cocok dengan satu
 * regex. Regex itu hidup di dalam YAML, di dalam shell — tempat yang tidak
 * diperiksa `tsc`, tidak diperiksa ESLint, dan tidak punya test sendiri.
 *
 * Yang membuatnya pantas dijaga: **melonggarkan daftar itu tidak akan pernah
 * membuat apa pun merah.** Menambahkan `infra/` ke daftar abaikan terlihat
 * seperti penghematan dan berarti perubahan Dockerfile tidak pernah naik ke
 * staging — bentuk kegagalan yang sama dengan antrean berkapasitas satu di
 * #165: tidak ada yang merah, dan pertanyaan "apakah perbaikan X sudah
 * hidup?" tidak bisa dijawab dari riwayat.
 *
 * Disengaja `*.spec.ts` biasa: ia hanya membaca berkas, jadi ia jalan di job
 * CI yang TIDAK punya database — pola `storage-bucket-env.spec.ts`.
 */

const AKAR = join(__dirname, '..', '..', '..', '..');
const YAML = readFileSync(join(AKAR, '.github', 'workflows', 'deploy-staging.yml'), 'utf8');

/** Regex yang BENAR-BENAR dipakai workflow, dibaca dari berkasnya. */
function abaikanDariWorkflow(): RegExp {
  const m = YAML.match(/ABAIKAN='(.+)'/);
  if (!m?.[1]) throw new Error('ABAIKAN tidak ditemukan di deploy-staging.yml');
  // Shell menulisnya di dalam YAML, jadi `\\.` di YAML = `\.` di shell.
  return new RegExp(m[1].replace(/\\\\/g, '\\'));
}

/** Path yang WAJIB memaksa deploy — melonggarkannya adalah regresi. */
const WAJIB_DEPLOY = [
  'apps/api/src/main.ts',
  'apps/web/app/(student)/hub/page.tsx',
  'packages/contracts/src/auth/user.ts',
  'packages/ui/src/tokens/index.ts',
  'services/ai/app/main.py',
  'services/ai/requirements.txt',
  'db/migrations/011_sesuatu.sql',
  'scripts/db-migrate.mjs',
  'infra/Dockerfile.api',
  'infra/railway/api.json',
  '.github/workflows/deploy-staging.yml',
  '.github/workflows/ci.yml',
  'package.json',
  'pnpm-lock.yaml',
  '.env.example',
];

/** Path yang memang tidak memengaruhi apa pun yang berjalan di staging. */
const BOLEH_DILEWATI = [
  'docs/PRD.md',
  'docs/BACKLOG.md',
  'docs/reports/F-05/README.md',
  'CLAUDE.md',
  'AGENTS.md',
  'README.md',
  '.gitattributes',
  'LICENSE',
];

describe('gerbang deploy staging — daftar ABAIKAN (isu #160)', () => {
  const abaikan = abaikanDariWorkflow();

  it.each(WAJIB_DEPLOY)('%s MEMAKSA deploy', (jalur) => {
    expect(abaikan.test(jalur), `${jalur} tidak boleh diabaikan gerbang`).toBe(false);
  });

  it.each(BOLEH_DILEWATI)('%s boleh dilewati', (jalur) => {
    expect(abaikan.test(jalur), `${jalur} seharusnya diabaikan gerbang`).toBe(true);
  });

  it('penanda `staging-live` hanya DIMAJUKAN setelah smoke, bukan di tempat lain', () => {
    // Kalau tag ini maju di job yang lebih awal, deploy yang gagal akan
    // membuat commit berikutnya dianggap sudah naik — dan gerbang lalu
    // melewati perubahan kode yang belum pernah ter-deploy.
    const majuDi = [...YAML.matchAll(/git tag --force staging-live/g)];
    expect(majuDi).toHaveLength(1);
    const blokTandai = YAML.slice(YAML.indexOf('  tandai:'));
    expect(blokTandai).toContain('git tag --force staging-live');
    expect(blokTandai).toContain('needs: [putuskan, smoke]');
  });

  it('`paths-ignore` TIDAK dipakai di `on:` — ia tidak berlaku untuk workflow_run', () => {
    // Menulisnya di `on:` membuat berkas ini TERLIHAT menyaring tanpa
    // menyaring apa pun. Itu bentuk kegagalan terburuk untuk sebuah gerbang.
    //
    // Yang dicari KUNCI YAML-nya (`^\s*paths-ignore:`), bukan katanya —
    // komentar di workflow memang menyebut `paths-ignore` untuk menjelaskan
    // kenapa ia tidak dipakai, dan test yang melarang katanya akan menghukum
    // penjelasannya sendiri. (Versi pertama test ini melakukan itu.)
    expect(YAML).not.toMatch(/^\s*paths-ignore\s*:/m);
  });
});

/**
 * Pemicu otomatis `workflow_run` — mati atau hidup, keduanya sah; yang TIDAK
 * sah adalah mati tanpa kondisi pembatalnya tertulis.
 *
 * Dimatikan 28 Okt 2026 karena staging Railway tidak ada lagi (#151). Yang
 * dijaga di sini bukan keadaan matinya, melainkan **bahwa alasannya menyebut
 * apa yang membatalkannya.** CLAUDE.md mensyaratkan itu, dan repo ini sudah
 * punya bekas lukanya: catatan `ReconcileBalanceService` "sengaja TIDAK
 * dijadwalkan" bertahan TIGA MINGGU setelah sebabnya hilang, karena
 * kalimatnya tidak pernah menyebut kapan ia berhenti berlaku (#203).
 *
 * Jadi test ini dirancang untuk MATI SENDIRI: begitu pemicunya dihidupkan
 * kembali, cabangnya tidak berlaku dan ia berhenti menuntut apa pun.
 */
describe('pemicu deploy staging — mati boleh, mati tanpa alasan tidak', () => {
  const aktif = /^\s*workflow_run\s*:/m.test(YAML);

  it('workflow_dispatch SELALU ada — deploy manual tidak boleh ikut hilang', () => {
    // Tanpa ini, mematikan pemicu otomatis berarti pipeline deploy tidak
    // bisa diuji sama sekali, dan pipeline yang tidak bisa dijalankan sudah
    // pernah rusak diam-diam di repo ini (#165).
    expect(/^\s*workflow_dispatch\s*:/m.test(YAML)).toBe(true);
  });

  it.runIf(!aktif)('pemicu MATI wajib menyebut kondisi yang membatalkannya', () => {
    expect(YAML).toMatch(/KONDISI YANG MEMBATALKAN/);
    // Dan kondisinya harus menyebut apa yang harus TERJADI, bukan cuma
    // bahwa ia sementara. "Sementara" tanpa syarat adalah permanen.
    expect(YAML).toMatch(/HIDUPKAN KEMBALI/);
  });

  it.runIf(!aktif)('blok pemicunya DIKOMENTARI, bukan dihapus', () => {
    // Menghapusnya berarti menghidupkannya kembali menuntut menulis ulang
    // dari ingatan — dan `workflow_run` punya tiga baris yang mudah salah
    // (`workflows`, `types`, `branches`).
    expect(YAML).toMatch(/#\s*workflow_run\s*:/);
    expect(YAML).toMatch(/#\s*workflows:\s*\['CI'\]/);
    expect(YAML).toMatch(/#\s*branches:\s*\[main\]/);
  });
});
