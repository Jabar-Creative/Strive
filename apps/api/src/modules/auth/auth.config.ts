import { hash as argonHash, verify as argonVerify, Algorithm } from '@node-rs/argon2';
import { betterAuth } from 'better-auth';
import { Pool } from 'pg';

import type { AuthOptions, StriveAuth } from './auth.types';

/**
 * Instance Better-Auth untuk Strive.
 *
 * DIBELI, BUKAN DIBANGUN (CLAUDE.md §Yang dibeli). Berkas ini **konfigurasi**,
 * bukan logika auth — kalau muncul dorongan menulis alur login sendiri di
 * sini, berhenti.
 *
 * Isu #18 memutuskan skema mengikuti Better-Auth. Yang tersisa di berkas ini
 * adalah menjembatani empat perbedaan yang **tidak bisa** diselesaikan skema,
 * dan ketiganya pernah salah sebelum diuji:
 *
 * 1. **Nama kolom.** Better-Auth memakai camelCase, skema ini snake_case.
 *    Setiap field dipetakan eksplisit di bawah.
 * 2. **Bentuk id.** Lihat catatan `generateId` — ini yang paling mudah salah.
 * 3. **Algoritma hash.** Bawaannya scrypt; AU-3 mewajibkan Argon2id.
 * 4. **Nama tabel.** `account` / `verification` jadi `auth_accounts` /
 *    `auth_verifications` — jamak sesuai konvensi repo, dan berprefiks supaya
 *    tidak terbaca seperti tabel keuangan di sebelah `orders` dan `payments`.
 */
export function createAuth(opts: AuthOptions): StriveAuth {
  return betterAuth({
    baseURL: opts.baseURL ?? 'http://localhost:3001',
    secret: opts.secret,
    basePath: opts.basePath,
    trustedOrigins: opts.trustedOrigins,

    // Pool terpisah dari `infra/kysely`, dan itu disengaja: Better-Auth
    // memiliki transaksinya sendiri. Konsekuensinya nyata — ia TIDAK bisa
    // menulis `streaks`/`reviewer_weights` dalam transaksi yang sama, jadi
    // AU-6 ditegakkan trigger database (migrasi 005), bukan di sini.
    database: new Pool({ connectionString: opts.connectionString }),

    emailAndPassword: {
      enabled: true,
      // AU-2: panjang minimal 10. Tidak ada aturan komposisi — panjang lebih
      // efektif, dan aturan komposisi membuat orang memakai `Password1!`.
      minPasswordLength: 10,

      // AU-3: Argon2id, bukan scrypt bawaan Better-Auth.
      //
      // Parameternya sengaja dibiarkan default pustaka (m=19456, t=2, p=1) —
      // itu profil yang direkomendasikan OWASP untuk Argon2id, dan menurunkan
      // salah satunya "supaya lebih cepat" adalah cara paling sunyi untuk
      // melemahkan hash.
      password: {
        hash: (password: string) => argonHash(password, { algorithm: Algorithm.Argon2id }),
        verify: ({ hash, password }: { hash: string; password: string }) =>
          argonVerify(hash, password),
      },
    },

    advanced: {
      database: {
        // HARUS 'uuid'. Bukan `false`, dan bukan dibiarkan default.
        //
        // Default menghasilkan string base62 32 karakter yang tidak muat di
        // kolom `uuid`, dan `users.id` dirujuk puluhan foreign key.
        //
        // `false` terasa seperti pilihan yang benar untuk "biar database yang
        // membuatnya lewat DEFAULT gen_random_uuid()" — dan itu jebakannya.
        // Resolvernya mengembalikan `false`, sementara pemanggilnya menulis
        // `ctx.context.generateId({...}) || generateId()`, jadi ia **jatuh
        // kembali ke generator bawaan** tanpa error. Hanya 'uuid' yang
        // benar-benar memanggil `crypto.randomUUID()`.
        generateId: 'uuid',
      },

      // Pemeriksaan origin dikunci EKSPLISIT (A-03). Tanpa baris ini,
      // Better-Auth menyala-matikan proteksi CSRF berdasarkan inferensi env:
      // `NODE_ENV=test` atau `TEST=1` membuat pemeriksaan origin DILEWATI
      // diam-diam. Postur keamanan tidak boleh bergantung pada nama env
      // proses — API yang kebetulan berjalan dengan env test akan kehilangan
      // perlindungan ini tanpa error apa pun.
      disableOriginCheck: false,
    },

    // ── pemetaan nama tabel & kolom ──────────────────────────────────────
    user: {
      modelName: 'users',
      fields: {
        name: 'display_name',
        image: 'avatar_url',
        // Isu #35 opsi 1: kolomnya `email_verified` (boolean), bukan
        // `email_verified_at` (timestamptz). Pemetaan field hanya mengganti
        // NAMA, tidak pernah tipe — dibuktikan dengan menjalankan
        // getAuthTables(), dan PostgreSQL menolak boolean ke timestamptz.
        emailVerified: 'email_verified',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },
    session: {
      modelName: 'sessions',
      fields: {
        userId: 'user_id',
        expiresAt: 'expires_at',
        ipAddress: 'ip',
        userAgent: 'user_agent',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
      // AU-4 (isu #18): sesi server 30 HARI. Default pustaka hanya 7 hari —
      // ditemukan saat A-03 memasang handler HTTP; tanpa ini perilaku
      // menyimpang dari PRD tanpa error apa pun. `updateAge` dibiarkan
      // default (1 hari): sesi yang dipakai diperpanjang maksimal sekali per
      // hari, dan itulah padanan "refresh senyap" di dunia sesi (AC A-03).
      expiresIn: 60 * 60 * 24 * 30,
    },
    account: {
      modelName: 'auth_accounts',
      fields: {
        accountId: 'account_id',
        providerId: 'provider_id',
        userId: 'user_id',
        accessToken: 'access_token',
        refreshToken: 'refresh_token',
        idToken: 'id_token',
        accessTokenExpiresAt: 'access_token_expires_at',
        refreshTokenExpiresAt: 'refresh_token_expires_at',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },
    verification: {
      modelName: 'auth_verifications',
      fields: {
        expiresAt: 'expires_at',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },
  }) as StriveAuth;
}
