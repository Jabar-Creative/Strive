# HANDOFF — Peta Lanjutan untuk Sesi Claude Berikutnya

> Berkas ini ditulis atas permintaan pemilik (18 Okt 2026, diperbarui
> 25 Okt dan **5 Nov 2026**) supaya sesi Claude di laptop lain bisa melanjutkan
> tanpa membaca ulang seminggu riwayat. Baca berkas ini + `docs/BACKLOG.md`
> (papan) + PR/isu terbuka. Protokol kerja: `AGENTS.md` (sembilan langkah,
> WAJIB).

## Keadaan sesaat (5 Nov 2026, siang)

Potret lengkap dengan angka per epik: **`docs/reports/progres-05-nov-2026.md`**.
Ringkasnya:

- **Papan: 68/80 item · 65,0/78,5 dev-hari = 82,8%.** `todo` 7 (8,5) ·
  `blocked` 5 (5,0) · `review` 0 · `in_progress` 0.
- **Nol PR terbuka. CI `main` hijau** (`bb2b569`). Seluruh gelombang 18–28
  Okt sudah merge — tidak ada tumpukan yang perlu diurut lagi.
- **Commit terakhir 28 Okt.** Tujuh hari tanpa commit sebelum 5 Nov; bukan
  pekerjaan yang hilang, hanya jeda — tulis apa adanya di laporan harian.
- **Kalender sudah mendahului pekerjaan**: hari kerja ke-39 dari 40
  (rencana W8 berakhir 6 Nov). 97,5% kalender vs 82,8% pekerjaan. Rencana
  delapan minggu **tidak akan tutup**; `DELIVERY-PLAN.md` §7 sudah
  merekomendasikan sembilan minggu sejak hari pertama.
- **Sembilan dari tujuh belas epik TUNTAS** — seluruh mesin retensi.
  Yang tertinggal: `MT` Mastery Track **12%**, `K` klinik 50%,
  `R` pengerasan 50%.
- **Antrean Dev A KOSONG**: keempat kartu A yang tersisa `blocked`, dan nol
  di antaranya bisa dibuka dengan menulis kode. Kapasitas Dev A tersedia
  penuh untuk mengambil kartu Dev B (pola `Q-04`/`ST-01`, 22 Sep).
- **Staging MATI sejak ~26 Okt** — `404 Application not found`, kredit trial
  Railway habis. `F-05` pindah `review` → `blocked`: dua belas V terbukti,
  **V13 rollback jadi mustahil**. Pemicu deploy otomatis sudah dimatikan
  (#264). Web Vercel tetap 200 tanpa backend — jangan dibaca sebagai
  "staging ada".

## Pekerjaan berikutnya (urut)

Empat kartu **siap dikerjakan sekarang**, tanpa menunggu apa pun:

1. **`MT-02` Wawancara terpandu** (1,5) dan **`MT-03` Review personal
   statement** (1,0) — `MT` adalah epik paling tertinggal (12%), dan
   `MT-04` (UI) menunggu keduanya. Kerjakan berpasangan.
2. **`AI-07` UI CV builder** (1,0) — **baca #197 dan #207 lebih dulu**: kode
   galat `ai_jobs` di luar §10.2, dan bom dekompresi FlateDecode yang wajib
   ditahan sebelum `/v1/cv` diekspos. Dua isu itu ditulis justru untuk item
   ini; jangan dilewati.
3. **`K-04` UI klinik** (1,0) — periksa dulu seberapa jauh bisa dibuktikan
   tanpa kredensial Copyleaks (#90). Pola `P-04` (#235 → #253) terbukti
   bisa dipakai: verifikasi seluas permukaan yang ADA, status jujur
   `blocked`/`done` sesuai AC yang benar-benar terbukti.
4. Lalu `MT-04` (butuh 1–2) dan `R-01` E2E (butuh `K-04`).

Yang **bukan** pekerjaan kode dan tetap menahan 5,0 dev-hari: kredensial
Midtrans (#57), Copyleaks (#90), Retool (#77), penyedia staging + metode
bayar (`F-05`), dan keputusan satu-domain (#176).

Wireframe Stitch: prompt siap tempel di `docs/wireframe-stitch/` — Stitch
butuh login Google pemilik, agent tidak bisa mewakili.

## Playbook lingkungan — mesin **WSL** (`D:\STRIVE`)

> Dulu berjudul "MESIN INI". Sesi 5 Nov berjalan di **macOS**, jadi judulnya
> dibuat eksplisit: isi di bawah berlaku untuk laptop WSL, bukan untuk setiap
> mesin yang membaca berkas ini. Di macOS yang relevan cuma dua barisnya —
> Docker Desktop harus hidup sebelum suite integrasi, dan `pnpm i` setelah
> `git pull`.

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

## Hal yang mudah terlupakan (dari sesi 18–25 Okt)

- `git status` SEBELUM `git add -A` — screenshot/berkas sesi lain mudah
  tersapu (kejadian hampir: PNG wireframe).
- Register lewat UI: password minimal 10 karakter; `waitForURL` untuk
  navigasi SPA Next TIDAK andal — poll `location.pathname` (pola di skrip).
- Cookie sesi berlaku lintas port (domain localhost sama) — stack e2e di
  port berbeda tetap satu sesi.
- Setelah selesai menulis kode: audit `agent-security` WAJIB — hari ini
  empat dari enam audit menghasilkan perbaikan nyata (uuid-shape, opener,
  URL-scheme, sync-throw).
