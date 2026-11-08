# Laporan Auto Mode, 9 Nov 2026 (Kemal, Dev B)

Sesi background (auto mode) yang meneruskan serah terima AI-07 dari 5 Nov:
fondasi M1 sampai M4 sudah ada di branch, pekerjaan sesi ini adalah sisi Node
(M5), UI (M6), lalu gerbang verifikasi penuh (M7). Dua bug nyata ketemu dan
diperbaiki justru dari verifikasi browser, bukan dari penulisan kode: satu
bug pembukuan koin yang tidak pernah settle, satu bug replay idempotensi
yang membuat tombol Generate kedua mengembalikan hasil LAMA.

## Yang dikerjakan

1. **M5, sisi Node CV builder + finalisasi job `ats_cv`** (komit `40de038`).
   `CvBuilderService` satu transaksi: validasi kontrak, cek harga pricing,
   replay kunci idempotensi (KEY_CONFLICT 409), `users` FOR UPDATE,
   pastikan kuota AI gabungan, `jobs.buat` kind `ats_cv`, `coins.hold`
   refType `ai_job`; enqueue BullMQ SETELAH commit, respons 202.
   `CvFinalizeService` mengisi skor + temuan + PDF ke `cv_documents`,
   settle/release koin lewat CoinLedgerService saja. `GET
   /career/cv/jobs/:jobId`, baris ACCESS_MATRIX, whitelist isu #197,
   body parser 11 MB, hook penyedia di WorkerModule.
2. **M6, layar `/career`** (komit `7c246c7`): dua tab (ATS CV + Prompt
   Lab), form sumber profil/unggah + target role + bahasa, biaya dari
   pricing nyata, polling job, layar skor + temuan + unduh PDF, responsif
   375 px.
3. **Verifikasi browser nyata (Playwright MCP, stack e2e terisolasi)**:
   DB `strive_e2e`, API :3002, worker terpisah, web :3005, layanan AI
   uvicorn :8000 dengan stub LLM di :59998 lewat setelan baru
   `LLM_BASE_URL`. Jalur emas: 202 → selesai ±2 dtk → skor 34/100 dengan
   5 temuan (skor rendah itu JUJUR: penjaga anti-halusinasi memangkas
   kontak yang dikarang stub) → PDF diunduh via URL presigned MinIO
   (HTTP 200, 1.780 byte, 1 halaman). Console bersih, nol request 4xx/5xx
   pasca-login, 375 px tanpa scroll horizontal, pulih tab menjaga hasil.
   6 screenshot di `docs/reports/AI-07/images/`.
4. **Bug #1 ditemukan dari saldo yang tidak kembali**: setelah job gagal,
   saldo 600 menggantung, hold tanpa release. Akar: binding
   `PENYELESAI_JOB_AI` tidak diekspor CareerModule sehingga `@Optional()`
   diam-diam menyuntik `[]`, dan bentuk binding tunggal vs kontrak array.
   Semua hook finalisasi no-op tanpa error sedikit pun. Diperbaiki
   `07d2333` (ekspor + `useFactory` array) + penjaga integrasi baru yang
   memerah kalau binding bukan array atau tidak berisi kind `ats_cv`.
   Bukti ulang: hold −400 lalu release +400, saldo kembali 1.000.
5. **Bug #2 ditemukan dari log jaringan**: klik Generate kedua setelah
   hasil tampil mengembalikan job LAMA (id sama di dua request berbeda).
   Akar: kunci idempotensi tidak pernah diputar dari keadaan terminal
   (perilaku replay #245 di sisi server memang benar, klien yang salah).
   Diperbaiki `9831e6f`: `kunciPercobaanBaru()` memutar kunci dari
   `selesai`/`gagalJob`, mempertahankannya dari `idle` (retry jaringan =
   percobaan sama). Dibuktikan live: job gagal baru → pesan galat + UI
   pulih → percobaan ulang sukses 34/100.
6. **Audit `agent-security` atas diff AI-07** (wajib, dijalankan sebelum
   PR): 0 kritis/tinggi, 4 temuan di bawahnya SEMUA dipasang di `dad03f9`
   plus test pengunci: T1 sedang (field `judul` vs `posisi` lintas
   kontrak Node/Python: 422 deterministik SETELAH hold + kuota terbakar),
   T2 rendah (base64 berseling newline diterima Node, ditolak Python),
   T3 rendah (`website`/`jurusan` dibungkam diam-diam Pydantic), C1 info
   (penjaga produksi untuk `LLM_BASE_URL`). Detail di
   `docs/reports/AI-07/index.html` bagian 7.
7. **Rebase ke origin/main** (10 PR baru dari Dev A/tim): branch membawa
   duplikat pra-squash dari PR lama (PL-01, PL-02, PR-03, PR-04, papan);
   rebase `--empty=drop` + ambil sisi main untuk semua konflik duplikat
   (BACKLOG, api-client, lockfile, pengecualian.json, laporan PR-03).
   Komit dependensi better-auth saya sendiri (d5a4b35) menjadi kosong
   karena main sudah menaikkannya lewat #263: dijatuhkan, tidak
   dijatuhkan diam-diam. Sisa 13 komit, semua milik AI-07 + rekap harian
   26-30 Okt yang memang belum pernah ke main.
8. **Laporan**: harian 02-06 Nov (`daily-02-06-nov.md`, 5 hari, format
   sama dengan minggu sebelumnya), E2E AI-07 (`docs/reports/AI-07/`,
   HTML self-contained + 6 screenshot + katalog regresi 2 bug), laporan
   ini, papan BACKLOG direcompute (AI-07 → review, K-04 → blocked
   beralasan), HANDOFF diperbarui.

## Perintah verifikasi + hasil (dijalankan nyata, setelah perubahan terakhir)

Rangkaian gerbang penuh dijalankan satu urutan di atas pohon hasil rebase
(sebelum push), semua proses dev dimatikan dulu:

| Perintah | Hasil |
|---|---|
| `pnpm lint` | OK |
| `pnpm typecheck` | OK |
| `pnpm test` | OK: contracts 6, web 178, api 362 |
| `pnpm --filter @strive/api test:integration` (DATABASE_URL+REDIS_URL) | OK: 631/631 lintas 52 berkas (milik AI-07: cv-builder 27, ai-dispatch 27, worker-boot 4) |
| `services/ai/.venv/bin/pytest -q` | OK: 149 passed |
| `pnpm build` | OK |
| `pnpm audit:kebijakan` | OK: 11 tinggi/kritis · 11 dikecualikan · 0 baru · 0 pengecualian basi (set pengecualian murni milik main; perpanjangan braces tidak diperlukan) |

Verifikasi nyata lain: pembukuan koin dicek langsung ke tabel
(`coin_ledger` + `audit_log`): saldo akhir 200, 3 `coin.settle`, 2
`coin.release`, baris orphan pra-perbaikan dibiarkan sebagai bukti bug
(dikompensasi entri adjust karena trigger append-only). Sabotase penjaga:
enqueue-setelah-commit dan kuota (sesi sebelumnya), penjaga worker-boot
diverifikasi memerah saat binding dikembalikan ke cacat.

## Yang gagal / dilewati, beserta alasan

- **Unggah PDF dari browser tidak diklik** di stack e2e (sumber profil
  yang dipakai jalur emas). Jalur unggah tercakup integrasi 27/27
  (base64, tipe, ukuran, kepemilikan upload_id) + normalisasi newline
  T2; interaksi UI-nya belum pernah dilihat mata. Dicatat sebagai batasan
  di laporan E2E.
- **Bahasa `en` tidak diuji** (semua verifikasi memakai `id`). Kontrak
  mengizinkan keduanya; perbedaannya hanya instruksi prompt, tidak ada
  cabang kode khusus.
- **`POLLING_TIMEOUT` UI tidak dipicu live** (job stub selesai ±2 dtk,
  timeout 60 dtk tidak pernah tercapai). Perilakunya dikunci unit test
  mesin state, bukan browser.
- **Konten LLM sungguhan tidak diuji**: stub mengembalikan StructuredCV
  tetap; variasi keluaran vendor (retry, LLM_OUTPUT_INVALID) diuji lewat
  test layanan AI, bukan stack ini. Kunci vendor memang kosong di dev
  (#90).
- **Docker CLI tidak ada di distro WSL ini**: kontainer PG/Redis/MinIO
  sudah berjalan (dikelola dari luar), sesi ini hanya memakainya; tidak
  bisa `docker ps` untuk bukti, koneksi diverifikasi lewat klien
  (psql/redis-cli berhasil) dan aplikasi.
- **Gate kedua (pra-audit-fix) dihentikan di tengah**: perbaikan audit
  mengubah kode yang sedang diuji; menjalankan rangkaian di atas kode
  basi hanya membuang waktu. Rangkaian final di atas dijalankan penuh di
  atas hasil rebase.

## Kelemahan fondasi yang ditemukan dan penanganannya

1. **Worker live mencuri job BullMQ dari suite integrasi** di Redis
   bersama (dev stack hidup saat `test:integration`): 19 test merah
   karena job-nya dikerjakan proses lain. Penanganan proses: matikan
   SEMUA proses dev sebelum suite; dicatat di HANDOFF agar tidak
   terulang.
2. **Trigger append-only `coin_ledger` menolak DELETE** bahkan untuk
   membereskan data rusak akibat bug sendiri. Penanganan: entri
   `adjust` pengompensasi, tidak melawan penjaga (penjaganya benar;
   data buktinya memang harus tinggal).
3. **Kelas bug "hijau tapi rusak" di DI Nest**: provider tidak diekspor
   dari modul + `@Optional()` = injeksi `[]` diam-diam, semua test unit
   tetap hijau karena tidak ada yang menegaskan bentuk binding.
   Penanganan: penjaga integrasi baru menegaskan binding berupa array
   berisi kind `ats_cv` + komentar di career.module.ts mendokumentasikan
   kelas bug ini untuk pendaftaran penyedia kedua di masa depan.
4. **Idempotensi server benar, klien yang harus tahu**: replay #245
   mengembalikan job sama untuk kunci sama (perilaku diinginkan), tetapi
   UI harus memutar kunci dari keadaan terminal. Pelajaran dicatat di
   komentar `kunciPercobaanBaru()` dan laporan E2E.

## Commit dan perubahan

Branch `ai07-cv-builder` di atas `origin/main` (setelah rebase 9 Nov):
13 komit, `eefe2ba` (M1) sampai `dad03f9` (tindak lanjut audit), termasuk
`d9beea5` (rekap harian 26-30 Okt yang belum pernah sampai main) dan
`72c6f82` (perbaikan typecheck test). PR **#267** dibuka base `main`,
reviewer Fatihmaull. Papan BACKLOG: AI-07 → `review` #267, K-04 →
`blocked` (K-03 menunggu kredensial Copyleaks #90; multer masih nol
pemakaian), ringkasan direcompute dan divalidasi awk (done 68 (65,0) ·
review 1 (1,0) · in_progress 0 · blocked 6 (6,0) · todo 5 (6,5) = 80 /
78,5). Akun push kemalzaki (satu-satunya, `gh auth status`). Isu #207
ditutup hanya setelah merge.

**Catatan push:** branch ini sudah pernah terdorong 5 Nov (sebelum
rebase) dan tertinggal di komit M4 `341a1f1`. Setelah rebase riwayatnya
berubah, jadi push memakai `--force-with-lease` (ditolak kalau remote
bergerak sejak fetch terakhir). Aman karena isi remote saat itu murni
komit lama saya sendiri (0 komit milik orang lain, diverifikasi dengan
membandingkan remote terhadap cadangan pra-rebase). Branch terlindungi
tidak disentuh; sesuai serah terima yang mengizinkan rebase branch
milik sendiri.
