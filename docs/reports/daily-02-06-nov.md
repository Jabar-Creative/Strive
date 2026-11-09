# Daily Report Strive Dev, Kemal (Senin 2 – Jumat 6 Nov 2026)

> Pekan ini satu arus: AI-07 CV builder dari fondasi tanpa commit jadi PR
> siap review. Pekerjaan dikerjakan bertumpuk dalam beberapa sesi panjang
> lalu ditulis per hari, dengan persetujuan mentor. Dua bug hanya ketahuan
> saat stack e2e dijalankan sungguhan, keduanya diperbaiki dengan test
> penjaga baru supaya kelasnya tidak kambuh.

---

## 📌 DAILY REPORT STRIVE DEV, KEMAL
### Senin, 02/11/2026

**1 · Pekerjaan selesai**

Lingkungan kerja dipindah dari `C:\...\strive-fresh` (drvfs) ke `~/strive`
(ext4 WSL). Alasannya konkret: `lint-staged` hang 2 sampai 3 menit di drvfs
dan venv Python hasil rsync punya shebang rusak. Dua jebakan lain ikut
dibersihkan: hook `.husky/pre-commit` CRLF (Windows-era) yang bikin
`pnpm lint-staged` tidak ditemukan, dan 13 worktree basi hasil rsync yang
membuat `eslint .` merah.

Fondasi AI-07 M1 sampai M4 akhirnya di-commit terpisah di
`ai07-cv-builder` setelah tiga suite verifikasi hijau:

- `f65383c` M1: guard unggah #207 + anggaran dekompresi PDF di layanan AI.
- `65cdd9c` M2: rute `/v1/cv` FastAPI + struktur CV.
- `d9d2cb0` M3: hook finalisasi `PENYELESAI_JOB_AI` + penyapu job
  mengendap (#131).
- `341a1f1` M4: kuota AI gabungan per pengguna (CV + Prompt Lab + Mastery).
- `4e65312` papan: AI-07 ke `in_progress`.

Bukti: prompt-lab 11/11, penjadwal, worker-boot 3/3, typecheck bersih.

**2 · Progres**
AI-07 fondasi aman di git. Tersisa M5 (sisi Node), M6 (UI), M7 (gerbang,
verifikasi browser, PR).

**3 · Isu**
Dibuka: tidak ada. Diperbaiki hari ini: lint-staged hang, hook CRLF,
worktree basi (fondasi, bukan kode fitur).

**4 · Blocker**
K-04 tetap `blocked` menunggu AI-07.

**5 · Rencana esok**
M5: `cv-builder.service` satu transaksi + `cv-finalize.service` + rute
`POST /career/cv` 202 dan `GET /career/cv/jobs/:id`.

---

## 📌 DAILY REPORT STRIVE DEV, KEMAL
### Selasa, 03/11/2026

**1 · Pekerjaan selesai**

`b1f7357` M5: sisi Node CV builder, satu commit utuh:

- `CvBuilderService.buat`: validasi (base64 charset, 8 MB, tipe berkas),
  pricing 503 kalau belum terbit, replay idempotensi hidup, SATU transaksi
  (users FOR UPDATE, kuota, `jobs.buat kind ats_cv`, `coins.hold`,
  konflik kunci 409), enqueue SETELAH commit.
- `CvFinalizeService`: hook kind `ats_cv`; sukses = PDF ke MinIO dulu,
  baru transaksi `cv_documents` + settle (idempoten terhadap pengantaran
  ulang); gagal = release dengan alasan generik (bukan gema vendor).
- `GET /career/cv/jobs/:id` dengan whitelist kode §10.2, kode asing
  dipetakan `INTERNAL_ERROR`, `error_message` tidak pernah sampai klien.
- Baris `ACCESS_MATRIX`, body parser 11 MB (`rawBody` webhook tetap utuh),
  `WorkerModule` mengimpor `CareerModule`.
- Suite integrasi baru 25 test: 202 + hold -40 + enqueue setelah commit,
  rollback tanpa enqueue, replay, konflik kunci paralel, kuota ke-11 429,
  finalisasi sukses/gagal/idempoten, 401/403/404 identik.

**2 · Progres**
Backend fitur lengkap. 25/25 integrasi hijau, worker-boot membuktikan DI
hook terpasang.

**3 · Isu**
TypeScript mengajari tiga hal hari ini: narrowing `never` tidak menembus
closure (helper pindah ke level modul), array jsonb wajib `JSON.stringify`
eksplisit, dan `useBodyParser` hanya ada di `NestApplication` (common
tidak), butuh cast di test.

**4 · Blocker**
Sama dengan Senin.

**5 · Rencana esok**
M6: layar CV builder dua tab di `/career` sesuai wireframe p06.

---

## 📌 DAILY REPORT STRIVE DEV, KEMAL
### Rabu, 04/11/2026

**1 · Pekerjaan selesai**

`a38c290` M6: UI CV builder:

- Mesin layar `lib/cv-builder.ts`: fase layar terpisah dari fase PERCOBAAN
  (idle, menunggu, selesai, gagalJob), polling timeout 5 menit sebagai
  `POLLING_TIMEOUT` (job tetap berjalan di server), pesan galat bercabang
  pada `error.code` bukan `message` (AC-CV-3).
- `components/cv-builder-screen.tsx`: pemilih sumber (unggah atau profil),
  target role dipotong 120 karakter, guard 8 MB sebelum base64 dibangun,
  polling 2,5 detik, skor dan temuan hanya dari server (aturan keras 9),
  Unduh PDF lewat signed URL.
- `app/(student)/career/page.tsx`: dua tab, kedua panel tetap terpasang
  (hanya disembunyikan) supaya polling selamat pindah tab.
- `api-client.ts`: `generateCv` + `cvJobStatus`.

Web 154/154 hijau, typecheck bersih, `next build` sukses.

**2 · Progres**
Fitur tampil utuh. Tersisa M7.

**3 · Isu**
Closure React menangkap `state.jobId` lama di interval polling; dipecahan
dengan menangkap `const jobId = state.jobId` di dalam effect.

**4 · Blocker**
Sama dengan Selasa.

**5 · Rencana esok**
M7: lima gerbang, audit dependensi, verifikasi browser, PR.

---

## 📌 DAILY REPORT STRIVE DEV, KEMAL
### Kamis, 05/11/2026

**1 · Pekerjaan selesai**

Gerbang jalan dan menemukan pekerjaan:

- `58cc98d`: akses indeks `hold[0]` diamankan (`noUncheckedIndexedAccess`).
- `d5a4b35`: audit-deps menemukan DUA advisory runtime baru better-auth
  1.7.5 (GHSA-r4xp-prcw-77qf tinggi, GHSA-965c-763c-88jm kritis, keduanya
  OAuth). Ditambal ke 1.7.7 (patch minimum, api pin eksak, web caret).
  Kysely runtime diverifikasi tetap 0.27.6. Pengecualian braces diperpanjang
  setelah diverifikasi ulang (`pnpm why braces --prod` tetap NOL).
  Hasil akhir: 11 tinggi/kritis, 11 dikecualikan, 0 baru, 0 basi.
- `bbf93cb`: setelan `LLM_BASE_URL` di layanan AI (bawaan tetap OpenAI
  resmi) supaya verifikasi ujung-ke-ujung bisa memakai stub lokal
  chat/completions TANPA kunci vendor. Jalur produksi tidak menyetelnya.

API 355/355, web 154/154, pytest 145/145, lima gerbang hijau dalam satu
rangkaian.

**2 · Progres**
Semua gerbang bersih, fondasi dependensi aman lagi.

**3 · Isu**
Dua advisory better-auth baru ditutup hari yang sama. Catatan: `pnpm test`
tidak memuat spec integrasi (config terpisah); verifikasi penuh perlu
`test:integration` eksplisit, dicatat untuk gerbang esok.

**4 · Blocker**
Sama dengan Rabu.

**5 · Rencana esok**
Verifikasi browser golden path + laporan E2E + PR ke Fatihmaull.

---

## 📌 DAILY REPORT STRIVE DEV, KEMAL
### Jumat, 06/11/2026

**1 · Pekerjaan selesai**

Verifikasi browser sungguhan: DB `strive_e2e` + migrasi + seed (user
`@yopmail.com`, 1000 koin, sesi), stub chat/completions di 59998, uvicorn,
API MODE=api :3002, MODE=worker, web dev :3005, browser lewat Playwright
dengan cookie sesi. Golden path penuh terbukti: form profil, 202, polling,
skor 34/100 dengan lima temuan berlabel severity, Unduh PDF asli (PDF 1.3,
satu halaman), console bersih, nol 4xx/5xx setelah login, aman di 375px
tanpa scroll horizontal.

Dua bug ketahuan JUSTRU karena stack ini jalan sungguhan:

- `3a0c169`: binding `PENYELESAI_JOB_AI` tidak diekspor dari CareerModule,
  jadi `@Optional()` dispatcher menerima array kosong dan seluruh hook
  finalisasi senyap tidak pernah berjalan (job gagal tidak melepas hold,
  saldo 600 menggantung). Sekalian dibetulkan bentuknya: `useExisting`
  mengikat satu instance padahal kontrak dispatcher array. Worker-boot
  diperkuat: kini menuntut EFEK hook (cv_documents, audit coin.settle,
  unggah PDF) plus bentuk array token.
- `654a10f`: kunci idempotensi dipakai ulang setelah hasil tiba, sehingga
  Generate kedua diam-diam replay job lama (network log membuktikannya:
  job_id sama dua kali). Rotasi kunci pindah ke mesin `kunciPercobaanBaru`,
  plus pesan untuk `SOURCE_TOO_SHORT`/`DOCUMENT_TOO_LONG`, plus spec baru
  lib/cv-builder 24 test (M6 kemarin lulus gerbang tanpa satu pun test
  cv-builder, celah yang membuat bug ini lolos ke verifikasi manual).

Bukti akhir: integrasi 56/56 (worker-boot, dispatch, cv-builder), web
177/177, ledger koheren (3 sukses settle, 2 gagal release, saldo 200).

**2 · Progres**
AI-07 tuntas di lima gerbang + verifikasi browser + laporan E2E
`docs/reports/AI-07/`. Papan `docs/BACKLOG.md` dihitung ulang, K-04 tetap
`blocked` dengan bukti (multipart masih NOL pemakaian, jalur upload AI-07
berbasis buffer base64).

**3 · Isu**
Audit agent-security atas diff AI-07 dijalankan; temuannya dicatat di
laporan auto-mode dan deskripsi PR.

**4 · Blocker**
PR ke reviewer Fatihmaull tertunda rebase: `origin/main` maju 10 PR
(R-03 #263 sudah menambal better-auth lebih dulu, komit dependensi saya
jadi ganda dan akan dibuang saat rebase).

**5 · Rencana esok**
Senin 9 Nov: rebase ke `origin/main`, buang komit dependensi ganda,
dorong branch, buka PR `AI-07` base `main`, tutup #207 setelah merge.
