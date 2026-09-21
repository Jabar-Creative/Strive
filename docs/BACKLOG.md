# BACKLOG — Strive Academy

> **Versi:** 2.0 · semua fitur · kedalaman v0.1  
> **Total:** 80 item · 78,5 dev-hari · Dev A 42,0 · Dev B 34,0 · Dev AB 2,5  
> **Kapasitas:** 68 dev-hari efektif (2 dev × 8 minggu × 5 hari − 15% overhead) → **115% terisi**  
> **Angka di baris ini DIHITUNG dari tabel papan, bukan ditulis tangan (2026-09-20).** Sebelum
> ini tertulis `74 item · 73,0 dev-hari · Dev A 37,75 · Dev B 35,25` — tiga dari empat angkanya
> salah, dan `Dev AB` (2,5 hari) tidak terhitung sama sekali. `assert` di `AGENTS.md` hanya
> memeriksa JUMLAH ITEM, jadi hari-harinya menyimpang diam-diam selama seminggu. Assert-nya
> sekarang ikut memeriksa hari.  
> **Tujuh item sisipan, semuanya pekerjaan yang TERLEWAT saat perencanaan — bukan scope baru.**
> `F-12` (#14) · `F-13` (#69) · `Q-06` (#79) · lalu `A-05`, `S-05`, `SA-05`, `F-14` (#88).
> Terisi naik 107% → **115%**, dan itu angka jujur menggantikan angka yang salah.
>
> Empat terakhir datang dari **satu penyisiran** (`scripts/audit-rute.mjs`): 12 dari 59 rute
> yang dijanjikan PRD §10.3 kepada klien tidak dimiliki item mana pun. Tiga sebelumnya
> ditemukan satu per satu, dengan cara yang sama — **mencoba memakai hasilnya**, bukan membaca
> papan. Papan hanya tahu apa yang tertulis di dalamnya.
>
> **Pemotongan scope di checkpoint W5 sekarang bukan pilihan, tapi keharusan aritmetika:**
> 78,5 dev-hari terhadap kapasitas 68.
> Pemotongan scope di checkpoint W5 jadi lebih menentukan, bukan kurang.  
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
| `F-01` | Monorepo pnpm, TypeScript strict, ESLint, Prettie… | A | W1 | 1 | `done` | `3836fed` | 2026-09-15 | PR #4 ter-merge. 4 AC terbukti + penegakan versi Python (keputusan 1 PR #3), 5 jalur diuji. |
| `F-03` | CI: lint, typecheck, unit test, build, migrasi ke… | A | W1 | 1 | `done` | `973d7cf` | 2026-09-15 | PR #11 ter-merge. PR merah dibuktikan lewat PR #7 sungguhan, CI 77 dtk, migrasi terhadap DB kosong + verifikasi 31 tabel & trigger. |
| `F-04` | Migrasi 001_init.sql + codegen tipe Kysely | A | W1 | 1,5 | `done` | `9aa3037` | 2026-09-15 | PR #5 ter-merge. 31 tabel cocok PRD §9.1 (nol hilang, nol berlebih). Trigger append-only, partisi attempt_date, PK surrogate squad_members terbukti. BELUM di-review Dev B. |
| `F-05` | Deploy staging otomatis dari main (web, api, ai, … | A | W1 | 1,5 | `blocked` | — | 2026-09-15 | DITUNDA atas keputusan Dev A (isu #29), bukan menggantung tanpa pemilik. Staging tidak diadakan sampai Dev A mengumumkan siap. DoD dilonggarkan sementara: baris "ter-deploy ke staging" dinonaktifkan (CLAUDE.md). TIDAK lagi menahan item mana pun sejak 2026-09-20 (isu #70): `K-01` dan `AI-01` dipindah ke `F-02`, yang memang menyediakan infrastruktur lokalnya. `F-05` tetap dibutuhkan sebelum rilis. |
| `F-10` | Kunci 8 keputusan produk (PRD §5) | AB | W1 | 0,5 | `done` | `8fe9dc6` | 2026-09-14 | PRD §5 TERKUNCI, pemutus Fatih Maulana. Nol angka berubah. |
| `F-02` | docker-compose dev: PostgreSQL 16, Redis 7, MinIO… | B | W1 | 0,5 | `done` | `fefab70` | 2026-09-15 | PR #3 di-review & merge. AC terbukti: clone bersih → app hidup 2m24s, 3 container `(healthy)`. Bukti: `docs/reports/F-02/` |
| `F-06` | Token design system -> tailwind.config, init Shad… | B | W1 | 1 | `done` | `b060129` | 2026-09-15 | PR #12 ter-merge & di-review. 10/10 token cocok PRD §14.1, kontras teks utama 15,68-18,24:1 di kedua mode. Bukti hidup: /_specimen. Menutup isu #16. |
| `F-07` | UI kit dari Shadcn blocks: button, card, pill, st… | B | W1 | 1 | `done` | #36 | 2026-09-16 | Ter-merge lewat #36, di-review Dev A (isu #34). DoD: staging dikecualikan (isu #29). |
| `F-08` | packages/contracts: skema zod seluruh endpoint MVP | B | W1 | 1 | `done` | #40 | 2026-09-17 | Ter-merge lewat #40. Review Dev A: INVALID_CURSOR masuk PRD §10.2, NOTIFICATION_NOT_FOUND dibuang (daftar §10.2 TERTUTUP). |
| `F-09` | Wireframe sebagai page stub di kode (12 layar inti) | B | W1 | 0,5 | `done` | `d2cee60` | 2026-09-15 | PR #13 ter-merge & di-review. 12/12 rute HTTP 200, nol referensi menggantung ke backlog/PRD. Nol baris kode baru — memang hasil yang benar. |
| `F-11` | Pipeline seed konten (CSV/JSON -> DB) + impor 1 t… | B | W1 | 0,5 | `done` | #41 | 2026-09-17 | Ter-merge lewat #41. Review Dev A: batas idempotensi saat lesson sudah dikerjakan dicatat di README. |
| `F-12` | Job bulanan pembuat partisi `lesson_attempts` + alarm… | A | W8 | 0,5 | `done` | #62 | 2026-09-17 | Batas bulan dihitung POSTGRES (date_trunc), bukan aritmetika bulan JavaScript yang salah di akhir bulan. Batas partisi dibaca dari EKSPRESI partisinya, bukan ditebak dari namanya. Diuji dengan insert sungguhan ke partisi bulan depan — partisi yang terdaftar tapi batasnya salah tetap menolak insert. |
| `F-13` | Seed data dev: pricing_config, track contoh, store items | A | W3 | 0,5 | `done` | — | 2026-09-20 | Harga disalin dari PRD §6 yang TERKUNCI, **bukan dari fixture test** — fixture `admin-pricing` memakai angka lain (cache hit 1200 vs 240 sebenarnya, CV 1500 vs 400) karena ia menguji mekanisme versi, bukan harganya. Test menegaskan tiap angka satu per satu. Idempotensi dijamin konstruksi: HANYA `INSERT … ON CONFLICT DO NOTHING`, nol UPDATE/DELETE. `pricing_config` disemai hanya kalau tabelnya kosong — menerbitkan versi tiap jalan membuat order lama menunjuk versi yang bukan harganya. Pengguna jangkar TIDAK bisa login (repo publik). |
| `F-14` | API baca riwayat milik sendiri (7 rute lintas domain) | A | W7 | 1,5 | `todo` | — | — | Dari isu #88. Tujuh rute PRD §10.3 berbentuk sama — baca baris MILIK SENDIRI, cursor-paginated, kepemilikan dicek service: `/attempts` `/scans` `/reviews/mine` `/payments/orders/:id` `/career/cv/:id` `/career/prompt-lab/history` `/mastery/sessions`. W7 karena domain yang MENULIS barisnya harus ada dulu. |
| `A-01` | Integrasi Better-Auth + adapter PostgreSQL + rota… | A | W2 | 2 | `done` | #45 | 2026-09-17 | Ter-merge lewat #45. Migrasi 004 (33 tabel) + 005 (trigger AU-6). AC-AU-2 ditulis ulang. |
| `A-02` | JwtGuard + RolesGuard + decorator @Roles + matrik… | A | W2 | 1 | `done` | #49 | 2026-09-17 | ACCESS_MATRIX 31 rute, 91 test unit menjalankan hasil kali silang penuh (rute x peran). Dinamai SessionGuard, bukan JwtGuard: tidak ada JWT sejak isu #18. Guard sementara N-01 dipensiunkan. |
| `C-01` | CoinLedgerService: write, hold, settle, release +… | A | W2 | 2 | `done` | #21 | 2026-09-16 | Ter-merge lewat #21. DoD: staging dikecualikan (isu #29), reviewer tidak berlaku untuk PR Dev A (isu #34). |
| `L-01` | API baca track/modul/lesson/kartu + serializer bu… | A | W2 | 1,5 | `done` | #22 | 2026-09-16 | Ter-merge lewat #22. DoD: staging dikecualikan (isu #29), reviewer tidak berlaku untuk PR Dev A (isu #34). |
| `A-03` | Layar login/register/reset + penyimpanan sesi client | B | W2 | 0,5 | `done` | `a01261f` | 2026-09-17 | Handler HTTP Better-Auth dipasang di /api/v1/auth/* (cookie httpOnly, sesi 30 hari AU-4, disableOriginCheck dikunci) + 5 layar. AC terbukti test integrasi HTTP nyata: Set-Cookie + AU-6 lewat HTTP, get-session dengan cookie, origin asing 403. 75/75 integrasi + 8/8 unit web. Verifikasi visual browser tersisa ke manusia (DevTools MCP tidak terpasang di sesi). Callback email reset/verifikasi + additionalFields timezone = isu untuk Dev A. |
| `A-04` | Middleware rute: (student) vs (console) | B | W2 | 0,5 | `todo` | — | — | — |
| `A-05` | API profil: GET /me + PATCH /me | A | W2 | 0,5 | `done` | #99 | 2026-09-21 | Daftar PUTIH field, bukan daftar hitam: `role` dan `coin_balance` kolom di tabel yang sama, dan daftar hitam melupakan kolom yang ditambahkan besok. Diverifikasi merah. Menemukan `users.timezone` vs `streaks.timezone` — dua sumber satu fakta, tidak ada yang menyinkronkan sejak trigger registrasi; keduanya ditulis satu transaksi. `avatar_url` dibatasi http(s): `javascript:` tersimpan apa adanya lalu dipasang klien di leaderboard. |
| `L-02` | GradingService — penilaian sepenuhnya di server | B | W2 | 1 | `todo` | — | — | — |
| `L-04` | UI kartu bite-sized: pilihan ganda + swipe, feedb… | B | W2 | 2 | `todo` | — | — | — |
| `C-02` | GET /wallet + GET /wallet/ledger (cursor-paginated) | A | W3 | 0,5 | `done` | #50 | 2026-09-17 | Cursor buram berprefiks cl: — cursor dari endpoint lain ditolak, bukan diam-diam dipakai sebagai id. AC 'telusur sampai entri pertama' diuji dengan menelusuri 47 entri penuh dan mencocokkannya dengan isi tabel. |
| `L-03` | POST /attempts: attempt + streak + koin + outbox … | A | W3 | 2 | `todo` | — | — | — |
| `S-01` | StreakService timezone-aware + kredit freeze | A | W3 | 1,5 | `done` | #23 | 2026-09-16 | Ter-merge lewat #23. DoD: staging dikecualikan (isu #29), reviewer tidak berlaku untuk PR Dev A (isu #34). |
| `S-02` | GET /hub agregat: streak, quest, peringkat, saldo… | A | W3 | 1 | `done` | #51 | 2026-09-17 | Lima bagian dalam satu request, dijalankan bersamaan lewat Promise.all. Seluruh tanggal dihitung di SQL. AC p95<250ms diuji dengan menyemai 1.000 attempt sungguhan. Tipe respons masih lokal: /hub TIDAK ADA di packages/contracts. |
| `AI-01` | FastAPI skeleton + auth service-to-service + conf… | B | W3 | 1 | `todo` | — | — | — |
| `C-03` | UI dompet: saldo, riwayat, penjelasan tiap jenis … | B | W3 | 1 | `todo` | — | — | — |
| `L-05` | Layar daftar track & progres | B | W3 | 1 | `todo` | — | — | — |
| `S-03` | UI Hub + streak chip 4 status + quest harian | B | W3 | 1,5 | `todo` | — | — | — |
| `C-04` | Job rekonsiliasi harian + alert selisih | A | W4 | 0,5 | `done` | #53 | 2026-09-17 | Job hanya MEMBACA — tidak memperbaiki apa pun, karena menambal angkanya menghapus bukti penyebabnya. Baris audit ditulis meski nol selisih. Diuji dengan sengaja menulis coin_balance langsung, satu-satunya tempat di repo yang melakukannya. |
| `Q-01` | Pembentukan squad otomatis (8-12 anggota) + gabun… | A | W4 | 0,5 | `done` | #24 | 2026-09-16 | Ter-merge lewat #24. DoD: staging dikecualikan (isu #29), reviewer tidak berlaku untuk PR Dev A (isu #34). |
| `Q-02` | LeaderboardService: ZSET, rotasi kunci musim, reb… | A | W4 | 1,5 | `done` | #54 | 2026-09-17 | Redis melayani, Postgres memiliki. AC 'FLUSHALL lalu pulih dengan angka identik' diuji dengan FLUSHALL sungguhan — mock akan selalu pulih karena datanya tidak pernah benar-benar hilang. Service redis ditambahkan ke CI. |
| `Q-03` | Outbox worker: poll, FOR UPDATE SKIP LOCKED, ZINC… | A | W4 | 1 | `todo` | — | — | — |
| `S-04` | Scheduler peringatan streak + notifikasi in-app &… | A | W4 | 1 | `done` | #55 | 2026-09-17 | Job jalan tiap jam, memilih pengguna yang SAAT ITU pukul 20.00 di zonanya sendiri — perbandingan jam di dalam SQL. Idempoten per hari lokal. IS DISTINCT FROM, bukan <>: pengguna yang belum pernah aktif justru yang paling butuh diingatkan. |
| `S-05` | POST /streak/freeze/purchase — beli kredit freeze | A | W4 | 0,5 | `done` | #95 | 2026-09-21 | Bulan dihitung Postgres dari `streaks.timezone`, bukan UTC. Entri ledger SENGAJA tanpa ref: `coin_ledger_ref_uniq` akan membatasi pembelian jadi sekali seumur hidup. Konkurensi diverifikasi merah — yang bocor bukan kreditnya, tapi debit ganda 400 koin untuk 1 kredit. |
| `AI-02` | Ekstraksi PDF/DOCX + penyusunan dari profil pengguna | B | W4 | 1 | `todo` | — | — | — |
| `N-01` | Tabel notifications + API + pengiriman email (Res… | B | W4 | 1 | `done` | #43 | 2026-09-17 | Ter-merge lewat #43. Review Dev A: guard JWT diganti guard sesi — A-01 menghapus JWT setelah item ini mulai. |
| `P-01` | pricing_config berversi + 3 paket koin | B | W4 | 0,5 | `done` | #42 | 2026-09-17 | Ter-merge lewat #42. Review Dev A: uang integer, append-only terbukti, advisory lock bernama. |
| `Q-05` | UI squad + leaderboard (WS + fallback polling 30 … | B | W4 | 1,5 | `todo` | — | — | — |
| `Q-06` | API squad: GET /squads/me + GET /squads/:id/leaderboard | A | W4 | 0,5 | `done` | — | 2026-09-20 | Kepemilikan dicek SERVICE, bukan guard — AC-nya soal keanggotaan dan RolesGuard tidak tahu apa-apa soal itu. Dibuktikan menggigit: cabut penjaganya, 3 test merah termasuk AC intinya. Dua bug KODEKU ditangkap test: (1) `RANK() OVER (ORDER BY poin, user_id)` tidak pernah seri — tiebreaker di dalam OVER mengubahnya jadi ROW_NUMBER, dan komentarku mengklaim sebaliknya; (2) handler Nest yang mengembalikan `null` mengirim body KOSONG, `.json()` melempar di peramban juga — dibungkus `{ squad }`. Peringkat jalur Redis dihitung ulang dengan semantik seri supaya kedua rute tidak menampilkan angka berbeda di layar yang sama. Membuka `Q-05` untuk Dev B. |
| `P-02` | POST /payments/checkout — Midtrans Snap, QRIS | A | W5 | 1 | `blocked` | — | 2026-09-17 | Kode selesai & ter-merge, TAPI setengah AC tidak bisa dibuktikan: 'token Snap dan redirect_url yang VALID' menuntut panggilan Midtrans sungguhan, dan MIDTRANS_SERVER_KEY kosong. Idempotensi & PA-5 & PA-10 terbukti. Menunggu kredensial vendor — sama seperti F-05 menunggu akun cloud. |
| `P-03` | Webhook: verifikasi signature, idempotensi, entri… | A | W5 | 1,5 | `todo` | — | — | — |
| `PR-01` | Alokasi 2 reviewer lintas squad, identitas disemb… | A | W5 | 1 | `done` | #58 | 2026-09-17 | PR-2 ditegakkan BENTUK DATA: ReviewQueueItem tidak punya author_id, jadi tidak ada tempat untuk lupa membuangnya. Diuji dengan memeriksa SELURUH isi respons, bukan satu field. PR-1 dijaga di antrean DAN di jalur tulis. |
| `RT-01` | WS gateway + Redis pub/sub adapter, kanal squad:{id} | A | W5 | 1,5 | `todo` | — | — | — |
| `AI-03` | Penyusunan LLM -> JSON terstruktur, prompt berver… | B | W5 | 1,5 | `todo` | — | — | — |
| `N-02` | UI lonceng notifikasi + banner peringatan streak | B | W5 | 0,5 | `todo` | — | — | — |
| `P-04` | UI top-up: pilih paket, bayar, status, kembali ke… | B | W5 | 0,5 | `todo` | — | — | — |
| `Q-04` | Job rollup mingguan + promosi/degradasi 20% | B | W5 | 1 | `todo` | — | — | — |
| `RT-02` | Client hook useRealtime + fallback polling otomatis | B | W5 | 0,5 | `todo` | — | — | — |
| `K-01` | Upload PDF/DOCX + SHA-256 + simpan ke object storage | A | W6 | 1 | `done` | — | 2026-09-20 | Tipe ditentukan dari BYTE berkasnya, bukan nama/Content-Type — keduanya dari klien. Magic `PK` saja tidak cukup untuk DOCX: setiap .zip/.jar/.xlsx punya empat byte pertama yang sama, jadi entri `word/document.xml` ikut dicari. AC "ditolak SEBELUM menyentuh storage" dibuktikan dengan menghitung panggilan `put` (nol), bukan dengan "objeknya tidak ada" — service yang menyimpan lalu menghapus akan lolos cara kedua. Dibalik urutannya jadi merah: 6 berkas ditolak sampai ke bucket. Kunci objek dari HASH, bukan nama berkas (`../../etc/passwd` diuji). |
| `K-02` | ScanService: dedup, hold/settle/release, reaper 30… | A | W6 | 1,5 | `done` | — | 2026-09-20 | Aturan 2 (`coin_balance` = SUM(ledger)) di-assert di SETIAP titik, bukan sekali di akhir. Dedup hanya dari scan `done` — dibuktikan menggigit: hapus filternya, 3 test merah. Dua temuan dari menulis test: (1) hasil vendor yang tiba SETELAH reaper melepas koin dulu MELEMPAR Error mentah (500) dan membuang hasil yang vendornya sudah dibayar — sekarang tercatat sebagai anomali, status tetap `released` supaya tidak jadi sumber dedup di tarif yang tidak dibayar siapa pun; (2) `MODE=worker` GAGAL BOOT TOTAL sejak lama (isu #86) — `WorkerModule` tidak mengimpor `KyselyModule`, dan nol test pernah membangunnya. Diperbaiki + `worker.module.spec.ts` ditambahkan, yang langsung menangkap `StorageModule` hilang juga. |
| `MT-01` | Skema mastery_sessions + API | A | W6 | 0,5 | `done` | #59 | 2026-09-17 | Giliran ditambahkan lewat jsonb_insert di DATABASE, bukan dirakit di Node — 10 penambahan paralel diuji, nol yang hilang. Kepemilikan disaring di WHERE, bukan diperiksa setelah baris diambil. Sesi orang lain dan sesi yang tidak ada menjawab identik. |
| `PR-02` | API submit review + poin berbobot + cap harian | A | W6 | 1 | `done` | — | 2026-09-20 | Cap harian memakai hari LOKAL reviewer (aturan 5), diuji tepat di batas tengah malam lokal — implementasi UTC lulus test biasa tapi gagal yang ini. Test konkurensi versi pertama LULUS tanpa `FOR UPDATE`, jadi ditulis ulang dengan gerbang; sekarang cabut kuncinya dan ia merah (6 berpoin, bukan 5). Nilai rubrik dari klien DIBATASI 0..5 × maks 10 kriteria — tanpa itu `{"x":999999}` mencetak poin lewat endpoint publik (isu #73). CHECK `no_self_review` dibuktikan dengan MENEMBUS service. |
| `AI-04` | Skor ATS deterministik + daftar temuan konkret | B | W6 | 0,5 | `todo` | — | — | — |
| `AI-05` | Render PDF satu kolom, ramah parser | B | W6 | 0,5 | `todo` | — | — | — |
| `PL-01` | Form prompt terstruktur (role/context/task/format… | B | W6 | 1 | `todo` | — | — | — |
| `ST-01` | store_items + pembelian transaksional (debit ledger) | B | W6 | 1 | `todo` | — | — | — |
| `ST-02` | UI etalase + unduh aset (signed URL 15 menit) | B | W6 | 1 | `todo` | — | — | Memiliki `GET /store/purchases/:id/download` — AC-nya ("URL unduh kedaluwarsa setelah 15 menit") sudah menjanjikannya; path-nya dicatat di sini supaya penyisiran `scripts/audit-rute.mjs` bisa melihatnya (isu #88). |
| `AI-06` | Tabel ai_jobs + dispatcher di Node + pencatatan b… | A | W7 | 1 | `todo` | — | — | — |
| `K-03` | Worker Copyleaks + webhook hasil + laporan terunduh | A | W7 | 1,5 | `blocked` | — | 2026-09-20 | BLOCKED: kredensial sandbox Copyleaks belum ada (isu #90) — vendor KETIGA yang menahan item, setelah Midtrans (#57) dan Retool (#77). AC-nya menuntut "tuntas end-to-end di sandbox vendor". YANG SUDAH ADA: antarmuka disesuaikan PRD §12.2 (versi K-02 menyimpang — `documentUrl`, bukan `documentKey`; vendor mengambil dokumennya sendiri lewat signed URL dan tidak boleh punya akses bucket kita), rute `POST /webhooks/copyleaks` + entri ACCESS_MATRIX yang ditemukan hilang oleh penyisiran #88, kabel ke settle/release, dan `rawBody: true` di main.ts. Provider GAGAL TERTUTUP: tanpa rahasia, setiap webhook ditolak — bukan tiruan yang mengembalikan true supaya "bisa dites". |
| `SA-01` | View SQL untuk transaksi & audit + koneksi Retool… | A | W7 | 0,5 | `done` | #60 | 2026-09-17 | View admin_transactions menggabung 4 tabel + kolom paid_without_ledger (uang masuk tanpa koin keluar). Role strive_readonly diuji dengan SET LOCAL ROLE sungguhan: bisa baca view, TIDAK bisa menulis apa pun, TIDAK bisa membaca tabel mentah. |
| `SA-02` | PATCH /admin/pricing — terbit versi baru, bukan m… | A | W7 | 0,5 | `done` | #61 | 2026-09-17 | publishNewVersion sekarang menulis audit_log DI DALAM transaksi yang sama — versi tanpa jejak adalah harga yang berubah tanpa ada yang mengaku. actorId dari GUARD, tidak pernah dari body. Harga lama terbukti tetap terbaca untuk order lama. |
| `AI-07` | UI CV builder: isi profil, jalankan, lihat temuan… | B | W7 | 1 | `todo` | — | — | — |
| `K-04` | UI klinik: unggah, antrean, skor kemiripan, riwayat | B | W7 | 1 | `todo` | — | — | — |
| `PL-02` | 3 template contoh + riwayat run | B | W7 | 0,5 | `todo` | — | — | — |
| `PR-03` | UI antrean review + form rubrik | B | W7 | 1 | `todo` | — | — | — |
| `PR-04` | Konsol mentor: antrean validasi, approve/tolak, c… | B | W7 | 1 | `todo` | — | — | — |
| `R-02` | Load test /hub & leaderboard — target p95 <250 ms… | A | W8 | 1 | `done` | — | 2026-09-20 | p95 **6 ms @ 500 rps** (target 250) — margin ~40×. Kurva dicatat, bukan satu titik: 1000 rps masih lulus (20 ms), 1500 rps tidak (353 ms), 3000 rps jenuh di ~1617 rps dengan 15.389 gagal. Headroom nyata 2–3×, bukan tak terbatas. Beban OPEN-LOOP — closed-loop mengurangi laju kirim saat server melambat dan melaporkan p95 yang terlalu bagus (coordinated omission). Leaderboard TIDAK terukur: endpointnya tidak ada dan tidak dimiliki item mana pun (isu #79). |
| `R-03` | Audit keamanan: auth, webhook, upload, rate limit… | A | W8 | 1 | `todo` | — | — | — |
| `R-04` | Observability: log terstruktur, error tracking, a… | A | W8 | 1 | `todo` | — | — | — |
| `SA-03` | Endpoint /admin/integrations/health + biaya vendo… | A | W8 | 0,5 | `todo` | — | — | — |
| `SA-04` | Dasbor Retool: transaksi, harga, audit, health | A | W8 | 0,5 | `blocked` | — | 2026-09-20 | BLOCKED: butuh langganan Retool (blocker non-kode, `docs/reports/blocker-non-kode.pdf`) — isu #77. AC-nya "superadmin bisa bekerja tanpa membuka database" mustahil tanpa dasbornya. Panel `health` juga menunggu `SA-03`. Yang SUDAH ada: seluruh query-nya di `docs/retool/queries.sql`, diverifikasi berjalan sebagai role `strive_readonly` (6 test integrasi) dan tidak satu pun menyentuh tabel mentah. Saat lisensinya ada, perakitannya setengah jam. |
| `SA-05` | PATCH /admin/users/:id/role — ubah peran pengguna | A | W7 | 0,5 | `done` | #97 | 2026-09-21 | Butuh kode error baru: `ROLE_CHANGE_FORBIDDEN` ditambahkan ke PRD §10.2 lewat PR TERSENDIRI (#96) sebelum dipakai — yang pertama mengikuti urutan itu. Larangan 'ubah peran sendiri' saja TIDAK cukup: dua superadmin yang saling menurunkan bersamaan menyisakan NOL superadmin, permanen. Diverifikasi merah — tanpa advisory lock hitungannya nol di tengah jendela test. |
| `R-05` | Cadangan perbaikan bug | AB | W8 | 2 | `todo` | — | — | — |
| `MT-02` | Wawancara terpandu: bank soal statis + jawaban te… | B | W8 | 1,5 | `todo` | — | — | — |
| `MT-03` | Review personal statement (LLM terstruktur) | B | W8 | 1 | `todo` | — | — | — |
| `MT-04` | UI kedua modul Mastery | B | W8 | 1 | `todo` | — | — | — |
| `R-01` | E2E Playwright: daftar -> belajar -> streak -> to… | B | W8 | 1 | `todo` | — | — | — |

### Ringkasan progres

> Agent memperbarui tabel ini setiap kali sebuah item jadi `done`.
>
> **Rekonsiliasi (2026-09-19, A-03/PR #64):** `main` bergerak 11 item sementara PR #64 terbuka.
> Konflik di tabel ini diselesaikan mengikuti AGENTS.md aturan keras 11 — **dihitung ulang dari
> 74 baris item**, bukan memilih sisi. Kedua sisi salah: `HEAD` menulis 28 `done` (belum
> memasukkan A-03), PR #64 menulis 18 (basis lama). Jawaban benar **29**, dan tidak ada di
> salah satu sisi mana pun. Itu persis alasan aturan 11 ada.

| | Jumlah | Dev-hari |
|---|---:|---:|
| Total | 80 | 78,5 |
| `done` | 38 | 33,5 |
| `review` | 0 | 0,0 |
| `in_progress` | 0 | 0,0 |
| `blocked` | 4 | 4,5 |
| `todo` | 38 | 40,5 |

---
## Ringkasan per epik

| Epik | Nama | Hari | Item |
|---|---|---:|---:|
| `E0` | Fondasi & Setup | 10,5 | 12 |
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
| | **Total** | **73,0** | **74** |

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

> **Tidak lagi menahan item mana pun — 2026-09-20, keputusan Dev A (isu #70).**
>
> `F-05` dulu punya dua dependen: `K-01` dan `AI-01`. Lewat keduanya ia menahan **20 item
> (27% proyek)**. Keduanya diperiksa ulang terhadap acceptance criteria masing-masing dan
> terhadap `docs/PRD.md` §12, dan **tidak satu pun butuh lingkungan ter-deploy**:
>
> - `AI-01` — *"Hanya Core API yang bisa memanggil AI service (token bersama). Panggilan
>   tanpa token → 401."* Autentikasinya token bersama lewat env (`AI_SERVICE_TOKEN`), dan
>   `pnpm dev:ai` menjalankan FastAPI lokal.
> - `K-01` — *"Tipe berkas lain ditolak sebelum menyentuh storage. Berkas >25 MB ditolak."*
>   PRD §12 menyebut object storage dev-nya **MinIO lewat docker-compose**, hidup sejak `F-02`.
>
> Keduanya dipindah ke `F-02`, yang memang menyediakan infrastruktur lokalnya. Dugaan asal
> salahnya: dependensi ini ditulis saat `F-05` masih dibayangkan sebagai satu-satunya tempat
> infrastruktur berdiri, lalu `F-02` menyediakannya secara lokal dan tidak ada yang meninjau
> ulang.
>
> `F-05` tetap dibutuhkan sebelum rilis. Ia hanya berhenti menjadi prasyarat pekerjaan.

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

### `F-12` — Job bulanan pembuat partisi `lesson_attempts` + alarm partisi menipis

**0,5 hari** · Dev **A** · Minggu **W8** · Butuh: `F-04`

**Status:** lihat papan status di atas · **Selesai berarti:** Partisi bulan berjalan + satu bulan ke depan dibuat otomatis, idempoten (`CREATE TABLE IF NOT EXISTS … PARTITION OF`, dijalankan dua kali tidak error). Alarm menyala kalau partisi terjauh tinggal < 30 hari. Dibuktikan dengan memajukan tanggal di database uji, bukan dengan membaca kode.

> **Kenapa item ini ada.** `docs/PRD.md` §9.3 mewajibkannya satu kalimat, tapi tidak ada satu pun dari 73 item awal yang mengerjakannya — terlewat saat perencanaan (isu #14). `lesson_attempts` **tidak punya partisi DEFAULT**, dan itu disengaja: partisi default membuat penambahan partisi baru harus memindai seluruh isinya. Konsekuensinya, `INSERT` dengan `attempt_date >= 2027-03-01` **gagal**, bukan jatuh ke mana pun. `POST /attempts` adalah jantung sistem; kalau insert-nya gagal, pengguna berhenti bisa belajar sama sekali — bukan degradasi, tapi berhenti total, tanpa petunjuk ke penyebabnya.

## E1 · Auth & RBAC

> Beli, jangan bangun: Better-Auth. Tiga peran saja.

### `F-13` — Seed data dev: `pricing_config`, track contoh, store items

**0,5 hari** · Dev **A** · Minggu **W3** · Butuh: `F-04`

**Status:** lihat papan status di atas · **Selesai berarti:** `pnpm seed` pada database kosong menghasilkan stack yang bisa dipakai: satu `pricing_config` aktif, satu track lengkap sampai kartu, dan `store_items` yang bisa dibeli. Idempoten — dijalankan dua kali tidak menggandakan apa pun dan tidak error. Data yang sudah disentuh pengguna (attempt, ledger) tidak pernah ditimpa.

> **Kenapa item ini ada.** `pnpm seed` tercantum di `CLAUDE.md` sejak hari pertama dan
> `db/seeds/README.md` mengatribusikannya ke `F-04`. Tapi acceptance criteria resmi `F-04`
> tidak pernah menyebutnya — isinya 31 tabel, `pnpm db:types`, trigger immutable — dan `F-04`
> sudah `done` sejak 2026-09-15. Jadi perintah itu ada di dokumentasi, tidak ada di backlog,
> dan tidak akan pernah dikerjakan siapa pun (isu #69).
>
> Ini **pekerjaan yang jatuh di antara dua item**: jenis yang tidak muncul di papan status
> mana pun karena tidak pernah punya baris. Sampai sekarang ia menjawab dengan pesan
> "belum diimplementasikan — itu item `F-04`", yang menunjuk item yang sudah selesai.
>
> **W3, bukan W8.** `R-01` (E2E) dan `R-02` (load test) sama-sama butuh data, dan keduanya
> W8 — minggu yang sudah paling berat dan baru ditambahi `F-12`. Menaruh prasyaratnya di
> minggu yang sama dengan pemakainya berarti keduanya terdorong bersamaan kalau satu meleset.
>
> **Jangan dicampur dengan `pnpm seed:content` (`F-11`, Dev B).** Yang itu mengimpor konten
> belajar dari CSV/JSON dan sudah ada. Yang ini data dev untuk menjalankan aplikasi.

### `F-14` — API baca riwayat milik sendiri (7 rute lintas domain)

**1,5 hari** · Dev **A** · Minggu **W7** · Butuh: `L-03`, `K-02`, `PR-02`, `P-03`

**Status:** lihat papan status di atas · **Selesai berarti:** Ketujuh rute mengembalikan HANYA baris milik pemanggil — dibuktikan dengan mencoba membaca milik orang lain lewat `:id` tebakan di setiap rute, bukan di satu rute contoh. Cursor pagination memakai pola yang sama dengan `C-02`, dan cursor yang tidak bisa didekode menjawab `INVALID_CURSOR`, bukan 500.

> **Kenapa satu item, bukan tujuh.** Tujuh rute ini berbentuk **identik**: baca baris milik
> sendiri, cursor-paginated, kepemilikan dicek di service. Memecahnya jadi tujuh item
> menghasilkan tujuh PR yang menyalin pola yang sama tujuh kali; menggabungnya membuat polanya
> ditulis sekali dan diuji tujuh kali.
>
> | Rute | Domain |
> |---|---|
> | `GET /attempts` | riwayat attempt |
> | `GET /scans` | riwayat scan klinik |
> | `GET /reviews/mine` | review yang kutulis |
> | `GET /payments/orders/:id` | status order |
> | `GET /career/cv/:id` | hasil CV |
> | `GET /career/prompt-lab/history` | riwayat run |
> | `GET /mastery/sessions` | riwayat sesi |
>
> **W7, bukan lebih awal.** Membaca riwayat dari tabel yang belum ada yang menulisinya tidak
> bisa diuji dengan berarti. Dependensinya adalah item yang MENULIS barisnya.
>
> **Ditemukan penyisiran isu #88.** Tujuh-tujuhnya dijanjikan PRD §10.3 kepada klien dan tidak
> dimiliki item mana pun — pola yang sama dengan `F-12`, `F-13`, dan `Q-06`.

### `A-01` — Integrasi Better-Auth + adapter PostgreSQL + rotasi refresh token

**0,5 hari** · Dev **A** · Minggu **W2** · Butuh: `F-04`

**Status:** lihat papan status di atas · **Selesai berarti:** Register, login, logout, refresh jalan. Refresh token yang dipakai ulang mencabut seluruh sesi turunannya. Password di-hash Argon2id.

### `A-05` — API profil: `GET /me` + `PATCH /me`

**0,5 hari** · Dev **A** · Minggu **W2** · Butuh: `A-01`

**Status:** lihat papan status di atas · **Selesai berarti:** `GET /me` mengembalikan profil, peran, saldo koin, dan zona waktu dalam satu request. `PATCH /me` hanya menerima `display_name`, `timezone`, `avatar_url` — field lain diabaikan, bukan error. Zona waktu divalidasi IANA sama seperti registrasi (AU-7); nilai tidak dikenal ditolak, bukan diam-diam jadi Asia/Jakarta.

> **Kenapa item ini ada.** Keduanya ada di `docs/PRD.md` §10.3, dan `GET /me` bahkan ada di
> `ACCESS_MATRIX` — tapi **tidak ada item yang menjanjikan membangunnya** (isu #88). `A-01`
> hanya menjanjikan "register, login, logout, refresh jalan".
>
> Ini yang paling mendasar dari dua belas rute yatim: **setiap klien butuh `/me`** untuk tahu
> siapa yang sedang login. Tanpa itu, layar mana pun yang menampilkan nama atau saldo harus
> menebaknya dari respons login — yang basi begitu pengguna mengubah apa pun.

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

### `S-05` — `POST /streak/freeze/purchase` — beli kredit freeze

**0,5 hari** · Dev **A** · Minggu **W4** · Butuh: `S-01`, `C-01`

**Status:** lihat papan status di atas · **Selesai berarti:** Pembelian kedua di bulan yang sama ditolak, dan batas itu dihitung dalam **bulan lokal pengguna** — bukan bulan UTC. Saldo kurang ditolak sebelum entri apa pun ditulis. Debit koin dan penambahan kredit terjadi dalam satu transaksi.

> **Kenapa item ini ada.** `docs/PRD.md` §5 Q3 memutuskan kredit freeze "bisa dibeli: 200 koin
> per kredit, maksimal 1 pembelian per bulan", dan §10.3 mencantumkan endpointnya. `S-01`
> membangun `StreakService` termasuk kolom `freeze_credits` dan `freeze_purchased_month` —
> tapi acceptance criteria-nya soal zona waktu dan streak, tidak pernah menyebut pembelian
> (isu #88).
>
> **Ini jalur uang**, bukan layar: 200 koin berpindah, dan batas "1 per bulan" harus dihitung
> di zona waktu pengguna (aturan keras 5). Bulan UTC akan membuat pengguna WIB kehilangan
> jatah di hari terakhir bulan.

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

**1,5 hari** · Dev **B** · Minggu **W4** · Butuh: `Q-06`

**Status:** lihat papan status di atas · **Selesai berarti:** Papan tetap benar saat koneksi WS putus lalu pulih. Tanpa WS sama sekali, papan tetap terisi lewat polling.

### `Q-06` — API squad: `GET /squads/me` + `GET /squads/:id/leaderboard`

**0,5 hari** · Dev **A** · Minggu **W4** · Butuh: `Q-02`

**Status:** lihat papan status di atas · **Selesai berarti:** Kedua rute mengembalikan data yang sama dengan `SquadService`/`LeaderboardService`, dijaga peran sesuai `ACCESS_MATRIX`, dan anggota squad lain tidak bisa membaca papan squad yang bukan miliknya lewat `:id` tebakan.

> **Kenapa item ini ada.** Kedua rute tercantum di `docs/PRD.md` §10.3 **dan** di
> `ACCESS_MATRIX`, tapi tidak ada item yang membangunnya (isu #79). `Q-02` membuat
> `LeaderboardService` dan memenuhi AC-nya seluruhnya — AC itu berbunyi *"Redis di-FLUSHALL
> lalu papan pulih otomatis"*, soal service, bukan HTTP. Tidak ada yang salah dikerjakan;
> yang salah adalah tidak ada yang menjanjikan permukaan HTTP-nya.
>
> **Ini menahan `Q-05` (Dev B).** UI squad + leaderboard tidak bisa dibangun di atas endpoint
> yang tidak ada. Sebelum `Q-06` ada, `Q-05` terhitung "siap" di papan padahal tidak —
> itu jenis kebohongan papan yang paling mahal, karena baru ketahuan setelah orang mulai
> mengerjakannya.
>
> **0,5 hari itu realistis, bukan optimis:** kedua service sudah ada dan sudah diuji. Yang
> dibutuhkan controller + guard + baris `ACCESS_MATRIX` + test. Nol logika baru.
>
> Ditemukan saat `R-02` hendak mengukur leaderboard dan endpointnya tidak ada — bukan lewat
> pembacaan papan. Pola yang sama dengan `pnpm seed` (`F-13`, isu #69) dan job partisi
> (`F-12`, isu #14).

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

**1 hari** · Dev **A** · Minggu **W6** · Butuh: `F-02`

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

**1 hari** · Dev **B** · Minggu **W3** · Butuh: `F-02`

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

### `SA-05` — `PATCH /admin/users/:id/role` — ubah peran pengguna

**0,5 hari** · Dev **A** · Minggu **W7** · Butuh: `A-02`

**Status:** lihat papan status di atas · **Selesai berarti:** Hanya superadmin yang bisa memanggilnya. Setiap perubahan tercatat di `audit_log` **dengan pelakunya** dan peran lama. Superadmin tidak bisa menurunkan perannya sendiri — akun terakhir yang bisa menunjuk mentor tidak boleh bisa menghapus dirinya sendiri.

> **Kenapa item ini ada.** `docs/PRD.md` §5 Q6 memutuskan "penugasan oleh Superadmin", dan
> §10.3 mencantumkan endpointnya — tapi tidak ada item yang menjanjikannya (isu #88).
>
> Konsekuensinya sekarang: **peran hanya bisa diubah lewat SQL langsung**, dan itu justru yang
> dilarang `SA-2` ("semua aksi tulis lewat endpoint resmi, bukan SQL langsung"). Role
> `strive_readonly` yang dipakai Retool bahkan tidak bisa menulis sama sekali — jadi tidak ada
> jalur sah apa pun untuk menunjuk mentor pertama.

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
| W8 | 5,5 | 5,5 | 11 | **Kelebihan beban** — fitur + pengerasan + `F-12` bersamaan |
| | **37,75** | **35,25** | **73,0** | terhadap 68 tersedia |

> Batas sehat adalah 5 hari per orang per minggu. W1 (Dev A 5,25) dan W8 (**keduanya** 5,5) melewatinya — lihat `DELIVERY-PLAN.md` §7.

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
