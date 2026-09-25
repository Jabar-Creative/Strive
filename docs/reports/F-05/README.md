# F-05 — Deploy staging otomatis dari `main`

- Tanggal laporan: 2026-09-25
- Cakupan PR ini: workflow GitHub Actions, cookie lintas situs, runbook rollback, dokumen
- Yang **tidak** dilakukan: deploy ke Railway atau Vercel, migrasi ke database staging, seed, membuka isu

Infrastruktur (project Railway, service, variabel, bucket R2, secret GitHub, project Vercel) sudah disiapkan sebelumnya. PR ini tidak mengubahnya. Tidak ada rahasia di berkas ini.

## Deploy pertama — gagal, tidak ada yang melayani

Run: https://github.com/Jabar-Creative/Strive/actions/runs/36114955174

CI lulus. Migrasi 001–008 diterapkan. Pemeriksaan skema hanya-baca lulus (32 tabel domain, trigger `coin_ledger_no_mutate`, FK `peer_reviews_attempt_fk`). Lalu `railway up --ci` membangun image `api`, tetapi container berulang crash dan tidak pernah lulus `/health`:

```
Error: Cannot find module 'reflect-metadata'
Require stack:
- /app/dist/main.js
```

Penyebab: `infra/Dockerfile.api` menyalin `node_modules` aplikasi ke `/app/apps/api/node_modules` dan hasil build ke `/app/dist`. Node yang menjalankan `/app/dist/main.js` tidak melihat folder itu — pnpm menaruh `reflect-metadata` sebagai symlink di `apps/api/node_modules`, bukan di `node_modules` root. Karena `set -euo pipefail`, worker dan ai tidak terunggah. Web dan smoke tidak jalan. Tidak ada proses yang melayani di staging.

Perbaikan layout image, pemeriksaan boot di CI, dan pesan gagal per service: https://github.com/Jabar-Creative/Strive/pull/150. V1–V13 tetap **TIDAK TERBUKTI**. Run itu tidak menghasilkan jawaban HTTP yang bisa dicatat sebagai bukti hidup.

## Deploy kedua — smoke lulus, checklist V1–V13 tidak diangkat

Run: https://github.com/Jabar-Creative/Strive/actions/runs/36118019993

Migrasi sudah mutakhir. Unggahan Railway api, worker, dan ai sukses. Web Vercel READY. Smoke workflow lulus. Itu bukan pelaksanaan daftar V1–V13 di bawah: baris-baris itu tetap **TIDAK TERBUKTI**.

## IP klien Better Auth — satu ember bersama

Setelah probe hanya-baca ke `/api/v1/auth/*`, log api menulis peringatan Better Auth: rate limit tidak bisa menentukan IP klien dan jatuh ke satu ember per path. Semua pengguna berbagi batas masuk. Better Auth 1.7.5 hanya mempercayai `X-Forwarded-For` bernilai tunggal kalau `trustedProxies` kosong; rantai (lebih dari satu entri) ditolak. `trustedProxies` mencocokkan CIDR proxy, bukan jumlah hop, dan IP edge Railway tidak disimpan di repo.

Perbaikannya (https://github.com/Jabar-Creative/Strive/pull/152) memakai `TRUST_PROXY_HOPS` yang sudah ada: dihitung dari kanan, entri kiri yang dikirim klien dibuang, lalu header ditimpa menjadi satu IP sebelum Better Auth membacanya. Arti variabel tidak berubah. Asumsi staging: peramban → satu edge Railway → container, jadi `1` berarti entri paling kanan adalah alamat yang ditulis edge itu. Container yang bisa dihubungi dengan melewati proxy itu akan mempercayai header klien — sama seperti pembatas Nest.

Mengukur hop, setelah deploy perbaikan ini, tanpa rute baru. `LOG_FORMAT=json` sudah menyala di service api. Satu permintaan (cukup `GET /health`, supaya tidak menghabiskan jatah 10/menit `/auth/*`) menulis baris `"msg":"http"` dengan `client_ip`, `xff_count`, dan `trust_proxy_hops`. Rute auth menambah baris `pengukuran proxy` dengan tiga nilai yang sama. Rantai header tidak dicetak.

Bandingkan `client_ip` dengan alamat publik mesin yang mengirim permintaan.

- Sama, dan `xff_count` 1 → hop 1 cocok dengan satu edge yang menaruh alamat klien di satu-satunya entri.
- `client_ip` alamat privat (10/8, 172.16/12, 100.64/10) sementara `xff_count` lebih dari 1 → hop terlalu kecil: entri kanan adalah proxy, bukan peramban. Naikkan `TRUST_PROXY_HOPS` sampai `client_ip` sama dengan alamat pengirim.
- `trust_proxy_hops` 0 → header diabaikan dan `client_ip` adalah soket (proxy Railway). Semua orang berbagi ember. Bukan angka yang dipakai di staging kalau edge-nya satu.

## LINK HIDUP

Smoke run 36118019993 lulus. Checklist V1–V13 di bawah tidak diubah menjadi terbukti oleh smoke itu.

| Layanan | URL yang sudah disiapkan | Bukti hidup dari kode repo ini |
|---|---|---|
| web | https://strive-staging-web.vercel.app | Smoke run 36118019993 melaporkan HTTP 200. V3 tetap TIDAK TERBUKTI di checklist ini |
| api | https://api-staging-af8c.up.railway.app | Smoke run yang sama melaporkan `/health`. V1 tetap TIDAK TERBUKTI di checklist ini |
| ai | https://ai-staging-330d.up.railway.app | Smoke run yang sama melaporkan service `ai`. V2 tetap TIDAK TERBUKTI di checklist ini |
| worker | tidak punya domain | Unggahan Railway run itu sukses. Tidak ada pemeriksaan log `MODE=worker` di checklist ini |
| dashboard Railway | https://railway.com/project/773fa4e1-589a-4afb-a559-80cfe632f1a5 | service menerima kode pada run 36118019993 |

## SELESAI

Acceptance criteria di backlog, harfiah: "URL staging hidup. Push ke `main` men-deploy ketiganya. Rollback ke commit sebelumnya bisa dilakukan dalam <5 menit."

| AC | Hasil |
|---|---|
| URL staging hidup | **TERBUKTI** — V1, V2, V3 dijalankan langsung 25 Sep 17.15 WIB, bukan lewat smoke |
| Push ke `main` men-deploy | **TERBUKTI** — merge #152, #153, #156 masing-masing memicu run `Deploy staging`. Dengan satu catatan yang bukan sepele: satu run tertahan >50 menit dan run berikutnya mengantre di belakangnya |
| Rollback < 5 menit | **TIDAK TERBUKTI.** Prosedurnya di `docs/runbooks/rollback-staging.md`. Butuh dashboard/CLI Railway — tetap milik manusia |

**`F-05` belum `done`.** Tiga baris di bawah yang menahannya, dan tidak satu pun bisa ditutup dari terminal ini: V7 menunggu #152 ter-deploy, V11 menunggu staging punya konten, V13 menunggu akses Railway.

### V1–V13 — dijalankan 25 September 2026, 17.15–17.35 WIB

Terhadap deployment yang sedang melayani (`c8dd108`). Perintah dan keluarannya di bagian **Bukti** di bawah.

| | Pemeriksaan | Hasil |
|---|---|---|
| V1 | `GET` API `/health` → 200 | **LULUS** — 200 dalam 142 ms, `{"status":"ok","service":"api","mode":"api"}` |
| V2 | `GET` AI `/health` → 200, service `ai` | **LULUS** — 200, `"service":"ai"` |
| V3 | `GET` web `/` → 200 HTML | **LULUS** — 200, halaman ter-render |
| V4 | CORS origin asing bukan `*` | **LULUS** — origin asing tidak mendapat header `Access-Control-Allow-Origin` sama sekali; origin web sah mendapat dirinya sendiri persis |
| V5 | Header keamanan API dan web | **LULUS** — keempatnya ada di kedua sisi, plus HSTS. `Referrer-Policy` berbeda antar sisi (`no-referrer` di API, `strict-origin-when-cross-origin` di web) dan itu memang disengaja |
| V6 | 401 bentuk §10.1, termasuk 404 | **LULUS** — rute tak dikenal → `{"error":{"code":"NOT_FOUND",…}}` 404; rute terlindung → `{"error":{"code":"UNAUTHENTICATED",…}}` 401. Keduanya `error` sebagai OBJEK ber-`code`, bukan string bawaan Nest |
| V7 | Rate limit 429, termasuk `X-Forwarded-For` acak | **SENGAJA TIDAK DIJALANKAN.** Perbaikan #152 belum ter-deploy (run deploy-nya macet, lihat bawah), jadi ember rate limit masih satu untuk semua. Menembak `/auth/*` sekarang berarti **mengunci login semua orang** — biaya yang tidak sebanding dengan satu baris checklist. Dijalankan setelah #152 hidup |
| V8 | AI tanpa token → 401 | **TIDAK BERLAKU, bukan gagal.** Satu-satunya endpoint adalah `/health`, dan probe kesiapan memang tidak boleh butuh token. Yang sebenarnya perlu diperiksa saat router `AI-01` mendarat: apakah `AI_SERVICE_TOKEN` ditegakkan. Sekarang belum ada yang menegakkannya (#132, #162) |
| V9 | Webhook pembayaran tanda tangan asal ditolak | **LULUS, TAPI HAMPA.** 401 `INVALID_SIGNATURE` untuk tanda tangan asal maupun `order_id` bukan-UUID. Dengan `MIDTRANS_SERVER_KEY` kosong, **semua** ditolak — jadi ini membuktikan gagal-tertutup, bukan bahwa perhitungan tanda tangannya benar. Yang membuktikan itu test integrasi `P-03` |
| V10 | Daftar, masuk, refresh, masih masuk | **LULUS di Chrome.** Registrasi lewat halaman web sungguhan → mendarat di `/hub` dengan sesi aktif → muat ulang penuh → **masih masuk**. Cookie `__Secure-better-auth.session_token; HttpOnly; Secure; SameSite=None` — keputusan opsi A (#149) bekerja. **Safari/iOS belum diuji** dan tetap risiko ITP |
| V11 | Satu lesson, koin, ledger, rekonsiliasi nol baris | **TERBLOKIR.** `GET /hub` dengan sesi sah mengembalikan `"next_cards":[]` dan `"balance":0` — **staging tidak punya konten sama sekali**, karena workflow tidak menjalankan `pnpm seed`. Tidak ada lesson untuk dikerjakan, jadi tidak ada jalur uang untuk diuji |
| V12 | WebSocket subscribe | **LULUS.** WSS ke `/api/v1/ws` dengan `transports: ['websocket']` saja (bukan polling): tersambung, handshake menolak sesi palsu dengan pesan yang benar, lalu dengan sesi sah `subscribe` **dijawab** `FORBIDDEN_ROLE` — artinya `canRead` benar-benar meng-query Postgres dan handler membalas, bukan menggantung (jebakan yang ditutup #144) |
| V13 | Rollback diukur | **TIDAK TERBUKTI.** Butuh akses dashboard/CLI Railway; CLI tidak terpasang di mesin yang menjalankan verifikasi ini. Tetap milik manusia |

### Dua hal yang ditemukan JUSTRU karena V dijalankan

Keduanya tidak ada di checklist mana pun, dan keduanya lebih penting daripada beberapa baris di atasnya.

**1. `/admin` memulangkan pengguna yang SUDAH masuk — AC `A-04` tidak berlaku di staging.**

Dengan sesi sah di browser, `fetch('/admin', { redirect: 'manual' })` menjawab `opaqueredirect`, bukan halaman 403. AC `A-04` berbunyi *"student → /mentor & /admin → 403 + halaman jelas"*. Yang terjadi: redirect ke `/login`, lalu `/login` memantulkannya kembali ke `/hub` karena sesinya aktif — **pengguna tidak pernah diberi tahu apa pun**.

Sebabnya bukan di `putusAksesConsole`, yang benar. Sebabnya `SessionGuard` hanya menerima `Authorization: Bearer` sementara middleware mengirim cookie, jadi `/me` selalu 401 dan cabang yang dipilih selalu `'login'`. Token yang SAMA, dua cara:

```
Authorization: Bearer …  → HTTP 200  {"id":"…","role":"student",…}
Cookie: __Secure-…       → HTTP 401  {"error":{"code":"UNAUTHENTICATED",…}}
```

Isu #154. Backend-nya sehat — `GET /hub` dengan Bearer mengembalikan isi lengkap.

**2. Sign-out lewat Bearer adalah 200 yang tidak melakukan apa pun.**

```
POST /auth/sign-out  -H "Authorization: Bearer $T"      → 200,  lalu GET /me → 200  (masih hidup)
POST /auth/sign-out  -H "Cookie: <cookie bertanda tangan>" → 200,  lalu GET /me → 401  (tercabut)
```

Better-Auth mengenali sesi yang dicabut **hanya dari cookie**. Karena seluruh rute bisnis kita memakai Bearer, klien Bearer tidak punya logout yang bekerja — ia menekan "keluar", layar berubah, dan sesinya hidup 30 hari lagi. Ini konsekuensi langsung dari keputusan #154 dan menggeser timbangannya.

### Deploy yang macet, dan kenapa itu ikut dicatat

Run [36120839225](https://github.com/Jabar-Creative/Strive/actions/runs/36120839225) (`03b860b`, isinya **hanya `CLAUDE.md`**) tertahan di langkah `Deploy api, worker, lalu ai` lebih dari 50 menit. `timeout-minutes: 90` dan `cancel-in-progress: false`, jadi run berikutnya (`26f0aa0`, perbaikan rate limit #152) **mengantre di belakangnya** dan V7 ikut tertahan.

Dua hal yang terlihat dari sini: merge dokumen-saja memicu deploy penuh (#160 — dan kredit trial punya tenggat), dan satu `railway up` yang menggantung memblokir pipeline sampai satu setengah jam tanpa ada yang memberi tahu.

### Bukti

```
$ curl -s -o /dev/null -w "%{http_code} %{time_total}s" .../health          # V1
200 0.142483s
$ curl -s .../health                                                         # V1, V2
{"status":"ok","service":"api","mode":"api","timestamp":"2026-09-25T09:49:37.471Z"}
{"status":"ok","service":"ai","mode":"api","timestamp":"2026-09-25T09:49:37.729976Z"}

$ curl -s -i -H "Origin: https://evil.example" .../health | grep -i access-control   # V4
(tidak ada satu pun header)
$ curl -s -i -H "Origin: https://strive-staging-web.vercel.app" .../health | grep -i access-control
access-control-allow-origin: https://strive-staging-web.vercel.app

$ curl -s -i .../health | grep -iE "^x-|^referrer|^permissions|^strict"      # V5 (API)
permissions-policy: camera=(), microphone=(), geolocation=(), payment=()
referrer-policy: no-referrer
strict-transport-security: max-age=31536000; includeSubDomains
x-content-type-options: nosniff
x-frame-options: DENY

$ curl -s .../api/v1/tidak-ada-rute-ini                                      # V6
{"error":{"code":"NOT_FOUND","message":"Cannot GET /api/v1/tidak-ada-rute-ini","details":{}}}

$ curl -s -X POST .../api/v1/webhooks/payment -d '{…,"signature_key":"palsu",…}'   # V9
{"error":{"code":"INVALID_SIGNATURE","message":"Tanda tangan webhook tidak sah","details":{}}}

$ curl -s .../api/v1/hub -H "Authorization: Bearer $T"                       # V11
{"streak":{…},"quest":{…},"squad":null,"balance":0,"next_cards":[]}

# V12 — socket.io-client, transports: ['websocket'] saja
WSS tersambung, id = VK6PO_QouJHM_3TrAAAC
balasan subscribe: {"ok":false,"error":{"code":"FORBIDDEN_ROLE","message":"Kanal squad hanya untuk anggotanya sendiri",…}}
```

Akun uji yang dipakai didaftarkan lewat API dan halaman web sungguhan, bukan lewat SQL. Sesi yang tokennya sempat terlihat di log kerja sudah di-sign-out, dan matinya diverifikasi (401).

**Staging tidak membuktikan trigger menolak perubahan.** Workflow hanya membaca: 32 tabel domain, trigger `coin_ledger_no_mutate` ada, FK `peer_reviews_attempt_fk` ada. Penolakan `UPDATE`/`DELETE` pada baris sungguhan tetap di job CI `migrasi kering`, terhadap database sekali pakai. Menyalin blok itu ke staging akan menyisipkan `coin_ledger` yang tidak bisa dihapus.

## YANG MASIH MATI, DAN KENAPA

| Yang mati | Jenis | Kenapa |
|---|---|---|
| Top-up | vendor | `MIDTRANS_*` kosong (isu #57). Bukan feature flag — tidak ada `FEATURE_*` yang dibaca API atau web |
| Scan plagiarisme | vendor | `COPYLEAKS_*` kosong (isu #90). Provider gagal tertutup |
| Reset password dan `email_verified` | vendor, sengaja dilewati | Tidak ada Resend. Registrasi tetap jalan; email gagal dicatat di log, berisi alamat tujuan. Top-up tetap terblokir AU-8 |
| Panggilan LLM | vendor, sengaja dilewati | Layanan AI masih kerangka (`AI-01` todo). Kunci LLM tidak dipasang |
| Panel superadmin Retool | belum dibangun di staging | Isu #77. Query ada di `docs/retool/` |
| Papan, rollover liga, rekonsiliasi, partisi, reaper, peringatan streak | tidak ada penjadwal | Isu #131. Jangan menambah cron atau rute pemicu dari PR ini |
| `/mentor` dan `/admin` setelah login lintas situs | batas opsi A | Middleware web meneruskan cookie domain web. Sesi dipasang di domain API. Redirect ke `/login` tetap, walau `SameSite=None` |
| Login Safari/iOS | batas cookie pihak ketiga | `vercel.app` dan `up.railway.app` dua situs. ITP kemungkinan memblokir cookie itu |
| Layar dompet, squad, store, klinik, karir, mastery | belum dibangun | Masih `PageStub`. Data semai tidak akan membuatnya berisi |
| V8 token AI | belum dibangun | Isu #132. `/health` tidak memeriksa token |

## KUPUTUSKAN SENDIRI

- Status papan `review`, bukan `done`. AC belum terbukti. `CLAUDE.md` tidak diubah: pengumuman "staging siap" milik Dev A.
- Web di Vercel, bukan Railway. Menimpa kalimat master prompt "semuanya di satu project". Alasan: batas trial Railway lima service, dan pembayaran Railway tidak tersedia.
- Cookie opsi A lewat `AUTH_COOKIE_CROSS_SITE`, hanya string `true`. `partitioned` tidak dipasang — itu percobaan tambahan, bukan keputusan yang sudah diambil, dan Safari belum tentu menghormatinya.
- Pemeriksaan skema staging hanya baca. Blok CI yang menulis tidak disalin, dan tidak dibungkus transaksi yang di-rollback: satu `COMMIT` yang terlewat menulis `coin_ledger` permanen.
- Workflow tidak menjalankan `pnpm seed`. LANGKAH 7 master prompt meminta data semai; daftar yang diminta untuk PR ini tidak, dan menyemai database permanen dari job yang belum pernah diuji adalah cara mengisi staging dengan baris yang sulit dibersihkan. Layarnya tetap stub (V-2 di laporan fase 2b).
- Tidak ada `railway.json` tetap di root. Tiga service butuh dua Dockerfile. Workflow menyalin `infra/railway/<service>.json` hanya saat unggahan service itu.
- Berkas Railway itu hanya bagian `build`. Tidak ada variabel dan tidak ada healthcheck, supaya dashboard tidak tertimpa dan worker tidak dapat healthcheck HTTP.
- CLI dipaku `@railway/cli@5.62.1` dan `vercel@60.0.1` — versi yang dipakai saat service dan project Vercel disiapkan.
- Token Vercel tidak ditaruh di argv. `.vercel/` dihapus di akhir job dan masuk `.gitignore`.
- `workflow_dispatch` tidak menunggu CI ulang. Commit di `main` sudah melewati status check wajib; force-push ke `main` dilarang. Celahnya: dispatch men-deploy ujung `main` saat ini, bukan sebuah SHA yang baru saja diuji ulang.
- Smoke mengulang sampai 30 kali 10 detik karena `railway up --ci` kembali saat build selesai, bukan saat proses baru menjawab.
- `sslmode=require` pada secret dibiarkan apa adanya. `pg` 8.23 memperlakukannya sebagai verifikasi sertifikat penuh (ada peringatan deprekasi), lebih ketat daripada `psql`. Tidak dilemahkan dari repo ini. Kalau migrasi pertama gagal karena sertifikat, itu temuan operasi, bukan alasan menulis `rejectUnauthorized: false` diam-diam.
- Entri usang `ACCESS_TOKEN_TTL` / `REFRESH_TOKEN_TTL` di §19.2 dihapus, dan `S3_REGION` serta `NEXT_PUBLIC_API_URL` ditambahkan, karena keduanya sudah benar di `.env.example` sejak A-03 / K-01 dan tidak mengubah perilaku. `LOG_FORMAT` tidak ditambahkan — lihat temuan.

## MASALAH YANG KUTEMUKAN

Tidak diperbaiki di PR ini. Jangan dibuka sebagai isu dari PR ini; pemiliknya yang membuka.

1. ~~**AC "men-deploy ketiganya"** padahal prosesnya empat.~~ **Diperiksa ulang, temuannya tidak berdiri:** PRD §8.1 berjudul *"Tiga deployable"* dan worker adalah image yang SAMA dengan api, `MODE` berbeda. Kalimat AC diperjelas di #156 supaya worker tidak terlewat saat verifikasi; angkanya tidak diubah.
2. **`FEATURE_*` tidak dibaca** API maupun web. Satu-satunya jejak di web adalah komentar. `FEATURE_MASTERY_ENABLED` dideklarasikan di config Python dan tidak dipakai. Empat kill switch §19.3 adalah tombol yang terlihat menyala. Scan dan top-up mati karena kredensial kosong, bukan karena flag.
3. **Logger API membaca `LOG_FORMAT`, bukan `LOG_LEVEL`.** `LOG_LEVEL` ada di §19.2 dan `.env.example`. `LOG_FORMAT` tidak ada di keduanya. Tanpa `LOG_FORMAT=json` (sudah disetel di service Railway, di luar repo) log API bukan JSON.
4. **Tiga bucket, kode membaca satu.** Tidak ada `S3_BUCKET_PUBLIC`. API memakai `S3_BUCKET_DOCUMENTS`. `S3_BUCKET_ASSETS` disetel di Railway dan tidak dibaca API. CI membuat dua bucket. Nama `strive-public` menyesatkan (isu #127); bucket itu tetap privat.
5. ~~**`API_URL` memakai `??`.**~~ **DITUTUP #156.** `envTeks()` di `common/env.ts` menutup kelasnya, bukan kasusnya. Dibuktikan merah: kembalikan ke `??` → 2 test gagal.
6. **`/health` API tidak menyentuh Postgres atau Redis.** Healthcheck hijau tidak berarti keduanya terjangkau. Worker tidak punya health HTTP sama sekali.
7. ~~**`createS3FromEnv()` jatuh ke kredensial dev.**~~ **DITUTUP #156.** Di produksi ia melempar saat boot, pola yang sama dengan `AUTH_SECRET`. Di luar produksi bawaan tetap berlaku, karena CLAUDE.md menjanjikan stack jalan tanpa `.env`. Job CI `image runtime` ikut disesuaikan — ia mem-boot dengan `NODE_ENV=production` dan sudah memasok `AUTH_SECRET` dengan alasan yang persis sama.
8. **Tanpa Resend, setiap registrasi menulis log `error` yang memuat alamat email** (`kirimAman` di `auth.config.ts`).
9. **`ARG NEXT_PUBLIC_API_URL` ditambahkan di #156.** Bagian `HOSTNAME` dari temuan ini **tidak berdiri**: template standalone Next 15.5.25 sudah `process.env.HOSTNAME || '0.0.0.0'` (`node_modules/next/dist/build/utils.js:1316`). Menambahkannya hanya menyalin bawaan ke tempat yang bisa menyimpang.
10. **Layanan AI hanya `/health`.** V8 tidak bisa lulus. `AiDispatchService` akan mem-POST ke jalur yang tidak ada (isu #132).
11. **Klien WebSocket web belum ada** (`createWsClient` melempar). V12 hanya bisa diuji dengan klien mentah ke gateway, bukan dari browser.
12. **Hampir semua layar siswa stub**, dan `createApiClient()` melempar. "Layar tidak kosong" tidak tercapai dengan seed.
13. **`TRUST_PROXY_HOPS=1` belum diukur** dari header yang benar-benar sampai. Better Auth 1.7.5, tanpa `trustedProxies`, menolak rantai `X-Forwarded-For` dan semua pengguna berbagi satu ember per path (peringatan di log api setelah probe `/api/v1/auth/*`). Pembatas Nest sudah menghitung dari kanan; Better Auth tidak. Perbaikan menimpa header menjadi satu IP dengan hop yang sama, dan setiap request JSON mencatat `client_ip`, `xff_count`, `trust_proxy_hops` tanpa mencetak rantai. Angka hop tetap harus dibaca dari log staging setelah deploy — lihat bagian "IP klien Better Auth". Salah satu angka masih membuat batas bisa dilewati (hop terlalu besar, atau origin terbuka di luar proxy) atau membuat semua orang satu ember (hop terlalu kecil).
14. **`REDIS_URL` memuat `?family=0`.** Belum terbukti ioredis di repo ini membaca `family` dari query string sebagai angka.
15. **Postgres publik menerima koneksi tanpa TLS.** Secret migrasi sudah `sslmode=require`. Jangan menyalin URL-nya tanpa parameter itu.
16. **Akun Railway masih trial** tanpa metode bayar: kredit US$5, 30 hari, batas 5 service. Perkiraan setelah api+worker+ai hidup US$6–7/bulan, jadi kredit habis kira-kira hari ke-20–25, lebih cepat dari 30 hari. Tanpa kartu, service berhenti tanpa tagihan.
17. **`railway.json` (config-as-code) berhenti dibaca 2026-12-01.** Setelah itu yang menahan path Dockerfile adalah variabel `RAILWAY_DOCKERFILE_PATH` di service. Infrastructure as Code satu berkas untuk seluruh project belum dipakai, karena menerapkan rencana itu akan menyentuh variabel yang sudah hidup.
18. **`pg` 8.23 memperlakukan `sslmode=require` sebagai verifikasi sertifikat penuh** dan mengeluarkan peringatan. `psql` dengan mode yang sama hanya mengenkripsi. Keduanya tidak sama.
19. **Rujukan dokumen yang masih senjang:** `CLAUDE.md` masih menyebut "tepat 33 tabel" di satu tempat sementara CI dan migrasi 007 memakai 32. Agregator log (§17.2) masih disebut sebagai bagian F-05 di runbook observability; deploy ini tidak memasangnya.
20. **`/health` AI memanggil `get_settings()`.** Kalau env wajibnya tidak lengkap, health bisa gagal boot sebelum menjawab. Service `ai` di Railway tidak diberi `S3_*` / `DATABASE_URL` karena tidak dipakai kode jalur health — tetap perlu diawasi saat deploy pertama.

## BIAYA

| Komponen | Perkiraan |
|---|---|
| Railway trial | Kredit US$5, 30 hari, `state` akun belum berbayar. Postgres + Redis sekarang di bawah US$1/bulan. Setelah api, worker, dan ai hidup: kira-kira **US$6–7/bulan**, jadi kredit habis dalam **kira-kira 20–25 hari**, bukan 30 |
| Vercel Hobby | US$0. Hanya untuk pemakaian **non-komersial**. Wajar untuk staging. Tidak boleh menjadi tempat produksi atau beta berbayar |
| R2 | Tidak ditagih di laporan ini; kuota gratis 10 GB cukup untuk staging kosong |
| Resend, LLM, Midtrans, Copyleaks | Tidak dipasang. Tidak ada tagihan dari sana, dan fiturnya mati |

Yang paling mungkin membengkakkan Railway tanpa disadari: menit RAM saat build image dan saat demo, plus egress proxy publik Postgres kalau ada klien yang menyambung terus. Tidak ada peringatan tagihan selama metode bayar kosong — service langsung berhenti.

## Deploy pertama, setelah PR ini di-merge

1. Merge ke `main` (bukan dari agent ini).
2. Push merge menjalankan workflow `CI`.
3. Kalau CI itu hijau, `workflow_run` menjalankan `Deploy staging` pada SHA yang sama.
4. `workflow_dispatch` (tab Actions → Deploy staging → Run workflow) baru muncul setelah berkasnya ada di `main`. Itu jalur ulang, bukan jalur pertama.
5. PR ini sendiri **tidak** men-deploy: pemicu memfilter branch `main`, dan berkas workflow di branch PR tidak dipakai `workflow_run`.

## Yang dipecah jadi isu

Temuan yang tidak diperbaiki di sini sudah punya pemiliknya sendiri, supaya berhenti hidup sebagai kotak centang di satu utas: #154 (seam Bearer↔cookie), #155 (`/health` statis), #157 (`FEATURE_*`), #158 (`LOG_LEVEL`), #159 (bucket menyimpang), #160 (deploy dari merge dokumen-saja), #161 (Postgres publik tanpa TLS), #162 (uvicorn & token AI), #163 (akses publik R2 — butuh dashboard).
