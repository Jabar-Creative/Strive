# R-03 — laporan audit keamanan

**23 September 2026** · Dev A · terhadap commit `bff51fc` (`P-03` ter-merge)

Checklist §16.1 punya 19 baris. Laporan ini memberi status dan **bukti** untuk tiap
baris — bukan penilaian. Baris yang lulus menyebut berkas dan barisnya; baris yang
gagal menyebut apa yang dicoba dan tidak ditemukan.

> **Batas yang perlu dibaca lebih dulu.** Audit ini memeriksa **kode**, bukan
> deployment: `F-05` (staging) masih `blocked`, jadi tidak ada TLS, reverse proxy,
> maupun konfigurasi produksi yang bisa diperiksa. Tiga baris checklist menunggu itu
> dan ditandai demikian — bukan lulus, bukan gagal.

---

## Ringkasan

| | Jumlah |
|---|---:|
| Lulus, dengan bukti | 11 |
| **Gagal — diperbaiki di PR ini** | **4** |
| Gagal — diangkat sebagai isu | 2 |
| Menunggu `F-05` (deployment) | 2 |

Empat yang diperbaiki di sini: rate limit yang **tidak ada sama sekali**, header
keamanan yang **nol dari empat**, CORS yang diam-diam menjadi `*`, dan tanda tangan
Midtrans yang tersimpan di tabel yang dibaca Retool.

---

## Checklist §16.1, baris demi baris

| # | Baris | Status | Bukti |
|---|---|---|---|
| 1 | TLS 1.3, HSTS aktif | ⏸ menunggu `F-05` | `infra/` tidak punya reverse proxy (`infra/README.md:31`). Kode sudah siap: `Strict-Transport-Security` dikirim saat `x-forwarded-proto: https` |
| 2 | Password Argon2id, tidak pernah di log | ✅ | `auth.config.ts` menimpa `password.hash/verify` dengan `@node-rs/argon2`; diuji dengan mencocokkan `^\$argon2id\$` di kolomnya. `password_hash` tidak direferensikan satu kali pun dari `apps/api/src` (kolomnya dibuang migrasi 007) |
| 3 | JWT ≥ 32 byte dari env | ➖ tidak berlaku | Tidak ada JWT. Sesi Better-Auth berbasis tabel `sessions`. Baris ini peninggalan rancangan pra-`A-01` |
| 4 | Refresh token disimpan sebagai hash | ➖ tidak berlaku | Tabel `refresh_tokens` **dibuang** migrasi 007 (isu #47). Lihat temuan T-5 untuk `sessions.token` |
| 5 | Deteksi token reuse | ➖ tidak berlaku | Sama seperti #4 |
| 6 | Rate limit 120/menit, `/auth/*` 10/menit | ❌ → **diperbaiki** | Temuan **T-1** |
| 7 | Webhook verifikasi signature sebelum memproses apa pun | ✅ | `payment-webhook.service.ts` — tidak ada satu pun pembacaan order sebelum gerbangnya; `scan-webhook.controller.ts` sama. Diuji, dan dibuktikan merah dengan mencabut penjaganya (`P-03`) |
| 8 | Upload divalidasi tipe **dan** magic bytes | ✅ | `document-upload.service.ts:152` membaca `%PDF-` dan `PK\x03\x04`+`word/document.xml` dari byte berkas. `UploadedDocument` bahkan tidak punya field `mimetype` — Content-Type klien secara struktural tidak bisa masuk. 6 payload jahat diuji, assert `put` tidak pernah dipanggil |
| 9 | Upload di luar webroot, hanya lewat signed URL | ✅ | `storage.service.ts:82`, TTL 15 menit konstanta. Satu-satunya pemanggil produksi menandatangani **setelah** `where('user_id','=',userId)`. Test mengambil URL telanjang ke bucket dan assert ≥ 400 |
| 10 | Tidak ada bucket publik | ✅ | `infra/docker-compose.yml:82` hanya `mc mb`; nol `mc anonymous set` / `public-read` / ACL di seluruh repo. Bucket bernama `strive-public` **privat** — namanya menyesatkan, lihat T-6 |
| 11 | Parameter binding, tidak ada string concat | ✅ | Nol `sql.raw` di seluruh `apps/api/src`. Semua query lewat Kysely |
| 12 | Header CSP, X-Content-Type-Options, Referrer-Policy, Permissions-Policy | ❌ → **diperbaiki** | Temuan **T-2** |
| 13 | CORS whitelist eksplisit, bukan `*` | ❌ → **diperbaiki** | Temuan **T-3** |
| 14 | Secret tidak masuk log, error, atau respons | ⚠️ → **diperbaiki** | Temuan **T-4**. Selebihnya bersih: nol `console.*`, nol dump env/header/body, `audit_log.before/after` hanya skalar, `.env` tidak pernah ter-commit |
| 15 | Dependency audit nol kerentanan tinggi | ⚠️ ditriase + digerbangi | Temuan **T-7** |
| 16 | Kepemilikan dicek di service, bukan hanya guard | ✅ | 12 service menyaring `where('user_id','=',…)`; `SquadReadService.canRead` dipakai REST **dan** WS dari satu sumber (`RT-01`). `ACCESS_MATRIX` diuji untuk tiap peran salah di tiap rute |
| 17 | Reviewer tidak bisa melihat identitas penulis | ✅ | Bentuk data `GET /reviews/*` tidak memuat identitas; diuji di `review.integration.spec.ts` |
| 18 | OWASP ASVS L1 | ⏸ sebagian | Lihat catatan di bawah |
| 19 | `pnpm audit` / `pip-audit` dijalankan | ✅ sekarang di CI | `scripts/audit-deps.mjs`, langkah CI `Audit dependensi` |

**Soal ASVS L1 (#18).** Tidak jujur menyebutnya "tuntas" saat tiga baris di atas
menunggu deployment yang belum ada, dan ASVS L1 memuat kontrol tingkat transport dan
konfigurasi yang hanya bisa diverifikasi di lingkungan berjalan. Yang bisa dikatakan:
seluruh kontrol ASVS L1 yang berada **di dalam kode** sudah diperiksa dan ditutup.
Sisanya wajib diperiksa ulang setelah `F-05`.

---

## Temuan

### T-1 · Rate limit tidak ada sama sekali — DIPERBAIKI

PRD menjanjikannya di tiga tempat (§7 "Rate limit global per pengguna 120 req/menit",
§10.1 "Header `X-RateLimit-Remaining`", §16.1 "lebih ketat untuk `/auth/*` 10/menit"),
dan §9.4 bahkan mendaftarkan kunci Redis `rl:{user_id}:{route}`.

**Yang benar-benar ada:** nol. Tidak ada `@nestjs/throttler`, tidak ada middleware atau
guard, tidak ada `express-rate-limit`, tidak ada konfigurasi edge (repo tidak punya
nginx/Caddy/ingress sama sekali). Kunci `rl:` **tidak pernah ditulis maupun dibaca**
oleh kode mana pun.

Yang mudah dikira ada, dan bukan: Better-Auth punya limiter bawaan, tapi

- **mati** kecuali `NODE_ENV=production`;
- **100 request / 10 detik = 600 per menit**, lima kali lebih longgar dari janjinya;
- storage **`memory`** — counter `Map` di dalam proses, jadi dua instance berarti dua
  kali limitnya dan setiap deploy meresetnya;
- hanya menutup rute Better-Auth. Seluruh endpoint bisnis terbuka penuh.

**Perbaikan:** `RateLimitInterceptor` global, Redis, jendela 60 detik, 120/menit umum
dan 10/menit untuk `/auth/*`, header `X-RateLimit-Limit`/`X-RateLimit-Remaining`/
`Retry-After`, dan `RATE_LIMITED` 429 dalam bentuk §10.1. Tiga keputusan yang pantas
dibaca alasannya ada di komentar kelasnya: kenapa **interceptor** (guard global jalan
sebelum `SessionGuard`, jadi belum tahu penggunanya; middleware yang resolve sesi
sendiri akan menambah satu query Postgres per request — penguat serangan, bukan
pembatas), kenapa **membiarkan lewat** saat Redis mati (aturan keras 7), dan kenapa
`EXPIRE` hanya saat counter lahir.

Diuji dengan 121 request sungguhan lewat HTTP ke `AppModule` asli. Dibuktikan merah
dengan mencabut `APP_INTERCEPTOR`: 7 test gagal.

### T-2 · Nol dari empat header keamanan — DIPERBAIKI

API dan web sama-sama menyetel **nol**. `helmet` tidak terpasang, `next.config.mjs`
tidak punya `headers()`, tidak ada `middleware.ts` di `apps/web`.

**Perbaikan:** `headerKeamanan()` sebagai middleware Express (bukan interceptor, supaya
404 dan galat ikut membawanya). CSP-nya `default-src 'none'; frame-ancestors 'none'` —
lebih keras daripada bawaan `helmet`, karena API ini tidak pernah mengirim HTML. HSTS
hanya saat `x-forwarded-proto: https`; mengirimnya dari `http://localhost` akan
mengunci localhost ke https di browser siapa pun yang membukanya, dan itu tidak bisa
dibatalkan dari sisi server.

Di web: tiga header + `X-Frame-Options`. **CSP sengaja tidak** — CSP yang benar untuk
App Router butuh nonce per-request yang disuntik dari middleware, dan itu `apps/web`
milik Dev B. Diangkat sebagai isu.

### T-3 · `APP_URL` kosong diam-diam menjadi `Access-Control-Allow-Origin: *` — DIPERBAIKI

`process.env['APP_URL'] ?? 'http://localhost:3000'` disalin di **tiga** tempat
(`main.ts`, `squad.gateway.ts`, `auth-http.provider.ts`). `??` hanya menangkap
`undefined`/`null`, **bukan string kosong** — dan paket `cors` memperlakukan origin
falsy sebagai `*`.

Yang membuatnya nyata, bukan teoretis: **template env produksi di PRD §17 mengirim
`APP_URL=` kosong** dengan contohnya di komentar. Siapa pun yang menyalinnya untuk
deploy mendapat `*` di REST **dan** WebSocket sekaligus, tanpa satu galat pun.

**Perbaikan:** `appOrigins()` sebagai satu sumber untuk ketiganya. Kosong diperlakukan
sebagai tidak disetel → jatuh ke origin dev, yang di produksi berarti frontend ditolak
CORS: keras, terlihat, diperbaiki dalam lima menit. Kebalikannya tidak terlihat sama
sekali. Sekalian mendukung daftar dipisah koma — §16.1 meminta "whitelist", dan satu
string tidak bisa memuat apex + `www`.

### T-4 · `signature_key` Midtrans tersimpan dan terekspos ke Retool — DIPERBAIKI

`payments.raw_payload` menyimpan notifikasi utuh, dan migrasi 006 mengeksposnya lewat
view `admin_transactions` ke role `strive_readonly`. `order_id`, `amount_idr`, dan
digest-nya berakhir di satu baris yang sama — tiga dari empat bahan
`SHA512(… + server_key)` berdampingan dengan hasilnya.

**Severity sedang, bukan tinggi**, dan itu penting untuk tidak melebih-lebihkan: kunci
server Midtrans acak ~40 karakter tidak bisa dipulihkan dari satu digest, dan replay
webhook sudah mati oleh idempotensi `PA-7`. Tapi tidak ada seorang pun yang pernah
membutuhkan tanda tangan di tabel itu, dan §16.1 menuliskannya tanpa syarat.

**Perbaikan:** bidangnya diganti `'[dibuang — R-03]'` sebelum disimpan — diganti, bukan
dihapus, supaya jejaknya tetap menunjukkan webhook itu memang bertanda tangan.

### T-5 · `sessions.token` disimpan plaintext — DIANGKAT, bukan diperbaiki

Migrasi 004 menyimpan `sessions.token` apa adanya; skema lama `001_init.sql:92` justru
punya `token_hash`. Siapa pun yang bisa membaca tabel `sessions` bisa memakai token
itu sebagai sesi.

Tidak diperbaiki di sini karena **kolomnya milik Better-Auth**: ia yang menulis dan
membaca, dan meng-hash-nya berarti menimpa adapter internalnya. Itu keputusan
arsitektur, bukan perbaikan audit. Isu terpisah.

### T-6 · Bucket bernama `strive-public` yang sebenarnya privat — DIANGKAT

Perilakunya benar (privat, terverifikasi). Namanya yang salah, dan nama adalah
dokumentasi yang paling sering dibaca. Risiko operasional: orang berikutnya menaruh
sesuatu di sana karena mengira ia memang publik, atau membukanya "supaya sesuai
namanya".

### T-7 · 16 advisory tinggi/kritis — DITRIASE dan DIGERBANGI

`pnpm audit` melaporkan 37 kerentanan (1 kritis, 15 tinggi). Triase per paket:

| Paket | Jalur | Bisa dicapai? |
|---|---|---|
| `kysely` (3) | runtime | **Tidak.** Ketiganya menyentuh JSON path dan escaping MySQL. Repo ini PostgreSQL, dan penyisiran menemukan nol pemakaian JSON path |
| `multer` (6) | runtime | **Tidak.** Nol `FileInterceptor`/`UploadedFile`/rute multipart di seluruh API — jalur upload memakai buffer langsung |
| `vitest` `vite` `postcss` `glob` `picomatch` `tmp` (7) | dev/build | Tidak ikut ke jalur produksi |

`pip-audit`: `starlette 0.41.3` dengan beberapa advisory. Belum ditriase — `services/ai`
masih kerangka (`AI-01` todo), tapi tetap wajib naik sebelum ia menerima request.

**Yang dikerjakan:** `scripts/audit-deps.mjs` + `security/pengecualian.json`. Setiap
advisory yang dibiarkan wajib punya alasan tertulis dan tanggal tinjau ulang; advisory
**baru** dan pengecualian **kedaluwarsa** sama-sama memerahkan CI. Dua pengecualian
runtime (`kysely`, `multer`) diberi tinjau ulang **21 Oktober 2026** — jauh lebih pendek
dari yang dev/build, dan `multer` wajib ditinjau sebelum rute upload HTTP pertama
dibuat, karena saat itu jalurnya berubah dari "tidak bisa dicapai" menjadi bisa.

Menjadikan `pnpm audit --audit-level high` blocking apa adanya akan memerahkan CI sejak
menit pertama; membiarkannya non-blocking berarti tidak ada yang membacanya. Keduanya
berakhir di nol perlindungan.

---

## Yang diuji, dan dibuktikan merah

Lima penjaga baru disabotase satu per satu:

| Penjaga dicabut | Yang memerah |
|---|---|
| `app.use(headerKeamanan())` | 3 test header |
| `APP_INTERCEPTOR` rate limit | 7 test rate limit |
| `appOrigins()` → bentuk `??` lama | 3 test origin |
| `EXPIRE` di setiap request (bukan saat lahir) | 1 test TTL |
| Redaksi `signature_key` | 1 test AC-PA-1 |

## Isu yang lahir dari audit ini

| Isu | Isi |
|---|---|
| #123 | Retensi 90 hari dokumen sensitif — **tidak ada sama sekali**, `StorageService` bahkan belum punya metode delete |
| #124 | `sessions.token` plaintext (T-5) |
| #125 | CSP untuk `apps/web` — butuh nonce App Router, milik Dev B |
| #126 | Bentuk kunci `rl:` di §9.4 (per rute) bertentangan dengan §7/§10.1 (global per pengguna) |
| #127 | Bucket `strive-public` yang privat (T-6) |
| #128 | `pricing-config.service.spec.ts` **tidak pernah jalan di CI** — test jalur uang yang hijau tanpa menguji apa pun. Ditemukan bukan dari checklist, tapi dari menelusuri kegagalan test yang ternyata sebabnya lain |
