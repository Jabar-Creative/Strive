// Satu konfigurasi ESLint untuk SELURUH workspace — lihat CLAUDE.md §Konvensi kode.
// Flat config (ESLint 9).
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

// `eslint-config-next` 15.5 masih eslintrc-based; FlatCompat menjembatani agar
// tetap SATU konfigurasi untuk seluruh workspace.
const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
      '**/coverage/**',
      '**/.venv/**',
      '**/playwright-report/**',
      '**/test-results/**',
      'pnpm-lock.yaml',
      '**/next-env.d.ts', // digenerate Next.js, tidak boleh diedit
      '.husky/_/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Aturan khusus Next.js — hanya untuk apps/web.
  ...compat.extends('next/core-web-vitals').map((cfg) => ({
    ...cfg,
    files: ['apps/web/**/*.{ts,tsx,js,jsx}'],
    settings: { ...cfg.settings, next: { rootDir: 'apps/web' } },
  })),

  prettier,

  // Kode Node murni (script, file konfigurasi) — `no-undef` aktif di sini
  // karena bukan file TypeScript.
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: { globals: globals.node },
  },

  // Kode web berjalan di dua tempat: server (RSC) dan browser.
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },

  {
    files: ['apps/api/**/*.ts', 'packages/**/*.ts'],
    languageOptions: { globals: globals.node },
  },

  {
    rules: {
      // CLAUDE.md: "Tidak ada `any` tanpa komentar yang menjelaskan kenapa."
      // Diperiksa manusia di review; lint hanya memperingatkan agar tidak lolos diam-diam.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // CLAUDE.md: "Tidak ada console.log di kode produksi — pakai logger terstruktur."
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },

  // ── Batas modul NestJS ──────────────────────────────────────────────────
  // CLAUDE.md + PRD §8.2: batas antar-modul ditegakkan lewat lint, bukan lewat
  // jaringan. Impor lintas modul HANYA lewat barrel file (`../wallet`), tidak
  // pernah menembus ke file di dalamnya (`../wallet/coin-ledger.service`).
  //
  // Nama modul domain dienumerasi eksplisit (disinkronkan dengan
  // apps/api/src/app.module.ts dan CLAUDE.md "Struktur repo") alih-alih
  // wildcard `../*/*` generik. Wildcard generik ikut menangkap
  // `../../infra/kysely` — infra BUKAN modul domain (di situlah
  // `KyselyModule`, dan setiap modul yang butuh `@Inject(DATABASE)` wajib
  // mengimpornya) — dan memblokir SEMUA modul yang butuh Kysely, bukan cuma
  // satu modul. (Percobaan pertama pakai negasi gitignore-style
  // `!../../infra/**` — TERNYATA tidak didukung `no-restricted-imports` versi
  // ESLint di repo ini, jadi diganti enumerasi presisi.) Ditemukan &
  // diperbaiki saat mengerjakan P-01 (modul `payment` butuh Kysely untuk
  // pertama kalinya).
  //
  // Kalau menambah modul domain baru: tambahkan namanya juga di sini.
  {
    files: ['apps/api/src/modules/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'admin',
                'auth',
                'career',
                'health',
                'league',
                'learning',
                'mastery',
                'mentor',
                'notification',
                'payment',
                'scan',
                'squad',
                'store',
                'streak',
                'users',
                'wallet',
              ]
                .flatMap((name) => [`../${name}/*`, `../../${name}/*`])
                // Koreksi audit P-01 (T-2): enumerasi di atas menutup
                // `../wallet/x` dan `../../wallet/x`, tapi TIDAK menutup
                // `../../modules/wallet/x` atau `../../../modules/wallet/x`
                // — bentuk path yang sebelumnya (sebelum perbaikan `infra`)
                // ikut tertutup wildcard generik `../*/*`/`../../*/*`. Tanpa
                // dua pola ini, siapa pun bisa menembus barrel modul lain
                // hanya dengan menulis path lewat `modules/` secara eksplisit
                // — dibuktikan lewat ESLint Linter API repo ini sebelum
                // pola ini ditambahkan (lint lolos untuk path itu).
                .concat(['../../modules/*/*', '../../../modules/*/*']),
              message:
                'Batas modul: impor dari modul lain hanya lewat barrel file (contoh: `../wallet`), bukan file di dalamnya.',
            },
          ],
        },
      ],
    },
  },

  // Barrel file boleh mengekspor isinya sendiri.
  {
    files: ['apps/api/src/modules/**/index.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },

  // Script build/dev dan seed memang menulis ke stdout.
  {
    files: ['scripts/**/*.{mjs,js,ts}', '**/*.config.{mjs,js,ts}', 'db/seeds/**/*.ts'],
    rules: { 'no-console': 'off' },
  },

  // Test boleh lebih longgar.
  {
    files: ['**/*.spec.ts', '**/*.test.ts', '**/*.e2e-spec.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },
);
