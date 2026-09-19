import { Kysely, sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { createDatabase, type DB } from '../src/infra/kysely';
import { KyselyModule } from '../src/infra/kysely';
import { AuthModule } from '../src/modules/auth';
import { ResendMailerService } from '../src/modules/notification';

/**
 * Isu #65 poin 1 & 2, terhadap DATABASE + HTTP NYATA.
 *
 * Dua hal yang diperbaiki PR ini hanya bisa dibuktikan lewat jalur sungguhan:
 *
 * 1. **Callback email.** `POST /auth/request-password-reset` menjawab 400
 *    `RESET_PASSWORD_DISABLED` sebelum ini. Yang membuktikan perbaikannya
 *    bukan "callback-nya ada di config", tapi **email yang benar-benar diminta
 *    untuk dikirim, dengan tautan yang benar-benar terbentuk**.
 *
 * 2. **`timezone` lewat registrasi.** Sebelum ini semua pendaftar jatuh ke
 *    `Asia/Jakarta` apa pun yang dikirim — bukan karena ditolak, tapi karena
 *    Better-Auth membuang field yang tidak terdaftar di `additionalFields`.
 *    Yang membuktikannya adalah nilai di `users.timezone` DAN `streaks.timezone`
 *    (trigger 005), lalu nilai itu dipakai `AT TIME ZONE` sungguhan.
 */

const URL_DEV = 'postgres://strive:strive_dev_only@localhost:55432/strive';
const url = process.env['DATABASE_URL_TEST'] ?? process.env['DATABASE_URL'] ?? URL_DEV;

const WEB = 'http://localhost:3000';
const SANDI = 'kataSandiPanjang123';

interface EmailTertangkap {
  to: string;
  subject: string;
  html: string;
}

let db: Kysely<DB>;
let app: INestApplication;
let base: string;
let reachable = false;

/** Email yang DIMINTA untuk dikirim. Tidak ada jaringan yang disentuh. */
const kotakMasuk: EmailTertangkap[] = [];
/** Kalau diisi, pengirim palsu melemparnya — untuk menguji kegagalan vendor. */
let galatKirim: Error | null = null;

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: WEB, ...headers },
    body: JSON.stringify(body),
  });
}

/** Satu-satunya email yang masuk, atau gagal dengan pesan yang menjelaskan. */
function satuEmail(): EmailTertangkap {
  expect(kotakMasuk.length, `harusnya tepat 1 email, ada ${kotakMasuk.length}`).toBe(1);
  return kotakMasuk[0]!;
}

/** Tautan pertama di badan email — itu yang benar-benar diklik pengguna. */
function tautanDari(email: EmailTertangkap): string {
  const m = email.html.match(/href="([^"]+)"/);
  expect(m, 'email tidak memuat satu pun href').toBeTruthy();
  return m![1]!.replace(/&amp;/g, '&');
}

/**
 * Token dari tautan Better-Auth.
 *
 * DITEMUKAN saat menulis test ini, dan bukan yang kuduga: tokennya ada di
 * **segmen path**, bukan query string —
 * `/api/v1/auth/reset-password/<token>?callbackURL=...`. Test yang mencari
 * `?token=` lulus-palsu mustahil, tapi asumsi yang salah tetap membuatnya
 * merah untuk alasan yang salah. Dicatat di sini supaya orang berikutnya
 * tidak mengulang tebakannya.
 */
function tokenDari(tautan: string): string {
  const u = new URL(tautan);
  const dariQuery = u.searchParams.get('token');
  if (dariQuery) return dariQuery;
  const segmen = u.pathname.split('/').filter(Boolean).pop();
  expect(segmen, `tidak menemukan token di ${tautan}`).toBeTruthy();
  return segmen!;
}

beforeAll(async () => {
  db = createDatabase(url);
  try {
    await db.selectFrom('users').select('id').limit(1).execute();
    reachable = true;
  } catch {
    reachable = false;
    return;
  }

  process.env['DATABASE_URL'] = url;
  process.env['AUTH_SECRET'] = 'rahasia-uji-yang-cukup-panjang-0123456789';
  process.env['APP_URL'] = WEB;

  const moduleRef = await Test.createTestingModule({
    imports: [KyselyModule, AuthModule],
  })
    // Pengirim palsu, BUKAN mock HTTP Resend. Yang diuji di sini adalah
    // kontrak `SendAuthEmail` — apakah auth meminta email yang benar dikirim
    // ke alamat yang benar. Apakah Resend menerimanya adalah urusan N-01.
    .overrideProvider(ResendMailerService)
    .useValue({
      send: async (pesan: EmailTertangkap) => {
        if (galatKirim) throw galatKirim;
        kotakMasuk.push(pesan);
      },
    })
    .compile();

  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });
  app.enableCors({ origin: WEB, credentials: true });
  const server = await app.listen(0);
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('tidak mendapat port listen');
  base = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  if (app) await app.close();
  if (db) await db.destroy();
});

beforeEach(async () => {
  if (!reachable) return;
  kotakMasuk.length = 0;
  galatKirim = null;
  await sql`TRUNCATE users RESTART IDENTITY CASCADE`.execute(db);
});

describe('Callback email auth (isu #65 poin 1)', () => {
  it('database siap dipakai', () => {
    expect(reachable, `DATABASE_URL tidak bisa dipakai (${url})`).toBe(true);
  });

  it('registrasi MEMINTA email verifikasi terkirim, dengan tautan bertoken', async () => {
    if (!reachable) return;
    const res = await post('/api/v1/auth/sign-up/email', {
      email: 'v1@uji.test',
      password: SANDI,
      name: 'Uji Verifikasi',
    });
    expect(res.status).toBe(200);

    const email = satuEmail();
    expect(email.to).toBe('v1@uji.test');
    expect(email.subject).toContain('Verifikasi');
    // Namanya ikut — email transaksional tanpa sapaan terbaca seperti spam.
    expect(email.html).toContain('Uji Verifikasi');

    const tautan = tautanDari(email);
    expect(tautan).toContain('/verify-email');
    expect(tautan).toMatch(/token=/);
  });

  it('AC utama: request-password-reset TIDAK LAGI 400, dan emailnya benar-benar diminta', async () => {
    if (!reachable) return;
    await post('/api/v1/auth/sign-up/email', {
      email: 'r1@uji.test',
      password: SANDI,
      name: 'Uji Reset',
    });
    kotakMasuk.length = 0; // buang email verifikasi dari registrasi

    const res = await post('/api/v1/auth/request-password-reset', {
      email: 'r1@uji.test',
      redirectTo: `${WEB}/reset/finish`,
    });

    // Inilah yang dibalik PR ini. Sebelumnya: 400 RESET_PASSWORD_DISABLED.
    expect(res.status).toBe(200);

    const email = satuEmail();
    expect(email.to).toBe('r1@uji.test');
    const tautan = tautanDari(email);
    expect(tautan).toContain('/reset-password');
    expect(tokenDari(tautan).length).toBeGreaterThan(16);
    // Tautannya menunjuk API, yang lalu MENGALIHKAN ke layar web A-03.
    expect(tautan).toContain(encodeURIComponent(`${WEB}/reset/finish`));
  });

  it('tautan email mengalihkan ke layar /reset/finish milik A-03, membawa token', async () => {
    if (!reachable) return;
    // Serah terima antara email dan layar Kemal. Kalau alihannya tidak membawa
    // token, `/reset/finish` tidak punya apa pun untuk dikirim balik — dan
    // gejalanya baru terlihat oleh pengguna sungguhan yang lupa password.
    await post('/api/v1/auth/sign-up/email', {
      email: 'r3@uji.test',
      password: SANDI,
      name: 'Uji',
    });
    kotakMasuk.length = 0;
    await post('/api/v1/auth/request-password-reset', {
      email: 'r3@uji.test',
      redirectTo: `${WEB}/reset/finish`,
    });

    // Tautannya menunjuk baseURL produksi; diarahkan ke server test.
    const asli = new URL(tautanDari(satuEmail()));
    const res = await fetch(`${base}${asli.pathname}${asli.search}`, { redirect: 'manual' });

    expect(res.status, 'tautan email tidak mengalihkan').toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);

    const tujuan = new URL(res.headers.get('location') ?? '', WEB);
    expect(tujuan.origin + tujuan.pathname).toBe(`${WEB}/reset/finish`);
    expect(tujuan.searchParams.get('token'), 'alihan tanpa token').toBeTruthy();
  });

  it('token reset benar-benar BEKERJA: password baru dipakai untuk login', async () => {
    if (!reachable) return;
    // Callback yang mengirim email berisi token mati akan lolos semua test di
    // atas. Satu-satunya bukti adalah memakai tokennya sampai bisa login.
    await post('/api/v1/auth/sign-up/email', {
      email: 'r2@uji.test',
      password: SANDI,
      name: 'Uji',
    });
    kotakMasuk.length = 0;

    await post('/api/v1/auth/request-password-reset', {
      email: 'r2@uji.test',
      redirectTo: `${WEB}/reset/finish`,
    });
    const token = tokenDari(tautanDari(satuEmail()));

    const SANDI_BARU = 'sandiBaruPanjang456';
    const ganti = await post('/api/v1/auth/reset-password', {
      newPassword: SANDI_BARU,
      token,
    });
    expect(ganti.status).toBe(200);

    const lama = await post('/api/v1/auth/sign-in/email', {
      email: 'r2@uji.test',
      password: SANDI,
    });
    expect(lama.status).toBeGreaterThanOrEqual(400);

    const baru = await post('/api/v1/auth/sign-in/email', {
      email: 'r2@uji.test',
      password: SANDI_BARU,
    });
    expect(baru.status).toBe(200);
  });

  it('alamat yang TIDAK terdaftar tetap dijawab 200 — bukan alat pencacah akun', async () => {
    if (!reachable) return;
    const res = await post('/api/v1/auth/request-password-reset', {
      email: 'tidak-ada@uji.test',
      redirectTo: `${WEB}/reset/finish`,
    });
    expect(res.status).toBe(200);
    expect(kotakMasuk, 'email terkirim ke alamat yang tidak punya akun').toHaveLength(0);
  });

  it('vendor email MATI tidak menggagalkan registrasi', async () => {
    if (!reachable) return;
    // Kalau callback-nya meneruskan error, Resend yang down berarti TIDAK ADA
    // yang bisa mendaftar. Kegagalan email seharusnya menunda satu pengguna
    // bisa top-up, bukan menutup pintu pendaftaran.
    galatKirim = new Error('Resend menolak pengiriman (api_error): simulasi vendor mati');

    const res = await post('/api/v1/auth/sign-up/email', {
      email: 'gagal@uji.test',
      password: SANDI,
      name: 'Uji',
    });
    expect(res.status, 'registrasi gagal gara-gara vendor email').toBe(200);

    const u = await db
      .selectFrom('users')
      .select('id')
      .where('email', '=', 'gagal@uji.test')
      .executeTakeFirst();
    expect(u, 'pengguna tidak terbuat padahal hanya emailnya yang gagal').toBeTruthy();
  });

  it('vendor email MATI tidak membocorkan alamat mana yang punya akun', async () => {
    if (!reachable) return;
    await post('/api/v1/auth/sign-up/email', {
      email: 'ada@uji.test',
      password: SANDI,
      name: 'Uji',
    });
    galatKirim = new Error('simulasi vendor mati');

    // Respons untuk alamat yang ADA dan yang TIDAK ADA harus tetap identik.
    // Kalau kegagalan kirim diteruskan jadi 500, selisih inilah yang jadi
    // oracle pencacah akun.
    const ada = await post('/api/v1/auth/request-password-reset', {
      email: 'ada@uji.test',
      redirectTo: `${WEB}/reset/finish`,
    });
    const tiada = await post('/api/v1/auth/request-password-reset', {
      email: 'tidak-ada@uji.test',
      redirectTo: `${WEB}/reset/finish`,
    });
    expect(ada.status).toBe(tiada.status);
    expect(ada.status).toBe(200);
  });
});

describe('AU-7 timezone lewat registrasi (isu #65 poin 2)', () => {
  /** Zona waktu tersimpan untuk sebuah email, dari `users` DAN `streaks`. */
  async function zonaTersimpan(email: string) {
    return db
      .selectFrom('users')
      .innerJoin('streaks', 'streaks.user_id', 'users.id')
      .select(['users.id', 'users.timezone as tz_user', 'streaks.timezone as tz_streak'])
      .where('users.email', '=', email)
      .executeTakeFirstOrThrow();
  }

  it('AC: timezone dari body registrasi BENAR-BENAR tersimpan', async () => {
    if (!reachable) return;
    const res = await post('/api/v1/auth/sign-up/email', {
      email: 'tz1@uji.test',
      password: SANDI,
      name: 'Uji Papua',
      timezone: 'Asia/Jayapura',
    });
    expect(res.status).toBe(200);

    const r = await zonaTersimpan('tz1@uji.test');
    expect(r.tz_user, 'timezone dibuang Better-Auth — additionalFields tidak bekerja').toBe(
      'Asia/Jayapura',
    );
    // Trigger 005 menyalinnya DALAM TRANSAKSI YANG SAMA. Kalau yang ini
    // meleset, streak pengguna putus di jam yang salah (aturan keras 5).
    expect(r.tz_streak, 'streaks.timezone tidak ikut — trigger 005 tidak menyalin').toBe(
      'Asia/Jayapura',
    );
  });

  it('users.timezone dan streaks.timezone TIDAK PERNAH berbeda', async () => {
    if (!reachable) return;
    for (const [i, tz] of ['Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura', 'UTC'].entries()) {
      await post('/api/v1/auth/sign-up/email', {
        email: `tz-sama-${i}@uji.test`,
        password: SANDI,
        name: 'Uji',
        timezone: tz,
      });
      const r = await zonaTersimpan(`tz-sama-${i}@uji.test`);
      expect(r.tz_user, `${tz}: users`).toBe(tz);
      expect(r.tz_streak, `${tz}: streaks menyimpang dari users`).toBe(tz);
    }
  });

  it('AU-7 fallback: tanpa timezone di body → Asia/Jakarta', async () => {
    if (!reachable) return;
    await post('/api/v1/auth/sign-up/email', {
      email: 'tz2@uji.test',
      password: SANDI,
      name: 'Uji',
    });
    const r = await zonaTersimpan('tz2@uji.test');
    expect(r.tz_user).toBe('Asia/Jakarta');
    expect(r.tz_streak).toBe('Asia/Jakarta');
  });

  it('huruf kecil dinormalkan, bukan ditolak', async () => {
    if (!reachable) return;
    await post('/api/v1/auth/sign-up/email', {
      email: 'tz3@uji.test',
      password: SANDI,
      name: 'Uji',
      timezone: 'asia/makassar',
    });
    const r = await zonaTersimpan('tz3@uji.test');
    expect(r.tz_user).toBe('Asia/Makassar');
  });

  it('timezone tidak dikenal DITOLAK, dan penggunanya tidak terbuat', async () => {
    if (!reachable) return;
    const res = await post('/api/v1/auth/sign-up/email', {
      email: 'tz4@uji.test',
      password: SANDI,
      name: 'Uji',
      timezone: 'Mars/Olympus',
    });
    expect(res.status, 'zona waktu sampah diterima').toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);

    // Penting: registrasi ditolak SEUTUHNYA. Pengguna setengah jadi dengan
    // zona waktu salah lebih buruk daripada registrasi yang gagal terang.
    const u = await db
      .selectFrom('users')
      .select('id')
      .where('email', '=', 'tz4@uji.test')
      .executeTakeFirst();
    expect(u, 'pengguna terbuat padahal zona waktunya ditolak').toBeUndefined();
  });

  it('ATURAN KERAS 5: zona tersimpan benar-benar bisa dipakai AT TIME ZONE', async () => {
    if (!reachable) return;
    // Inilah alasan validasinya ada. Zona waktu yang lolos registrasi tapi
    // tidak dikenal PostgreSQL akan meledak di query streak — jauh dari sini,
    // dengan pesan yang tidak menunjuk ke registrasi.
    for (const [i, tz] of ['Asia/Jayapura', 'UTC', 'America/New_York', 'Asia/Calcutta'].entries()) {
      const email = `tz-rule5-${i}@uji.test`;
      const res = await post('/api/v1/auth/sign-up/email', {
        email,
        password: SANDI,
        name: 'Uji',
        timezone: tz,
      });
      expect(res.status, `${tz} ditolak registrasi`).toBe(200);

      const r = await sql<{ hari: string }>`
        SELECT (now() AT TIME ZONE u.timezone)::date::text AS hari
        FROM users u WHERE u.email = ${email}
      `.execute(db);
      expect(r.rows[0]?.hari, `AT TIME ZONE gagal untuk ${tz}`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('zona waktu ikut di respons registrasi — layar register bisa menampilkannya', async () => {
    if (!reachable) return;
    const res = await post('/api/v1/auth/sign-up/email', {
      email: 'tz5@uji.test',
      password: SANDI,
      name: 'Uji',
      timezone: 'Asia/Makassar',
    });
    const body = (await res.json()) as { user: Record<string, unknown> };
    expect(body.user['timezone']).toBe('Asia/Makassar');
  });
});
