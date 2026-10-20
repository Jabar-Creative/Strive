# HANDOFF — Peta Lanjutan untuk Sesi Claude Berikutnya

> Berkas ini ditulis atas permintaan pemilik (18 Okt 2026) supaya sesi
> Claude di laptop lain bisa langsung melanjutkan tanpa membaca ulang
> seminggu riwayat. Baca berkas ini + `docs/BACKLOG.md` (papan) + PR/isu
> terbuka. Protokol kerja: `AGENTS.md` (sembilan langkah, WAJIB).

## Keadaan sesaat

- **8 PR menunggu review Fatih (Dev A)** — urutan logis menunggu turun:
  #229 (N-02) · #232 (RT-02) · #230 (AI-05) · #236 (ST-02) · #234 (kontrak
  paket {id,name}) → #235 (P-04, **bertumpuk di #234**) · #239 (PL-01 sisi
  AI) · #240 (wireframe, ringan).
  Aturan stack: jangan `--delete-branch` sebelum seluruh tumpukan masuk.
- **4 isu menunggu keputusan Dev A**: #231 (ends_at Q-06 offset tanpa
  menit — layar squad crash di API nyata), **#233 (controller
  POST /payments/checkout tidak pernah ada — menahan P-02 dan P-04)**,
  #237 (bucket default dev di produksi), **#238 (RefType 'prompt_run'
  / idempotensi prompt_runs — menahan sisi Node PL-01)**.
- Papan per branch sudah membawa status masing-masing; SETELAH merge,
  jalankan ulang skrip recompute ringkasan dari `AGENTS.md` (konflik tabel
  ringkasan TIDAK PERNAH diselesaikan memilih satu sisi — aturan keras 11).

## Pekerjaan berikutnya (urut)

1. **Respons review** delapan PR begitu Fatih turun (diutamakan di atas
   item baru).
2. **PL-01 sisi Node** begitu #238 diputuskan — desainnya SUDAH SIAP:
   - `POST /career/prompt-lab/run` (⚡, student+mentor): validasi 5 bagian
     + `MAKS_KARAKTER_BAGIAN` 10.000 (sisi AI sudah menolak lebih dulu);
   - kuota PL-4: 10 run AI/hari GABUNGAN (prompt_runs + cv_documents +
     mastery_sessions) dihitung SQL dengan hari LOKAL pengguna
     (`AT TIME ZONE streaks.timezone` — pelajaran #193: satu sumber dengan
     penulis attempt), lewat → 429 `DAILY_AI_QUOTA_EXCEEDED`;
   - biaya PL-3: dari `pricing_config` aktif (`prompt_run_cost_coins`),
     debit `spend_ai` SETELAH sukses (AC-PL-2: timeout 30 dtk → nol
     potongan, nol baris);
   - panggil `AiServiceClient` jalur `/v1/prompt` (JALUR_AI sudah ada),
     timeout rute 30 dtk (layanan menolak di 25 dtk);
   - satu transaksi: insert `prompt_runs` + `coins.write`; idempotensi
     sesuai keputusan #238;
   - `GET /career/prompt-lab/history` SUDAH ADA (F-14, career-read).
   - UI: `/career` form 5 bagian + jalankan + riwayat + jalankan-ulang;
     output WAJIB teks polos (catatan audit #239).
3. **P-04 → done** begitu #233 berdiri + kredensial Midtrans: bukti yang
   belum bisa diambil = alur bayar penuh (UI, mesin, polling, batas waktu
   — semuanya sudah terbukti seluas itu; lihat PR #235).
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
