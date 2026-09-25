import { hash as argonHash, verify as argonVerify, Algorithm } from '@node-rs/argon2';
import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { Logger } from '@nestjs/common';
import { Pool } from 'pg';

import type { AuthOptions, SendAuthEmail, StriveAuth } from './auth.types';
import {
  SUBJEK_RESET,
  SUBJEK_VERIFIKASI,
  renderResetPasswordEmail,
  renderVerificationEmail,
} from './auth-emails';
import { ZONA_DEFAULT, skemaZonaWaktu } from './timezone';

const logger = new Logger('AuthEmail');

/**
 * Hanya string `true` (setelah trim) yang menyalakan cookie lintas situs.
 *
 * Sengaja ketat: `TRUE`, `1`, dan string kosong tetap mati. Staging menyetel
 * persis `true`. Nilai lain — termasuk variabel yang terpasang tapi salah
 * ketik — mempertahankan SameSite=Lax, bukan diam-diam melonggarkan cookie.
 */
export function cookieLintasSitus(nilai: string | undefined): boolean {
  return nilai?.trim() === 'true';
}

/**
 * Atribut yang ditimpa di atas bawaan Better-Auth saat cookie lintas situs
 * menyala. `undefined` = jangan pasang `defaultCookieAttributes` sama sekali,
 * supaya httpOnly, path, dan SameSite=Lax bawaan tidak tersentuh.
 *
 * Better-Auth menggabungkan objek ini dengan spread SETELAH
 * `{ sameSite: 'lax', httpOnly: true, path: '/' }`, jadi `httpOnly` tetap ada
 * selama kita tidak menuliskannya di sini.
 */
export function atributCookieLintasSitus(
  nyala: boolean,
): { sameSite: 'none'; secure: true } | undefined {
  if (!nyala) return undefined;
  return { sameSite: 'none', secure: true };
}

/**
 * Membungkus pengiriman email auth supaya kegagalan vendor TIDAK menggagalkan
 * registrasi atau permintaan reset (isu #65 poin 1).
 *
 * Dua alasan, dan keduanya soal apa yang rusak kalau dilakukan sebaliknya:
 *
 * 1. **Registrasi.** `sendOnSignUp` berjalan di dalam alur sign-up. Kalau
 *    callback-nya melempar, Resend yang sedang down berarti **tidak ada yang
 *    bisa mendaftar**. Kegagalan mengirim email verifikasi seharusnya menunda
 *    kemampuan top-up satu pengguna, bukan menutup pintu pendaftaran.
 *
 * 2. **Reset password.** Better-Auth sengaja menjawab sukses baik alamatnya
 *    terdaftar maupun tidak, supaya tidak jadi alat pencacah akun. Kalau
 *    kegagalan kirim diteruskan jadi 500, perbedaan respons itu **membocorkan
 *    alamat mana yang punya akun** — persis yang dihindari desain aslinya.
 *
 * Gantinya: log `error` dengan alamat tujuan. Kegagalan tetap terlihat
 * operator, bukan hilang. Pengguna yang tidak menerima email menekan "kirim
 * ulang" — dan itu jalur yang memang harus ada.
 */
function kirimAman(send: SendAuthEmail, jenis: string) {
  return async (pesan: { to: string; subject: string; html: string }): Promise<void> => {
    try {
      await send(pesan);
    } catch (e) {
      logger.error(
        `Gagal mengirim email ${jenis} ke ${pesan.to}: ${e instanceof Error ? e.message : String(e)}. ` +
          `Alur pemanggilnya SENGAJA diteruskan — lihat catatan di auth.config.ts.`,
      );
    }
  };
}

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
  const kirim = opts.sendEmail;
  const atributCookie = atributCookieLintasSitus(opts.crossSiteCookie === true);

  // Dianotasi `BetterAuthOptions`, bukan dibiarkan inferensi lalu di-cast.
  //
  // `betterAuth` generik terhadap bentuk opsinya (`<O> (o: O) => Auth<O>`),
  // jadi objek literal menghasilkan tipe yang JAUH lebih sempit daripada
  // `Auth<BetterAuthOptions>` — dan begitu `additionalFields` ditambahkan,
  // `as StriveAuth` yang dulu ada di sini berhenti bisa dikompilasi. Menambah
  // `as unknown as` akan menutup gejalanya sekaligus mematikan pengecekan tipe
  // atas SELURUH objek konfigurasi ini. Anotasi di sini melakukan kebalikannya:
  // setiap salah ketik nama opsi jadi error, bukan properti yang diabaikan
  // diam-diam.
  const opsi: BetterAuthOptions = {
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

      // AU-8: verifikasi email TIDAK memblokir pemakaian. Dinyatakan eksplisit
      // meski `false` adalah bawaannya — baris yang tertulis lebih sulit
      // dibalik tanpa sengaja daripada baris yang tidak ada, dan membalik yang
      // satu ini berarti seluruh pengguna baru terkunci di luar produk sampai
      // membuka inbox.
      requireEmailVerification: false,

      // isu #65 poin 1. Tanpa ini `POST /auth/request-password-reset` menjawab
      // 400 RESET_PASSWORD_DISABLED — dan itulah keadaan `main` sebelum PR ini.
      ...(kirim
        ? {
            sendResetPassword: async ({
              user,
              url,
            }: {
              user: { email: string; name?: string | null };
              url: string;
            }) => {
              await kirimAman(
                kirim,
                'reset password',
              )({
                to: user.email,
                subject: SUBJEK_RESET,
                html: renderResetPasswordEmail({ displayName: user.name, url }),
              });
            },
          }
        : {}),
    },

    // isu #65 poin 1, sisi verifikasi. AU-8 mensyaratkan `email_verified`
    // sebagai syarat top-up; tanpa callback ini kolom itu TIDAK PERNAH jadi
    // true lewat jalur normal, jadi AU-8 bukan "belum diuji" melainkan
    // **tidak bisa dipenuhi siapa pun**.
    ...(kirim
      ? {
          emailVerification: {
            // Dikirim saat registrasi, bukan menunggu pengguna memintanya.
            // Email verifikasi yang harus diminta dulu adalah email yang tidak
            // pernah diminta.
            sendOnSignUp: true,
            sendVerificationEmail: async ({
              user,
              url,
            }: {
              user: { email: string; name?: string | null };
              url: string;
            }) => {
              await kirimAman(
                kirim,
                'verifikasi',
              )({
                to: user.email,
                subject: SUBJEK_VERIFIKASI,
                html: renderVerificationEmail({ displayName: user.name, url }),
              });
            },
          },
        }
      : {}),

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

      // F-05 opsi A. Web dan API di staging tinggal di dua situs
      // (vercel.app dan up.railway.app, keduanya Public Suffix List).
      // SameSite=Lax tidak ikut pada fetch lintas situs.
      //
      // Batas yang diterima sadar, bukan yang terlewat:
      // - middleware Next membaca cookie permintaan di DOMAIN WEB, sementara
      //   sesi dipasang di domain API. /mentor dan /admin tetap terpental
      //   ke /login.
      // - Safari/iOS memblokir cookie pihak ketiga, jadi login dari sana
      //   kemungkinan gagal walau SameSite=None; Secure.
      ...(atributCookie ? { defaultCookieAttributes: atributCookie } : {}),
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

      // AU-7, isu #65 poin 2: zona waktu dari body registrasi.
      //
      // Better-Auth HANYA meneruskan field yang terdaftar di sini — field lain
      // di body dibuang diam-diam. Itu sebabnya sebelum ini SEMUA pendaftar
      // jatuh ke `Asia/Jakarta` apa pun yang mereka kirim: bukan karena
      // validasinya menolak, tapi karena nilainya tidak pernah sampai.
      //
      // Efek hilirnya otomatis: trigger `users_registration_rows` (migrasi
      // 005) menyalin `NEW.timezone` ke `streaks.timezone` DALAM TRANSAKSI
      // YANG SAMA. Jadi cukup nilainya benar di `users`, dan aturan keras 5
      // ikut benar tanpa kode tambahan.
      additionalFields: {
        timezone: {
          type: 'string',
          required: false,
          input: true,
          // AU-7 "fallback Asia/Jakarta" — untuk klien yang tidak mengirim
          // apa pun. Sama dengan DEFAULT kolomnya, jadi tidak ada dua sumber
          // kebenaran untuk satu fakta.
          defaultValue: ZONA_DEFAULT,
          // Nilai yang ADA tapi tidak dikenal DITOLAK, bukan diam-diam
          // diganti default. Diam-diam mengganti berarti mahasiswa Jayapura
          // yang salah ketik mendapat jam Jakarta, streaknya putus di jam yang
          // salah, dan tidak ada satu pun sinyal yang menunjukkan kenapa.
          //
          // CATATAN: AU-7 menulis "divalidasi terhadap daftar IANA, fallback
          // Asia/Jakarta" tanpa menyebut yang mana yang berlaku untuk nilai
          // tidak sah. Ditafsirkan: TIDAK ADA → fallback; ADA tapi salah →
          // tolak. Ditulis di sini supaya keputusannya terlihat dan bisa
          // dibalik, bukan tersembunyi di perilaku.
          validator: { input: skemaZonaWaktu },
        },
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
  };

  return betterAuth(opsi);
}
