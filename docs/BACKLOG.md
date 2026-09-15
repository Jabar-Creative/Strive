# BACKLOG — Strive Academy

> **Versi:** 2.0 · semua fitur · kedalaman v0.1  
> **Total:** 73 item · 72,5 dev-hari · Dev A 37,25 · Dev B 35,25  
> **Kapasitas:** 68 dev-hari efektif (2 dev × 8 minggu × 5 hari − 15% overhead) → **107% terisi**  
> **Sumber kebenaran estimasi.** `DELIVERY-PLAN.md` diturunkan dari file ini, bukan sebaliknya.

Setiap item punya ID stabil. **Jangan pernah mengubah ID** — ID dipakai di nama branch, pesan commit, judul PR, dan rujukan lintas dokumen.

## Cara membaca

| Kolom | Arti |
|---|---|
| **Hari** | Estimasi dev-hari ideal, belum termasuk review dan rapat (sudah dipotong di angka kapasitas) |
| **Dev** | A = core transaksional & integrasi · B = antarmuka, AI service & fitur mandiri |
| **W** | Minggu target |
| **Butuh** | Dependensi. Seluruh rantai sudah diverifikasi: tidak ada item yang dijadwalkan sebelum prasyaratnya selesai |
| **Selesai berarti** | Acceptance criteria. Item tidak boleh ditutup sebelum seluruh kalimat ini terbukti — bukan diasumsikan |

## Konvensi kerja

- **Branch:** `<id-lowercase>-<slug>` — contoh `c-01-coin-ledger-service`
- **Commit:** `<ID>: <perubahan>` — contoh `C-01: tambah trigger immutable pada coin_ledger`
- **PR:** judul `<ID> — <judul item>`, deskripsi memuat acceptance criteria sebagai checklist
- **Selesai** hanya kalau seluruh Definition of Done di `CLAUDE.md` terpenuhi

---

## Papan status

> **Tabel ini adalah SATU-SATUNYA tempat status dicatat.** Agent membaca dan menulis balik ke sini.
> Bagian detail item di bawah **tidak** memuat status — supaya tidak ada dua sumber yang bisa berbeda.
>
> **Agent tidak boleh percaya tabel ini begitu saja.** Wajib verifikasi silang dengan repo dulu — lihat `AGENTS.md` langkah 2.

Status yang sah: `todo` · `in_progress` · `blocked` · `review` · `done`

| ID | Item | Dev | W | Hari | Status | Bukti (commit/PR) | Tanggal | Catatan |
|---|---|:---:|:---:|---:|---|---|---|---|
| `F-01` | Monorepo pnpm, TypeScript strict, ESLint, Prettie… | A | W1 | 1 | `todo` | — | — | — |
| `F-03` | CI: lint, typecheck, unit test, build, migrasi ke… | A | W1 | 1 | `todo` | — | — | — |
| `F-04` | Migrasi 001_init.sql + codegen tipe Kysely | A | W1 | 1,5 | `review` | `c5d5c31` | 2026-09-15 | 31 tabel cocok PRD §9.1. Trigger append-only, partisi attempt_date, PK surrogate squad_members — ketiganya terbukti. Menunggu review @kemalzaki. |
| `F-05` | Deploy staging otomatis dari main (web, api, ai, … | A | W1 | 1,5 | `todo` | — | — | — |
| `F-10` | Kunci 8 keputusan produk (PRD §5) | AB | W1 | 0,5 | `done` | `8fe9dc6` | 2026-09-14 | PRD §5 TERKUNCI, pemutus Fatih Maulana. Nol angka berubah. |
| `F-02` | docker-compose dev: PostgreSQL 16, Redis 7, MinIO… | B | W1 | 0,5 | `done` | `fefab70` | 2026-09-15 | PR #3 di-review & merge. AC terbukti: clone bersih → app hidup 2m24s, 3 container `(healthy)`. Bukti: `docs/reports/F-02/` |
| `F-06` | Token design system -> tailwind.config, init Shad… | B | W1 | 1 | `todo` | — | — | — |
| `F-07` | UI kit dari Shadcn blocks: button, card, pill, st… | B | W1 | 1 | `todo` | — | — | — |
| `F-08` | packages/contracts: skema zod seluruh endpoint MVP | B | W1 | 1 | `todo` | — | — | — |
| `F-09` | Wireframe sebagai page stub di kode (12 layar inti) | B | W1 | 0,5 | `todo` | — | — | — |
| `F-11` | Pipeline seed konten (CSV/JSON -> DB) + impor 1 t… | B | W1 | 0,5 | `todo` | — | — | — |
| `A-01` | Integrasi Better-Auth + adapter PostgreSQL + rota… | A | W2 | 0,5 | `todo` | — | — | — |
| `A-02` | JwtGuard + RolesGuard + decorator @Roles + matrik… | A | W2 | 1 | `todo` | — | — | — |
| `C-01` | CoinLedgerService: write, hold, settle, release +… | A | W2 | 2 | `todo` | — | — | — |
| `L-01` | API baca track/modul/lesson/kartu + serializer bu… | A | W2 | 1,5 | `todo` | — | — | — |
| `A-03` | Layar login/register/reset + penyimpanan sesi client | B | W2 | 0,5 | `todo` | — | — | — |
| `A-04` | Middleware rute: (student) vs (console) | B | W2 | 0,5 | `todo` | — | — | — |
| `L-02` | GradingService — penilaian sepenuhnya di server | B | W2 | 1 | `todo` | — | — | — |
| `L-04` | UI kartu bite-sized: pilihan ganda + swipe, feedb… | B | W2 | 2 | `todo` | — | — | — |
| `C-02` | GET /wallet + GET /wallet/ledger (cursor-paginated) | A | W3 | 0,5 | `todo` | — | — | — |
| `L-03` | POST /attempts: attempt + streak + koin + outbox … | A | W3 | 2 | `todo` | — | — | — |
| `S-01` | StreakService timezone-aware + kredit freeze | A | W3 | 1,5 | `todo` | — | — | — |
| `S-02` | GET /hub agregat: streak, quest, peringkat, saldo… | A | W3 | 1 | `todo` | — | — | — |
| `AI-01` | FastAPI skeleton + auth service-to-service + conf… | B | W3 | 1 | `todo` | — | — | — |
| `C-03` | UI dompet: saldo, riwayat, penjelasan tiap jenis … | B | W3 | 1 | `todo` | — | — | — |
| `L-05` | Layar daftar track & progres | B | W3 | 1 | `todo` | — | — | — |
| `S-03` | UI Hub + streak chip 4 status + quest harian | B | W3 | 1,5 | `todo` | — | — | — |
| `C-04` | Job rekonsiliasi harian + alert selisih | A | W4 | 0,5 | `todo` | — | — | — |
| `Q-01` | Pembentukan squad otomatis (8-12 anggota) + gabun… | A | W4 | 0,5 | `todo` | — | — | — |
| `Q-02` | LeaderboardService: ZSET, rotasi kunci musim, reb… | A | W4 | 1,5 | `todo` | — | — | — |
| `Q-03` | Outbox worker: poll, FOR UPDATE SKIP LOCKED, ZINC… | A | W4 | 1 | `todo` | — | — | — |
| `S-04` | Scheduler peringatan streak + notifikasi in-app &… | A | W4 | 1 | `todo` | — | — | — |
| `AI-02` | Ekstraksi PDF/DOCX + penyusunan dari profil pengguna | B | W4 | 1 | `todo` | — | — | — |
| `N-01` | Tabel notifications + API + pengiriman email (Res… | B | W4 | 1 | `todo` | — | — | — |
| `P-01` | pricing_config berversi + 3 paket koin | B | W4 | 0,5 | `todo` | — | — | — |
| `Q-05` | UI squad + leaderboard (WS + fallback polling 30 … | B | W4 | 1,5 | `todo` | — | — | — |
| `P-02` | POST /payments/checkout — Midtrans Snap, QRIS | A | W5 | 1 | `todo` | — | — | — |
| `P-03` | Webhook: verifikasi signature, idempotensi, entri… | A | W5 | 1,5 | `todo` | — | — | — |
| `PR-01` | Alokasi 2 reviewer lintas squad, identitas disemb… | A | W5 | 1 | `todo` | — | — | — |
| `RT-01` | WS gateway + Redis pub/sub adapter, kanal squad:{id} | A | W5 | 1,5 | `todo` | — | — | — |
| `AI-03` | Penyusunan LLM -> JSON terstruktur, prompt berver… | B | W5 | 1,5 | `todo` | — | — | — |
| `N-02` | UI lonceng notifikasi + banner peringatan streak | B | W5 | 0,5 | `todo` | — | — | — |
| `P-04` | UI top-up: pilih paket, bayar, status, kembali ke… | B | W5 | 0,5 | `todo` | — | — | — |
| `Q-04` | Job rollup mingguan + promosi/degradasi 20% | B | W5 | 1 | `todo` | — | — | — |
| `RT-02` | Client hook useRealtime + fallback polling otomatis | B | W5 | 0,5 | `todo` | — | — | — |
| `K-01` | Upload PDF/DOCX + SHA-256 + simpan ke object storage | A | W6 | 1 | `todo` | — | — | — |
| `K-02` | ScanService: dedup, hold/settle/release, reaper 3… | A | W6 | 1,5 | `todo` | — | — | — |
| `MT-01` | Skema mastery_sessions + API | A | W6 | 0,5 | `todo` | — | — | — |
| `PR-02` | API submit review + poin berbobot + cap harian | A | W6 | 1 | `todo` | — | — | — |
| `AI-04` | Skor ATS deterministik + daftar temuan konkret | B | W6 | 0,5 | `todo` | — | — | — |
| `AI-05` | Render PDF satu kolom, ramah parser | B | W6 | 0,5 | `todo` | — | — | — |
| `PL-01` | Form prompt terstruktur (role/context/task/format… | B | W6 | 1 | `todo` | — | — | — |
| `ST-01` | store_items + pembelian transaksional (debit ledger) | B | W6 | 1 | `todo` | — | — | — |
| `ST-02` | UI etalase + unduh aset (signed URL 15 menit) | B | W6 | 1 | `todo` | — | — | — |
| `AI-06` | Tabel ai_jobs + dispatcher di Node + pencatatan b… | A | W7 | 1 | `todo` | — | — | — |
| `K-03` | Worker Copyleaks + webhook hasil + laporan terunduh | A | W7 | 1,5 | `todo` | — | — | — |
| `SA-01` | View SQL untuk transaksi & audit + koneksi Retool… | A | W7 | 0,5 | `todo` | — | — | — |
| `SA-02` | PATCH /admin/pricing — terbit versi baru, bukan m… | A | W7 | 0,5 | `todo` | — | — | — |
| `AI-07` | UI CV builder: isi profil, jalankan, lihat temuan… | B | W7 | 1 | `todo` | — | — | — |
| `K-04` | UI klinik: unggah, antrean, skor kemiripan, riwayat | B | W7 | 1 | `todo` | — | — | — |
| `PL-02` | 3 template contoh + riwayat run | B | W7 | 0,5 | `todo` | — | — | — |
| `PR-03` | UI antrean review + form rubrik | B | W7 | 1 | `todo` | — | — | — |
| `PR-04` | Konsol mentor: antrean validasi, approve/tolak, c… | B | W7 | 1 | `todo` | — | — | — |
| `R-02` | Load test /hub & leaderboard — target p95 <250 ms… | A | W8 | 1 | `todo` | — | — | — |
| `R-03` | Audit keamanan: auth, webhook, upload, rate limit… | A | W8 | 1 | `todo` | — | — | — |
| `R-04` | Observability: log terstruktur, error tracking, a… | A | W8 | 1 | `todo` | — | — | — |
| `SA-03` | Endpoint /admin/integrations/health + biaya vendo… | A | W8 | 0,5 | `todo` | — | — | — |
| `SA-04` | Dasbor Retool: transaksi, harga, audit, health | A | W8 | 0,5 | `todo` | — | — | — |
| `R-05` | Cadangan perbaikan bug | AB | W8 | 2 | `todo` | — | — | — |
| `MT-02` | Wawancara terpandu: bank soal statis + jawaban te… | B | W8 | 1,5 | `todo` | — | — | — |
| `MT-03` | Review personal statement (LLM terstruktur) | B | W8 | 1 | `todo` | — | — | — |
| `MT-04` | UI kedua modul Mastery | B | W8 | 1 | `todo` | — | — | — |
| `R-01` | E2E Playwright: daftar -> belajar -> streak -> to… | B | W8 | 1 | `todo` | — | — | — |

### Ringkasan progres

> Agent memperbarui tabel ini setiap kali sebuah item jadi `done`.

| | Jumlah | Dev-hari |
|---|---:|---:|
| Total | 73 | 72,5 |
| `done` | 2 | 1,0 |
| `in_progress` | 0 | 0 |
| `blocked` | 0 | 0 |
| `todo` | 71 | 71,5 |

---
## Ringkasan per epik

| Epik | Nama | Hari | Item |
|---|---|---:|---:|
| `E0` | Fondasi & Setup | 10 | 11 |
| `E1` | Auth & RBAC | 2,5 | 4 |
| `E4` | Coin & Wallet | 4 | 4 |
| `E2` | Learning Engine | 7,5 | 5 |
| `E3` | Career Streak | 5 | 4 |
| `E5` | Squad & Liga | 5,5 | 5 |
| `E15` | Realtime | 2 | 2 |
| `E16` | Notifikasi | 1,5 | 2 |
| `E6` | Payment | 3,5 | 4 |
| `E14` | Strive Store | 2 | 2 |
| `E7` | Klinik Plagiarisme | 5 | 4 |
| `E11` | Peer Review & Mentor | 4 | 4 |
| `E8` | ATS CV Builder | 6,5 | 7 |
| `E12` | International Mastery Track | 4 | 4 |
| `E13` | Prompt Lab | 1,5 | 2 |
| `E9` | Panel Superadmin | 2 | 4 |
| `E10` | Pengerasan & Rilis | 6 | 5 |
| | **Total** | **72,5** | **73** |

---

## E0 · Fondasi & Setup

> Minggu 1 penuh. Nol fitur — yang dikirim adalah kemampuan mengirim.

### `F-01` — Monorepo pnpm, TypeScript strict, ESLint, Prettier, hook pre-commit

**1 hari** · Dev **A** · Minggu **W1** · Butuh: _tidak ada_

**Status:** lihat papan status di atas · **Selesai berarti:** `pnpm build` hijau untuk workspace TypeScript (web, api, contracts, ui); `services/ai` hijau lewat `pytest` — runtime-nya Python dan tidak punya langkah build. `pnpm lint` dan `pnpm typecheck` nol error. Hook pre-commit menolak commit yang gagal lint.

### `F-02` — docker-compose dev: PostgreSQL 16, Redis 7, MinIO, .env.example

**0,5 hari** · Dev **B** · Minggu **W1** · Butuh: _tidak ada_

**Status:** lihat papan status di atas · **Selesai berarti:** Developer baru bisa jalan dari `git clone` sampai app hidup dalam <=10 menit hanya dengan `pnpm i && docker compose up && pnpm dev`.

### `F-03` — CI: lint, typecheck, unit test, build, migrasi kering

**1 hari** · Dev **A** · Minggu **W1** · Butuh: `F-01`

**Status:** lihat papan status di atas · **Selesai berarti:** PR menjadi merah kalau salah satu gagal. Waktu CI <5 menit. Migrasi dijalankan terhadap DB kosong untuk membuktikan bisa dari nol.

### `F-04` — Migrasi 001_init.sql + codegen tipe Kysely

**1,5 hari** · Dev **A** · Minggu **W1** · Butuh: `F-02`, `F-10`

**Status:** lihat papan status di atas · **Selesai berarti:** 31 tabel berdiri (daftar lengkap di `PRD.md` §9.1). `pnpm db:types` menghasilkan tipe yang dipakai API. Trigger immutable coin_ledger aktif dan terbukti menolak UPDATE.

### `F-05` — Deploy staging otomatis dari main (web, api, ai, PG, Redis, storage)

**1,5 hari** · Dev **A** · Minggu **W1** · Butuh: `F-03`

**Status:** lihat papan status di atas · **Selesai berarti:** URL staging hidup. Push ke `main` men-deploy ketiganya. Rollback ke commit sebelumnya bisa dilakukan dalam <5 menit.

### `F-06` — Token design system -> tailwind.config, init Shadcn, mode gelap

**1 hari** · Dev **B** · Minggu **W1** · Butuh: _tidak ada_

**Status:** lihat papan status di atas · **Selesai berarti:** Halaman /_specimen menampilkan seluruh token warna, skala tipe, radius, dan durasi di mode terang dan gelap. Kontras teks utama >=4.5:1 di kedua mode.

### `F-07` — UI kit dari Shadcn blocks: button, card, pill, streak chip, coin pill, badge liga, kartu lesson

**1 hari** · Dev **B** · Minggu **W1** · Butuh: `F-06`

**Status:** lihat papan status di atas · **Selesai berarti:** Tujuh komponen terpakai di minimal dua layar. Tidak ada warna hardcoded di luar token.

### `F-08` — packages/contracts: skema zod seluruh endpoint MVP

**1 hari** · Dev **B** · Minggu **W1** · Butuh: _tidak ada_

**Status:** lihat papan status di atas · **Selesai berarti:** Tipe request/response di-import web maupun api. Mengubah skema menyebabkan `tsc` gagal di sisi yang belum menyesuaikan.

### `F-09` — Wireframe sebagai page stub di kode (12 layar inti)

**0,5 hari** · Dev **B** · Minggu **W1** · Butuh: _tidak ada_

**Status:** lihat papan status di atas · **Selesai berarti:** Dua belas rute ada dan bisa dinavigasi, isinya placeholder. Tidak ada layar yang masih diperdebatkan saat implementasi dimulai.

### `F-10` — Kunci 8 keputusan produk (PRD §5)

**0,5 hari** · Dev **A+B** · Minggu **W1** · Butuh: _tidak ada_

**Status:** lihat papan status di atas · **Selesai berarti:** Kedelapan jawaban tertulis di PRD §5 dengan tanggal dan nama pemutus. Tidak dibuka lagi tanpa alasan baru.

### `F-11` — Pipeline seed konten (CSV/JSON -> DB) + impor 1 track percontohan

**0,5 hari** · Dev **B** · Minggu **W1** · Butuh: `F-04`

**Status:** lihat papan status di atas · **Selesai berarti:** Konten masuk lewat `pnpm seed:content <file>`, bukan diketik manual ke DB. Impor ulang bersifat idempoten.

## E1 · Auth & RBAC

> Beli, jangan bangun: Better-Auth. Tiga peran saja.

### `A-01` — Integrasi Better-Auth + adapter PostgreSQL + rotasi refresh token

**0,5 hari** · Dev **A** · Minggu **W2** · Butuh: `F-04`

**Status:** lihat papan status di atas · **Selesai berarti:** Register, login, logout, refresh jalan. Refresh token yang dipakai ulang mencabut seluruh sesi turunannya. Password di-hash Argon2id.

### `A-02` — JwtGuard + RolesGuard + decorator @Roles + matriks akses ter-test

**1 hari** · Dev **A** · Minggu **W2** · Butuh: `A-01`

**Status:** lihat papan status di atas · **Selesai berarti:** Test menolak setiap peran yang salah di setiap rute pada ACCESS_MATRIX. Superadmin TIDAK otomatis lolos rute khusus student.

### `A-03` — Layar login/register/reset + penyimpanan sesi client

**0,5 hari** · Dev **B** · Minggu **W2** · Butuh: `A-01`, `F-07`

**Status:** lihat papan status di atas · **Selesai berarti:** Refresh halaman tidak melempar keluar. Token kedaluwarsa memicu refresh senyap, bukan redirect ke login.

### `A-04` — Middleware rute: (student) vs (console)

**0,5 hari** · Dev **B** · Minggu **W2** · Butuh: `A-02`

**Status:** lihat papan status di atas · **Selesai berarti:** Student membuka /console mendapat 403 dengan halaman yang jelas, bukan layar kosong atau redirect membingungkan.

## E4 · Coin & Wallet

> TIDAK ditipiskan. Ini fondasi seluruh monetisasi.

### `C-01` — CoinLedgerService: write, hold, settle, release + trigger immutable

**2 hari** · Dev **A** · Minggu **W2** · Butuh: `F-04`

**Status:** lihat papan status di atas · **Selesai berarti:** Dua request paralel dengan idempotency_key sama hanya menghasilkan satu entri. UPDATE/DELETE pada coin_ledger ditolak database. Saldo negatif ditolak kecuali entry_type='adjust'.

### `C-02` — GET /wallet + GET /wallet/ledger (cursor-paginated)

**0,5 hari** · Dev **A** · Minggu **W3** · Butuh: `C-01`

**Status:** lihat papan status di atas · **Selesai berarti:** Riwayat bisa ditelusuri sampai entri pertama tanpa offset. Setiap entri menampilkan jenis, jumlah, saldo setelah, dan referensinya.

### `C-03` — UI dompet: saldo, riwayat, penjelasan tiap jenis entri

**1 hari** · Dev **B** · Minggu **W3** · Butuh: `C-02`, `F-07`

**Status:** lihat papan status di atas · **Selesai berarti:** Pengguna bisa menjawab sendiri 'kenapa saldo saya berubah' tanpa menghubungi support.

### `C-04` — Job rekonsiliasi harian + alert selisih

**0,5 hari** · Dev **A** · Minggu **W4** · Butuh: `C-01`

**Status:** lihat papan status di atas · **Selesai berarti:** Job membandingkan users.coin_balance dengan SUM(coin_ledger.amount). Selisih apa pun masuk audit_log dan memicu alert. Diuji dengan sengaja merusak satu saldo.

## E2 · Learning Engine

> Kartu pilihan ganda + swipe. Tipe order_steps dan reveal ditunda.

### `L-01` — API baca track/modul/lesson/kartu + serializer buang kunci jawaban

**1,5 hari** · Dev **A** · Minggu **W2** · Butuh: `F-04`

**Status:** lihat papan status di atas · **Selesai berarti:** Respons API tidak pernah memuat field `correct` maupun `why`. Diuji dengan snapshot test atas respons mentah.

### `L-02` — GradingService — penilaian sepenuhnya di server

**1 hari** · Dev **B** · Minggu **W2** · Butuh: `L-01`

**Status:** lihat papan status di atas · **Selesai berarti:** Skor yang dikirim client diabaikan sepenuhnya. Mengirim jawaban acak menghasilkan skor 0, bukan error.

### `L-03` — POST /attempts: attempt + streak + koin + outbox dalam satu transaksi

**2 hari** · Dev **A** · Minggu **W3** · Butuh: `C-01`, `L-02`, `S-01`

**Status:** lihat papan status di atas · **Selesai berarti:** Test: exception yang dilempar di tengah transaksi meninggalkan nol baris di keempat tabel. Idempotency-Key yang sama dikirim dua kali menghasilkan satu attempt dan satu entri koin.

### `L-04` — UI kartu bite-sized: pilihan ganda + swipe, feedback, animasi

**2 hari** · Dev **B** · Minggu **W2** · Butuh: `F-07`, `L-01`

**Status:** lihat papan status di atas · **Selesai berarti:** Satu lesson tuntas dalam 2-3 menit di ponsel 360px. Animasi mati saat prefers-reduced-motion.

### `L-05` — Layar daftar track & progres

**1 hari** · Dev **B** · Minggu **W3** · Butuh: `L-01`

**Status:** lihat papan status di atas · **Selesai berarti:** Progres per modul akurat setelah refresh dan setelah menyelesaikan lesson di tab lain.

## E3 · Career Streak

> Batas hari mengikuti zona waktu pengguna, bukan UTC.

### `S-01` — StreakService timezone-aware + kredit freeze

**1,5 hari** · Dev **A** · Minggu **W3** · Butuh: `F-04`

**Status:** lihat papan status di atas · **Selesai berarti:** Test lintas tiga zona waktu (Asia/Jakarta, Asia/Jayapura, Europe/London) dan lintas tengah malam lulus. Menyelesaikan task kedua di hari yang sama tidak menambah streak.

### `S-02` — GET /hub agregat: streak, quest, peringkat, saldo, kartu berikut

**1 hari** · Dev **A** · Minggu **W3** · Butuh: `S-01`, `C-01`

**Status:** lihat papan status di atas · **Selesai berarti:** Satu request melayani seluruh layar Hub. p95 <250 ms dengan 1.000 lesson_attempts milik pengguna tersebut.

### `S-03` — UI Hub + streak chip 4 status + quest harian

**1,5 hari** · Dev **B** · Minggu **W3** · Butuh: `S-02`

**Status:** lihat papan status di atas · **Selesai berarti:** Status 'sisa N jam' benar di zona waktu pengguna, bukan UTC. Status 'mulai lagi' tidak memakai warna merah.

### `S-04` — Scheduler peringatan streak + notifikasi in-app & email

**1 hari** · Dev **A** · Minggu **W4** · Butuh: `S-01`, `N-01`

**Status:** lihat papan status di atas · **Selesai berarti:** Terkirim pukul 20.00 waktu lokal masing-masing pengguna. Pengguna yang sudah aktif hari itu tidak menerima apa pun.

## E5 · Squad & Liga

> Auto-assign. Redis ZSET dengan rotasi kunci per musim.

### `Q-01` — Pembentukan squad otomatis (8-12 anggota) + gabung/keluar

**0,5 hari** · Dev **A** · Minggu **W4** · Butuh: `F-04`

**Status:** lihat papan status di atas · **Selesai berarti:** Satu pengguna tidak pernah aktif di dua squad (dijamin partial unique index). Squad tidak pernah melebihi max_members.

### `Q-02` — LeaderboardService: ZSET, rotasi kunci musim, rebuild dari Postgres

**1,5 hari** · Dev **A** · Minggu **W4** · Butuh: `Q-01`

**Status:** lihat papan status di atas · **Selesai berarti:** Redis di-FLUSHALL lalu papan pulih otomatis pada request berikutnya, dengan angka identik dengan sebelum dihapus.

### `Q-03` — Outbox worker: poll, FOR UPDATE SKIP LOCKED, ZINCRBY, retry, dead-letter

**1 hari** · Dev **A** · Minggu **W4** · Butuh: `L-03`, `Q-02`

**Status:** lihat papan status di atas · **Selesai berarti:** Dua instance worker berjalan paralel tidak memproses event yang sama. Event gagal 5x masuk audit_log dan antrean tidak macet.

### `Q-04` — Job rollup mingguan + promosi/degradasi 20%

**1 hari** · Dev **B** · Minggu **W5** · Butuh: `Q-02`

**Status:** lihat papan status di atas · **Selesai berarti:** Dijalankan dua kali untuk musim yang sama tidak menggeser tier dua langkah. Squad di Gold tidak bisa promosi, di Bronze tidak bisa degradasi.

### `Q-05` — UI squad + leaderboard (WS + fallback polling 30 dtk)

**1,5 hari** · Dev **B** · Minggu **W4** · Butuh: `Q-02`

**Status:** lihat papan status di atas · **Selesai berarti:** Papan tetap benar saat koneksi WS putus lalu pulih. Tanpa WS sama sekali, papan tetap terisi lewat polling.

## E15 · Realtime

> TIPIS: satu kanal (squad) saja. Kanal user & league tetap polling.

### `RT-01` — WS gateway + Redis pub/sub adapter, kanal squad:{id}

**1,5 hari** · Dev **A** · Minggu **W5** · Butuh: `Q-03`

**Status:** lihat papan status di atas · **Selesai berarti:** Dua instance API berbagi event lewat Redis pub/sub. Klien yang tidak berhak masuk kanal squad lain ditolak saat subscribe.

### `RT-02` — Client hook useRealtime + fallback polling otomatis

**0,5 hari** · Dev **B** · Minggu **W5** · Butuh: `RT-01`

**Status:** lihat papan status di atas · **Selesai berarti:** Mematikan WS server tidak membuat layar mana pun kosong atau error — hanya lebih lambat diperbarui.

## E16 · Notifikasi

> TIPIS: in-app + email. Web Push browser ditunda.

### `N-01` — Tabel notifications + API + pengiriman email (Resend)

**1 hari** · Dev **B** · Minggu **W4** · Butuh: `F-04`

**Status:** lihat papan status di atas · **Selesai berarti:** Email terkirim dengan template yang lulus uji di Gmail dan Outlook. Kegagalan kirim di-retry 3x lalu dicatat, tidak hilang diam-diam.

### `N-02` — UI lonceng notifikasi + banner peringatan streak

**0,5 hari** · Dev **B** · Minggu **W5** · Butuh: `N-01`

**Status:** lihat papan status di atas · **Selesai berarti:** Jumlah belum dibaca akurat. Menandai dibaca bersifat optimistik dan pulih kalau request gagal.

## E6 · Payment

> Beli, jangan bangun: Midtrans Snap hosted checkout.

### `P-01` — pricing_config berversi + 3 paket koin

**0,5 hari** · Dev **B** · Minggu **W4** · Butuh: `F-04`

**Status:** lihat papan status di atas · **Selesai berarti:** Order lama tetap bisa dibaca harganya setelah harga berubah. Menerbitkan versi baru tidak menimpa yang lama.

### `P-02` — POST /payments/checkout — Midtrans Snap, QRIS

**1 hari** · Dev **A** · Minggu **W5** · Butuh: `P-01`, `C-01`

**Status:** lihat papan status di atas · **Selesai berarti:** Order tercipta idempoten terhadap Idempotency-Key. Respons memuat token Snap dan redirect_url yang valid.

### `P-03` — Webhook: verifikasi signature, idempotensi, entri 'purchase'

**1,5 hari** · Dev **A** · Minggu **W5** · Butuh: `P-02`

**Status:** lihat papan status di atas · **Selesai berarti:** Webhook dengan signature salah -> 401 dan tercatat di audit_log. Webhook sah yang sama dikirim 3x menambah koin tepat sekali.

### `P-04` — UI top-up: pilih paket, bayar, status, kembali ke dompet

**0,5 hari** · Dev **B** · Minggu **W5** · Butuh: `P-02`

**Status:** lihat papan status di atas · **Selesai berarti:** Status 'menunggu pembayaran' jelas dan tidak menggantung selamanya — ada polling status order dengan batas waktu.

## E14 · Strive Store

> TIPIS: 8 item di-seed manual, tanpa stok/promo/kategori.

### `ST-01` — store_items + pembelian transaksional (debit ledger)

**1 hari** · Dev **B** · Minggu **W6** · Butuh: `C-01`

**Status:** lihat papan status di atas · **Selesai berarti:** Pembelian item yang sama dua kali ditolak (unique). Saldo kurang -> ditolak sebelum entri apa pun ditulis.

### `ST-02` — UI etalase + unduh aset (signed URL 15 menit)

**1 hari** · Dev **B** · Minggu **W6** · Butuh: `ST-01`

**Status:** lihat papan status di atas · **Selesai berarti:** URL unduh kedaluwarsa setelah 15 menit. Pengguna yang belum membeli tidak bisa menebak URL aset.

## E7 · Klinik Plagiarisme

> TIDAK ditipiskan. Ini fitur yang menghasilkan uang.

### `K-01` — Upload PDF/DOCX + SHA-256 + simpan ke object storage

**1 hari** · Dev **A** · Minggu **W6** · Butuh: `F-05`

**Status:** lihat papan status di atas · **Selesai berarti:** Tipe berkas lain ditolak sebelum menyentuh storage. Berkas >25 MB ditolak dengan pesan yang jelas.

### `K-02` — ScanService: dedup, hold/settle/release, reaper 30 menit

**1,5 hari** · Dev **A** · Minggu **W6** · Butuh: `C-01`, `K-01`

**Status:** lihat papan status di atas · **Selesai berarti:** Worker dimatikan paksa di tengah jalan -> koin kembali otomatis dalam <=30 menit lewat reaper. Dokumen identik kedua tidak memanggil vendor.

### `K-03` — Worker Copyleaks + webhook hasil + laporan terunduh

**1,5 hari** · Dev **A** · Minggu **W7** · Butuh: `K-02`

**Status:** lihat papan status di atas · **Selesai berarti:** Scan berbayar tuntas end-to-end di sandbox vendor. Timeout vendor melepaskan hold, bukan menggantung.

### `K-04` — UI klinik: unggah, antrean, skor kemiripan, riwayat

**1 hari** · Dev **B** · Minggu **W7** · Butuh: `K-02`

**Status:** lihat papan status di atas · **Selesai berarti:** Biaya koin terlihat SEBELUM pengguna menekan kirim. Estimasi jumlah kata ditampilkan dari dokumen yang diunggah.

## E11 · Peer Review & Mentor

> TIPIS: bobot tetap 1,0. Kalibrasi reputasi otomatis ditunda.

### `PR-01` — Alokasi 2 reviewer lintas squad, identitas disembunyikan

**1 hari** · Dev **A** · Minggu **W5** · Butuh: `Q-01`

**Status:** lihat papan status di atas · **Selesai berarti:** Reviewer tidak pernah berasal dari squad yang sama dengan penulis. Reviewer tidak bisa melihat identitas penulis di respons API mana pun.

### `PR-02` — API submit review + poin berbobot + cap harian

**1 hari** · Dev **A** · Minggu **W6** · Butuh: `PR-01`, `C-01`

**Status:** lihat papan status di atas · **Selesai berarti:** Menilai karya sendiri ditolak di service dan di CHECK constraint. Maksimal 5 review berpoin per hari per reviewer.

### `PR-03` — UI antrean review + form rubrik

**1 hari** · Dev **B** · Minggu **W7** · Butuh: `PR-02`

**Status:** lihat papan status di atas · **Selesai berarti:** Rubrik menampilkan kriteria yang sama dengan yang dipakai mentor. Draf penilaian tersimpan lokal kalau halaman tertutup.

### `PR-04` — Konsol mentor: antrean validasi, approve/tolak, catatan

**1 hari** · Dev **B** · Minggu **W7** · Butuh: `PR-02`

**Status:** lihat papan status di atas · **Selesai berarti:** Mentor hanya melihat squad binaannya. Menyetujui review memicu entri koin untuk reviewer tepat sekali.

## E8 · ATS CV Builder

> TIPIS: ekspor PDF saja. DOCX ditunda.

### `AI-01` — FastAPI skeleton + auth service-to-service + config + cache

**1 hari** · Dev **B** · Minggu **W3** · Butuh: `F-05`

**Status:** lihat papan status di atas · **Selesai berarti:** Hanya Core API yang bisa memanggil AI service (token bersama). Panggilan tanpa token -> 401.

### `AI-02` — Ekstraksi PDF/DOCX + penyusunan dari profil pengguna

**1 hari** · Dev **B** · Minggu **W4** · Butuh: `AI-01`

**Status:** lihat papan status di atas · **Selesai berarti:** CV lama dua kolom tetap terbaca. Dokumen tanpa teks (hasil scan gambar) ditolak dengan pesan yang jelas.

### `AI-03` — Penyusunan LLM -> JSON terstruktur, prompt berversi, cache SHA-256

**1,5 hari** · Dev **B** · Minggu **W5** · Butuh: `AI-02`

**Status:** lihat papan status di atas · **Selesai berarti:** Input identik tidak menagih biaya LLM dua kali. LLM tidak pernah menambahkan pengalaman/gelar/angka yang tidak ada di sumber (diuji dengan 5 dokumen kontrol).

### `AI-04` — Skor ATS deterministik + daftar temuan konkret

**0,5 hari** · Dev **B** · Minggu **W6** · Butuh: `AI-03`

**Status:** lihat papan status di atas · **Selesai berarti:** Dokumen yang sama menghasilkan skor yang sama persis, selalu. Tidak ada pemanggilan LLM di jalur penilaian.

### `AI-05` — Render PDF satu kolom, ramah parser

**0,5 hari** · Dev **B** · Minggu **W6** · Butuh: `AI-03`

**Status:** lihat papan status di atas · **Selesai berarti:** Hasil PDF terbaca oleh parser ATS sumber terbuka (diuji dengan pyresparser atau setara).

### `AI-06` — Tabel ai_jobs + dispatcher di Node + pencatatan biaya

**1 hari** · Dev **A** · Minggu **W7** · Butuh: `AI-01`

**Status:** lihat papan status di atas · **Selesai berarti:** Biaya per model dan per pengguna terekam untuk panel admin. Job yang gagal 3x masuk status failed, bukan menggantung.

### `AI-07` — UI CV builder: isi profil, jalankan, lihat temuan, unduh

**1 hari** · Dev **B** · Minggu **W7** · Butuh: `AI-05`

**Status:** lihat papan status di atas · **Selesai berarti:** Setiap temuan ATS bisa ditindaklanjuti tanpa penjelasan tambahan. Status job diperbarui lewat WS atau polling.

## E12 · International Mastery Track

> TIPIS: satu putaran tanya-jawab, bukan simulasi adaptif.

### `MT-01` — Skema mastery_sessions + API

**0,5 hari** · Dev **A** · Minggu **W6** · Butuh: `F-04`

**Status:** lihat papan status di atas · **Selesai berarti:** Sesi menyimpan seluruh giliran tanya-jawab sebagai JSONB. Pengguna hanya bisa membaca sesinya sendiri.

### `MT-02` — Wawancara terpandu: bank soal statis + jawaban teks + feedback LLM

**1,5 hari** · Dev **B** · Minggu **W8** · Butuh: `MT-01`, `AI-01`

**Status:** lihat papan status di atas · **Selesai berarti:** Bank soal minimal 30 pertanyaan untuk 3 program. Feedback menyebut kekuatan dan perbaikan konkret, bukan penilaian umum.

### `MT-03` — Review personal statement (LLM terstruktur)

**1 hari** · Dev **B** · Minggu **W8** · Butuh: `MT-01`, `AI-01`

**Status:** lihat papan status di atas · **Selesai berarti:** Output terstruktur: struktur, kejelasan, bukti, kesesuaian program. Ditandai sebagai saran, bukan penilaian resmi.

### `MT-04` — UI kedua modul Mastery

**1 hari** · Dev **B** · Minggu **W8** · Butuh: `MT-02`, `MT-03`

**Status:** lihat papan status di atas · **Selesai berarti:** Draf jawaban tersimpan otomatis. Riwayat sesi bisa dibuka kembali.

## E13 · Prompt Lab

> TIPIS: form + template + riwayat.

### `PL-01` — Form prompt terstruktur (role/context/task/format/constraints) + jalankan + simpan

**1 hari** · Dev **B** · Minggu **W6** · Butuh: `AI-01`

**Status:** lihat papan status di atas · **Selesai berarti:** Kuota harian per pengguna ditegakkan (default 10 run/hari). Prompt tersimpan bisa dijalankan ulang.

### `PL-02` — 3 template contoh + riwayat run

**0,5 hari** · Dev **B** · Minggu **W7** · Butuh: `PL-01`

**Status:** lihat papan status di atas · **Selesai berarti:** Template bisa disalin jadi milik pengguna lalu diubah. Riwayat menampilkan prompt dan hasilnya berpasangan.

## E9 · Panel Superadmin

> Beli, jangan bangun: Retool di atas view SQL.

### `SA-01` — View SQL untuk transaksi & audit + koneksi Retool read-only

**0,5 hari** · Dev **A** · Minggu **W7** · Butuh: `F-04`

**Status:** lihat papan status di atas · **Selesai berarti:** Satu transaksi bisa ditelusuri dari order sampai entri ledger dalam satu query. Koneksi Retool memakai role read-only.

### `SA-02` — PATCH /admin/pricing — terbit versi baru, bukan menimpa

**0,5 hari** · Dev **A** · Minggu **W7** · Butuh: `P-01`

**Status:** lihat papan status di atas · **Selesai berarti:** Perubahan harga tercatat di audit_log dengan pelakunya. Harga lama tetap terbaca untuk order lama.

### `SA-03` — Endpoint /admin/integrations/health + biaya vendor harian

**0,5 hari** · Dev **A** · Minggu **W8** · Butuh: `AI-06`

**Status:** lihat papan status di atas · **Selesai berarti:** Lonjakan biaya LLM terlihat di hari yang sama. Status tiap vendor (up/down/degraded) akurat.

### `SA-04` — Dasbor Retool: transaksi, harga, audit, health

**0,5 hari** · Dev **A** · Minggu **W8** · Butuh: `SA-01`

**Status:** lihat papan status di atas · **Selesai berarti:** Superadmin bisa bekerja tanpa membuka database. Aksi menulis dibatasi ke endpoint resmi, bukan SQL langsung.

## E10 · Pengerasan & Rilis

> TIDAK ditipiskan. Ini yang membedakan rilis dari demo.

> **Dependensi E10 ditulis eksplisit, dan itu bukan izin untuk melewatkannya.**
> Sebelumnya keempat item ini tertulis "Butuh: _tidak ada_", padahal acceptance
> criteria-nya tidak bisa dibuktikan tanpa fitur yang diukurnya — p95 `GET /hub`
> tidak bisa diukur sebelum `S-02` ada, dan E2E "daftar → belajar → top-up →
> scan" tidak bisa jalan sebelum keempat layar itu ada.
>
> Kalau sebuah dependensi mundur, **responsnya memperbaiki dependensi itu, bukan
> membuang pengerasannya.** Seluruh `E10` ada di daftar "tidak boleh dipotong" —
> lihat bagian akhir file ini dan `DELIVERY-PLAN.md` §2 tuas 3.

### `R-01` — E2E Playwright: daftar -> belajar -> streak -> top-up -> scan

**1 hari** · Dev **B** · Minggu **W8** · Butuh: `A-03`, `L-04`, `P-04`, `K-04`

**Status:** lihat papan status di atas · **Selesai berarti:** Jalan di CI pada setiap PR ke main. Waktu eksekusi <8 menit.

### `R-02` — Load test /hub & leaderboard — target p95 <250 ms @ 500 rps

**1 hari** · Dev **A** · Minggu **W8** · Butuh: `S-02`, `Q-02`

**Status:** lihat papan status di atas · **Selesai berarti:** Angka terukur dan tercatat, bukan perkiraan. Hasil disimpan sebagai baseline untuk perbandingan berikutnya.

### `R-03` — Audit keamanan: auth, webhook, upload, rate limit, header

**1 hari** · Dev **A** · Minggu **W8** · Butuh: `A-02`, `P-03`, `K-01`

**Status:** lihat papan status di atas · **Selesai berarti:** Checklist OWASP ASVS L1 tuntas. Nol temuan kritis. Secret tidak pernah masuk log.

### `R-04` — Observability: log terstruktur, error tracking, alert biaya & antrean

**1 hari** · Dev **A** · Minggu **W8** · Butuh: `C-04`, `Q-03`, `AI-06`

**Status:** lihat papan status di atas · **Selesai berarti:** Insiden terdeteksi sebelum pengguna melapor. Alert biaya vendor harian aktif dengan ambang yang disepakati.

### `R-05` — Cadangan perbaikan bug

**2 hari** · Dev **A+B** · Minggu **W8** · Butuh: _tidak ada_

**Status:** lihat papan status di atas · **Selesai berarti:** Satu-satunya cadangan di seluruh rencana. Kalau terpakai untuk menyelesaikan fitur, itu sinyal bahwa §7 harus dibuka.

---

## Beban per minggu

| Minggu | Dev A | Dev B | Total | Catatan |
|---|---:|---:|---:|---|
| W1 | 5,25 | 4,75 | 10 | Setup penuh, nol fitur |
| W2 | 5 | 4 | 9 |  |
| W3 | 5 | 4,5 | 9,5 | Minggu terberat Dev A — transaksi inti |
| W4 | 4,5 | 4 | 8,5 |  |
| W5 | 5 | 4 | 9 | **Checkpoint scope** di akhir minggu |
| W6 | 4 | 4 | 8 |  |
| W7 | 3,5 | 4,5 | 8 | Feature freeze kecuali Mastery Track |
| W8 | 5 | 5,5 | 10,5 | **Kelebihan beban** — fitur + pengerasan bersamaan |
| | **37,25** | **35,25** | **72,5** | terhadap 68 tersedia |

> Batas sehat adalah 5 hari per orang per minggu. W1 (Dev A 5,25) dan W8 (Dev B 5,5) melewatinya — lihat `DELIVERY-PLAN.md` §7.

---

## Item yang tidak boleh dipotong

Apa pun tekanan jadwalnya, lima item ini tetap dikerjakan pada kedalaman penuh. Semuanya menyangkut uang dan konsistensi; memotongnya menghemat beberapa hari sekarang dan menciptakan kelas bug yang tidak bisa diperbaiki tanpa migrasi data.

| ID | Kenapa |
|---|---|
| `C-01` | Ledger append-only. Tanpa ini tidak ada jejak audit dan tidak ada perlindungan dari worker yang retry. |
| `C-04` | Rekonsiliasi harian. Tanpa ini penyimpangan saldo baru ketahuan dari komplain pengguna. |
| `L-03` | Transaksi tunggal. Tanpa ini bisa ada koin tanpa poin liga, atau sebaliknya. |
| `P-03` | Idempotensi webhook. Tanpa ini webhook ganda menggandakan koin berbayar. |
| `K-02` | Pola hold/settle + reaper. Tanpa ini koin pengguna terkunci selamanya saat worker mati. |

Seluruh epik `E10` (pengerasan & rilis) juga tidak boleh dipotong. Lihat `DELIVERY-PLAN.md` §2 tuas 3.
