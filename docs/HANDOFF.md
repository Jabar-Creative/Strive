# HANDOFF — Peta Lanjutan untuk Sesi Claude Berikutnya

> Berkas ini ditulis atas permintaan pemilik (18 Okt 2026, diperbarui
> 9 Nov 2026) supaya sesi Claude di laptop lain bisa langsung melanjutkan
> tanpa membaca ulang seminggu riwayat. Baca berkas ini + `docs/BACKLOG.md`
> (papan) + PR/isu terbuka. Protokol kerja: `AGENTS.md` (sembilan langkah,
> WAJIB).

## Keadaan sesaat (9 Nov 2026, malam)

- **PR #267 (AI-07 CV builder, base `main`, branch `ai07-cv-builder`)
  menunggu review Fatihmaull.** Isi: M1-M7 lengkap (guard unggah #207,
  rute /v1/cv, hook finalisasi + penyapu, kuota gabungan, sisi Node,
  UI /career, verifikasi penuh). Sudah rebase di atas main (10 PR baru
  dari tim masuk sejak 25 Okt, origin/main `bb2b569`); duplikat
  pra-squash gugur, komit dependensi better-auth milik sendiri gugur
  karena main sudah menaikkannya (#263). GERBANG TUJUH hijau di atas
  hasil rebase: lint, typecheck, unit (contracts 6, web 178, api 362),
  integrasi 631/631, pytest 149, build, audit-deps (0 baru, 0 basi).
- **Dua bug e2e sudah diperbaiki DI DALAM PR** (bukan ditunda): binding
  `PENYELESAI_JOB_AI` tak diekspor (`07d2333`) dan replay idempotensi
  percobaan kedua (`9831e6f`). Audit agent-security: 0 kritis/tinggi,
  4 temuan dipasang `dad03f9`. Bukti: `docs/reports/AI-07/`.
- **SETELAH merge #267: tutup isu #207 manual** (body PR sengaja TIDAK
  memakai kata kunci auto-close) lalu jalankan ulang recompute ringkasan
  dari `AGENTS.md` (konflik tabel ringkasan tidak pernah diselesaikan
  memilih satu sisi, aturan keras 11).
- **Papan per 9 Nov malam**: 80 item · 78,5 dev-hari; done 68 (65,0) ·
  review 1 (1,0) · blocked 6 (6,0) · todo 5 (6,5). K-04 kini `blocked`
  menunggu #90 (lihat barisnya untuk alasan lengkap dan yang sudah siap
  dipakai dari AI-07).
- **Isu yang masih menahan pekerjaan**: #90 (kredensial sandbox
  Copyleaks; menahan K-03 dan K-04) · #57 (kredensial Midtrans; alur
  bayar sungguhan tetap tak terbukti) · #257 (batas `comment` review
  hanya di client, milik Dev A).
- Laporan sesi ini: `docs/reports/auto-mode-26-11-09.md` (auto mode),
  `docs/reports/daily-02-06-nov.md` (harian 2-6 Nov),
  `docs/reports/AI-07/` (E2E).

## Pekerjaan berikutnya (urut)

1. **Respons review #267** begitu Fatih turun (diutamakan di atas item
   baru). Perhatikan catatan "apa yang bisa rusak" di body PR: binding
   array `PENYELESAI_JOB_AI` akan TERTIMPA kalau modul lain mendaftarkan
   penyedia kedua (evolusi ke registry saat itu terjadi).
2. **Setelah merge**: tutup #207, recompute ringkasan papan, lihat
   antrean todo berikutnya di papan (W8).
3. **K-04 tetap blocked** sampai #90 terisi; jangan memaksakan AC skor
   kemiripan dengan mock (pelajaran pola P-04: verifikasi seluas yang
   nyata, status jujur).
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
- **Worker live MENCURI job BullMQ dari suite integrasi** (pelajaran 9
  Nov, 19 test merah palsu): MODE=worker yang masih hidup di Redis
  bersama :56379 mengambil job yang seharusnya dikerjakan vitest.
  Matikan SEMUA proses api/worker/web sebelum `test:integration`.
- **Trigger append-only `coin_ledger` menolak DELETE** bahkan untuk data
  rusak akibat bug sendiri: bereskan dengan entri `adjust` pengompensasi,
  jangan lawan penjaganya; baris bukti bug memang sengaja dibiarkan.
- **Distro WSL ini TIDAK punya docker CLI** (meski playbook lama menulis
  `docker.exe`): kontainer PG/Redis/MinIO sudah berjalan dikelola dari
  Windows; verifikasi lewat klien (psql/redis-cli) dan port localhost,
  bukan `docker ps`.
- **Stub LLM untuk e2e**: setelan `LLM_BASE_URL` (services/ai) mengarah
  ke stub chat/completions :59998; validator pydantic menolak nilai itu
  saat NODE_ENV=production. Cookie sesi API untuk curl: seed baris
  `sessions` lalu kirim `better-auth.session_token=<token>.x`.
- **Rebase branch yang sudah pernah terdorong**: duplikat pra-squash
  menumpuk konflik di BACKLOG/lockfile; `git rebase --empty=drop
  origin/main` + ambil sisi main untuk konflik duplikat, dan push ulang
  dengan `--force-with-lease` HANYA setelah memverifikasi isi remote
  murni komit sendiri (0 komit orang lain).

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
