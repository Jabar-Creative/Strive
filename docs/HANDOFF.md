# HANDOFF — Peta Lanjutan untuk Sesi Claude Berikutnya

> Berkas ini ditulis atas permintaan pemilik (18 Okt 2026, diperbarui
> 25 Okt 2026) supaya sesi Claude di laptop lain bisa langsung melanjutkan
> tanpa membaca ulang seminggu riwayat. Baca berkas ini + `docs/BACKLOG.md`
> (papan) + PR/isu terbuka. Protokol kerja: `AGENTS.md` (sembilan langkah,
> WAJIB).

## Keadaan sesaat (25 Okt, malam)

- **15 PR gelombang 18–20 Okt SUDAH SEMUA MERGE** (#229–#247, merge 20
  Okt). Yang menunggu review Fatih (Dev A) tinggal TUJUH:
  - base `main`, mandiri: **#251** (laporan setup 23 Okt) · **#252**
    (PL-01 Node+UI) · **#253** (P-04 done) · **#254** (deps next 15.5.28);
  - bertumpuk: **#255** (PL-02, base `pl01-node-run` = branch #252) →
    **#258** (PR-03, base `pl02-template-riwayat`) → **#259** (PR-04, base
    `pr03-antrean-rubrik`).
  Urutan merge: #252 dulu, GitHub otomatis me-retarget #255 ke main begitu
  basenya masuk, lalu #258, #259. Aturan stack tetap: jangan
  `--delete-branch` sebelum seluruh tumpukan masuk.
- **Papan per 25 Okt malam**: 80 item · 78,5 dev-hari; done 66 (63,5) ·
  todo 8 (9,5) · lain 6 (5,5). Sisa antrean W7 Dev B: **K-04 (UI klinik),
  AI-07 (UI CV builder)**.
- **Isu yang masih menahan pekerjaan**: #90 (kredensial sandbox Copyleaks
  — menahan K-03/K-04 jalur scan nyata) · #57 (kredensial Midtrans; P-04
  sudah `done` lewat rute nyata #243, tapi alur bayar SUNGGUHAN dengan
  uang vendor tetap tak terbukti) · #257 (batas `comment` review hanya di
  client — kepemilikan Dev A, kode error kontrak §10.2) · #248–#250, #256
  (fondasi, sebagian milik Dev A).
- Papan per branch sudah membawa status masing-masing; SETELAH merge,
  jalankan ulang skrip recompute ringkasan dari `AGENTS.md` (konflik tabel
  ringkasan TIDAK PERNAH diselesaikan memilih satu sisi — aturan keras 11).

## Pekerjaan berikutnya (urut)

1. **Respons review** tujuh PR begitu Fatih turun (diutamakan di atas
   item baru).
2. **K-04 UI klinik** — periksa dulu seberapa jauh bisa dibuktikan tanpa
   kredensial Copyleaks (#90): pola P-04 terbukti bisa dipakai (verifikasi
   seluas permukaan yang ada, status jujur `blocked`/`done` sesuai AC yang
   benar-benar terbukti; lihat PR #235 → #253).
3. **AI-07 UI CV builder** — perhatikan #197 (kode error ai_jobs di luar
   §10.2) dan #207 (bom dekompresi FlateDecode, wajib sebelum /v1/cv
   diekspos): dua isu itu didesain justru untuk item ini, jangan
   dilewati saat membangunnya.
4. Wireframe Stitch: prompt siap tempel di `docs/wireframe-stitch/` —
   Stitch butuh login Google pemilik, agent tidak bisa mewakili.

## Playbook lingkungan MESIN INI (WSL) — hasil hari ini

- **Docker**: daemon bisa mati; nyalakan lewat
  `powershell.exe Start-Process 'C:\Program Files\Docker\Docker\Docker Desktop.exe'`
  lalu poll `docker.exe ps` ±10–60 dtk. Container auto-start.
  `docker.exe compose --project-directory 'D:\STRIVE' up -d` untuk lengkap.
- **`localhost` di WSL resolve ke ::1** — selalu pakai `127.0.0.1:55432`
  (DB) / `:56379` (Redis) / `:59000` (MinIO; strive/strive_dev_only;
  bucket `strive-assets`/`strive-documents`).
- **Test integrasi lokal wajib DUA env**: `DATABASE_URL` **dan**
  `DATABASE_URL_TEST` (kalau hanya TEST yang diset, `test/setup.ts`
  meng-default DATABASE_URL ke dead-end 127.0.0.1:1 → 1 test penjadwal
  gagal dengan ECONNREFUSED. CI selalu set keduanya).
- **HMR Next.js tidak dapat dipercaya setelah pergantian branch** (chunk
  basah tiga kali menutupi perbaikan): sebelum run bukti browser, restart
  `pnpm dev:web` + `rm -rf apps/web/.next`.
- **Stack e2e terisolasi** (agar verifikasi browser tak berebut DB dengan
  suite integrasi — pelajaran hari ini, dua kali): DB `strive_e2e`
  (createdb + `pnpm db:migrate` + `pnpm seed` dengan DATABASE_URL e2e),
  API `API_PORT=3002 APP_URL=http://localhost:3005 DATABASE_URL=…e2e
  pnpm dev:api`, web `WEB_PORT=3005 NEXT_PUBLIC_API_URL=http://localhost:3002
  pnpm dev:web`. CORS gagal-tertutup: APP_URL WAJIB origin web.
- **Playwright** global di `/usr/lib/node_modules/playwright` (impor path
  absolut atau `createRequire`); browser cache `~/.cache/ms-playwright`
  (symlink revisi boleh kalau minta versi lain). Skrip verifikasi hari ini
  tersimpan di direktori job sesi, TIDAK di repo — polanya ada di
  laporan tiap item.
- **MATIKAN dev server sebelum suite integrasi** (pelajaran 25 Okt):
  `next dev` + `nest start` yang hidup membebani I/O `/mnt/d` (drvfs)
  sampai fase collect vitest melambat 22 dtk → 1.268 dtk (total 1.454 dtk).
  Setelah kedua dev server dihentikan: 33 dtk. Jalankan juga lewat
  `apps/api/node_modules/.bin/vitest run -c vitest.integration.config.mts`
  langsung (tanpa lapis pnpm, tanpa `| tail` — exit code pipeline milik
  `tail`, bukan vitest; arahkan output ke berkas + `echo EXIT=$?`).
- **Screenshot bukti di halaman statis bisa byte-identik dua keadaan**
  (md5 sama) kalau tidak ada penanda waktu dan keadaan tidak benar-benar
  berbeda saat diambil: bukti yang sah adalah assert DOM di skrip, bukan
  dua PNG yang mirip; caption laporan harus menulis apa yang BENAR-BENAR
  dibuktikan.
- Setelah `git pull`: **selalu `pnpm i`** (typecheck merah palsu hari ini
  karena node_modules usang). `apps/api/dist` parsial → `rm -rf` dulu.
- venv layanan AI: `services/ai/.venv` (python3.13 sah). Agent-worktree
  yang ditinggal MENGHALANGI `pnpm lint` (worktree ikut ter-scan) —
  `git worktree remove --force` (unlock dulu bila terkunci).

## Hal yang mudah terlupakan (dari hari ini)

- `git status` SEBELUM `git add -A` — screenshot/berkas sesi lain mudah
  tersapu (kejadian hampir: PNG wireframe).
- Register lewat UI: password minimal 10 karakter; `waitForURL` untuk
  navigasi SPA Next TIDAK andal — poll `location.pathname` (pola di skrip).
- Cookie sesi berlaku lintas port (domain localhost sama) — stack e2e di
  port berbeda tetap satu sesi.
- Setelah selesai menulis kode: audit `agent-security` WAJIB — hari ini
  empat dari enam audit menghasilkan perbaikan nyata (uuid-shape, opener,
  URL-scheme, sync-throw).
