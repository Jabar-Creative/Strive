# PRD — Strive Academy

**Product Requirements Document · end-to-end**

| | |
|---|---|
| **Versi** | 2.3 |
| **Tanggal** | 17 September 2026 |
| **Status** | Siap implementasi — **§5 TERKUNCI 14 September 2026** |
| **Scope** | B2C murni. Tanpa multi-tenancy, tanpa Web3, tanpa hardware NFC. |
| **Dokumen terkait** | `BACKLOG.md` (estimasi) · `DELIVERY-PLAN.md` (jadwal) · `CLAUDE.md` (konvensi kode) |

> **Dokumen ini adalah sumber kebenaran PERILAKU.** Kalau kode berbeda dari dokumen ini, kodenya yang salah — kecuali ada catatan perubahan yang ditandatangani di §23.

---

## Daftar isi

1. [Visi & non-goals](#1-visi--non-goals)
2. [Persona & RBAC](#2-persona--rbac)
3. [Glosarium](#3-glosarium)
4. [Peta fitur](#4-peta-fitur)
5. [Delapan keputusan produk terkunci](#5-delapan-keputusan-produk-terkunci)
6. [Ekonomi koin](#6-ekonomi-koin)
7. [Spesifikasi fungsional per epik](#7-spesifikasi-fungsional-per-epik)
8. [Arsitektur sistem](#8-arsitektur-sistem)
9. [Skema database](#9-skema-database)
10. [API spec](#10-api-spec)
11. [Kanal realtime](#11-kanal-realtime)
12. [Integrasi eksternal](#12-integrasi-eksternal)
13. [AI pipeline](#13-ai-pipeline)
14. [Design system](#14-design-system)
15. [Non-functional requirements](#15-non-functional-requirements)
16. [Keamanan & privasi](#16-keamanan--privasi)
17. [Observability & alerting](#17-observability--alerting)
18. [Strategi testing](#18-strategi-testing)
19. [Environment & deployment](#19-environment--deployment)
20. [Analytics & metrik sukses](#20-analytics--metrik-sukses)
21. [Risiko produk](#21-risiko-produk)
22. [Out of scope](#22-out-of-scope)
23. [Catatan perubahan](#23-catatan-perubahan)

---

## 1. Visi & non-goals

### 1.1 Satu kalimat

Strive Academy adalah platform belajar-karir B2C untuk mahasiswa Indonesia yang **membuat orang kembali setiap hari** lewat loop gamifikasi, lalu **menghasilkan uang** lewat alat akademik dan karir yang mereka butuhkan saat itu juga.

### 1.2 Dua mesin

| Mesin | Fungsi | Fitur |
|---|---|---|
| **Retensi** | Membuat orang membuka aplikasi tiap hari | Career Streak, kartu bite-sized, Squad & liga, Strive Coins, notifikasi |
| **Monetisasi** | Mengubah kebiasaan jadi pendapatan | Klinik plagiarisme, ATS CV builder, Mastery Track, Store |

Mesin retensi tidak menghasilkan uang secara langsung. Mesin monetisasi tidak membuat orang kembali. **Keduanya harus ada, dan keduanya harus terhubung lewat koin** — koin yang diperoleh dari belajar mengurangi biaya alat berbayar, sehingga belajar punya nilai rupiah yang bisa dirasakan.

### 1.3 Target pengguna

- Mahasiswa S1 Indonesia semester 5–8 yang sedang menyusun skripsi/proposal
- Fresh graduate yang sedang melamar kerja
- Pencari beasiswa S2 luar negeri (segmen kecil, dilayani Mastery Track)

Bahasa antarmuka: **Bahasa Indonesia**. Zona waktu default: **Asia/Jakarta**. Mata uang: **IDR**.

### 1.4 Non-goals (versi 1)

Yang secara sadar **tidak** dibangun, dan alasannya:

| Non-goal | Alasan |
|---|---|
| B2B / multi-tenancy / white-label | Produk berbeda dengan siklus jual berbeda. Menambahkan `tenant_id` sekarang berarti setiap query membawa beban yang tidak dipakai siapa pun. |
| Blockchain / sertifikat on-chain | Nilai bagi lulusan adalah "HRD bisa mengecek", bukan "ada di blockchain". Credential bertanda tangan + halaman verifikasi mencapai itu tanpa satu pun dependensi chain. |
| Kartu NFC fisik | Biaya sebenarnya ada di fulfillment dan penanganan kartu rusak, bukan di kode. |
| Aplikasi native iOS/Android | PWA responsif cukup untuk beta. Native menambah dua pipeline rilis. |
| Live class / video conference | Bukan bagian dari loop harian, dan biaya infrastrukturnya tidak sebanding. |
| Marketplace mentor berbayar | Menambah sisi supply yang harus diakuisisi terpisah. |

---

## 2. Persona & RBAC

Tepat **tiga peran**. Disimpan sebagai `users.role` bertipe ENUM — bukan tabel keanggotaan, karena tanpa multi-tenancy tidak ada relasi banyak-ke-banyak.

### 2.1 Student

Pengguna utama. Semua orang yang mendaftar sendiri jadi Student.

**Bisa:** belajar, menjaga streak, ikut squad, melihat leaderboard, memberi peer review, beli koin, scan plagiarisme, generate CV, pakai Mastery Track & Prompt Lab, belanja di store, mengelola profilnya sendiri.

**Tidak bisa:** melihat data pengguna lain selain nama & avatar di leaderboard, mengakses `/console`, mengubah harga apa pun.

### 2.2 Mentor / Validator

Ditunjuk Superadmin. Membina satu atau lebih squad.

**Bisa:** semua yang Student bisa (mentor juga belajar), plus melihat progres anggota squad binaannya, memvalidasi peer review, memberi catatan, melihat anggota yang berisiko putus streak.

**Tidak bisa:** melihat squad yang bukan binaannya, mengubah saldo koin siapa pun, mengakses `/admin`.

### 2.3 Superadmin

Operator platform.

**Bisa:** melihat semua transaksi dan audit log, mengubah harga koin (menerbitkan versi baru), menunjuk mentor, melihat health & biaya vendor, melakukan koreksi saldo lewat entri `adjust` yang tercatat.

**Tidak bisa:** hal-hal yang hanya masuk akal untuk Student. Superadmin **tidak otomatis lolos** rute `POST /attempts`, `POST /scans`, dsb. — akses istimewa yang diam-diam meluas adalah cara paling umum panel admin berubah jadi lubang keamanan.

### 2.4 Matriks akses

Ditulis sebagai konstanta `ACCESS_MATRIX` di kode dan diuji otomatis. Setiap baris di bawah wajib punya test yang membuktikan peran lain ditolak.

| Endpoint | Student | Mentor | Superadmin |
|---|:---:|:---:|:---:|
| `POST /auth/*` | publik | publik | publik |
| `GET /me` | ✓ | ✓ | ✓ |
| `GET /hub` | ✓ | ✓ | ✗ |
| `GET /tracks`, `/lessons/:id/cards` | ✓ | ✓ | ✗ |
| `POST /attempts` | ✓ | ✓ | ✗ |
| `GET /streak`, `POST /streak/freeze` | ✓ | ✓ | ✗ |
| `GET /squads/me`, `/squads/:id/leaderboard` | ✓ | ✓ | ✗ |
| `GET /leagues/:season/:tier` | ✓ | ✓ | ✗ |
| `GET /reviews/queue`, `POST /reviews/:id` | ✓ | ✓ | ✗ |
| `GET /wallet`, `/wallet/ledger` | ✓ | ✓ | ✗ |
| `POST /payments/checkout` | ✓ | ✓ | ✗ |
| `POST /webhooks/payment` | — signature, bukan JWT — |
| `GET /store/items`, `POST /store/purchase` | ✓ | ✓ | ✗ |
| `POST /scans`, `GET /scans/:id` | ✓ | ✓ | ✗ |
| `POST /career/cv`, `/career/prompt-lab/run` | ✓ | ✓ | ✗ |
| `POST /mastery/*` | ✓ | ✓ | ✗ |
| `GET /ai/jobs/:id` | ✓ (miliknya) | ✓ | ✓ |
| `GET /mentor/queue`, `/mentor/squads` | ✗ | ✓ | ✓ |
| `POST /mentor/reviews/:id/validate` | ✗ | ✓ | ✗ |
| `GET /admin/*` | ✗ | ✗ | ✓ |
| `PATCH /admin/pricing` | ✗ | ✗ | ✓ |

### 2.5 Kepemilikan sumber daya

Guard menjawab **"peran ini boleh masuk rute ini?"**. Guard **tidak** menjawab **"sumber daya ini milik siapa?"** — itu dicek di service, karena hanya service yang tahu bentuk relasinya.

Aturan kepemilikan yang berlaku:

- Student hanya boleh membaca/mengubah baris yang `user_id`-nya sama dengan `sub` di JWT-nya.
- Mentor boleh membaca data anggota squad yang `squads.mentor_id`-nya sama dengan dirinya.
- Reviewer tidak boleh melihat identitas penulis yang direviewnya (dihilangkan di serializer, bukan hanya disembunyikan di UI).
- Superadmin boleh membaca semua, tapi setiap pembacaan data pribadi tercatat di `audit_log`.

---

## 3. Glosarium

Istilah domain yang dipakai konsisten di kode, UI, dan dokumen. **Jangan membuat sinonim.**

| Istilah | Arti | Nama di kode |
|---|---|---|
| **Micro-task** | Satu unit kerja yang menghitung untuk streak: menyelesaikan satu lesson atau satu peer review | — |
| **Lesson** | Satu sesi belajar 2–3 menit berisi 3–5 kartu | `lessons` |
| **Kartu** | Satu pertanyaan/interaksi di dalam lesson | `lesson_cards` |
| **Attempt** | Satu kali pengguna menyelesaikan lesson | `lesson_attempts` |
| **Track** | Jalur kompetensi (Public Relations, Content, Graphic Design) | `tracks` |
| **Modul** | Kelompok lesson di dalam track | `modules` |
| **Streak** | Jumlah hari berturut-turut pengguna menyelesaikan ≥1 micro-task | `streaks` |
| **Freeze credit** | Kredit untuk menyelamatkan streak satu hari | `streaks.freeze_credits` |
| **Squad** | Kelompok belajar 8–12 orang | `squads` |
| **Liga / tier** | Bronze, Silver, Gold | `league_tier` |
| **Musim** | Satu periode liga = satu minggu ISO, kode `2026-W37` | `league_seasons` |
| **Strive Coin / koin** | Mata uang internal. Non-transferable, non-refundable. | `coin_ledger` |
| **Ledger** | Catatan append-only seluruh perpindahan koin | `coin_ledger` |
| **Hold** | Koin ditahan untuk pekerjaan yang belum tentu berhasil | `coin_entry='hold'` |
| **Settle** | Hold jadi permanen karena pekerjaan berhasil | — (audit_log) |
| **Release** | Hold dikembalikan karena pekerjaan gagal | `coin_entry='release'` |
| **Quest harian** | Target 3 micro-task per hari | `daily_quests` |
| **Klinik** | Layanan scan plagiarisme berbayar | `plagiarism_scans` |
| **Mastery Track** | Modul persiapan studi lanjut ke luar negeri | `mastery_sessions` |
| **Outbox** | Tabel peristiwa untuk menjembatani Postgres ke Redis/WS | `outbox_events` |

---

## 4. Peta fitur

| Epik | Nama | Mesin | Kedalaman v1 | Prioritas |
|---|---|---|---|---|
| `E0` | Fondasi & setup | — | penuh | P0 |
| `E1` | Auth & RBAC | — | penuh (dibeli) | P0 |
| `E2` | Learning engine | Retensi | v0.1 | P0 |
| `E3` | Career Streak | Retensi | penuh | P0 |
| `E4` | Coin & wallet | Keduanya | **penuh** | P0 |
| `E5` | Squad & liga | Retensi | v0.1 | P0 |
| `E6` | Payment | Monetisasi | penuh (dibeli) | P0 |
| `E7` | Klinik plagiarisme | Monetisasi | **penuh** | P0 |
| `E8` | ATS CV builder | Monetisasi | v0.1 | P1 |
| `E9` | Panel Superadmin | — | v0.1 (dibeli) | P1 |
| `E10` | Pengerasan & rilis | — | **penuh** | P0 |
| `E11` | Peer review & mentor | Retensi | v0.1 | P1 |
| `E12` | Mastery Track | Monetisasi | v0.1 | P2 |
| `E13` | Prompt Lab | Monetisasi | v0.1 | P2 |
| `E14` | Strive Store | Retensi | v0.1 | P2 |
| `E15` | Realtime | Retensi | v0.1 | P2 |
| `E16` | Notifikasi | Retensi | v0.1 | P1 |

---

## 5. Delapan keputusan produk terkunci

> **Status: TERKUNCI · 14 September 2026 · pemutus: Fatih Maulana.**
>
> Kedelapan jawaban di bawah disetujui **apa adanya**. Tidak ada satu pun angka
> yang berubah saat penguncian — yang berubah hanya statusnya.
>
> Setiap angka sudah dipakai konsisten di seluruh dokumen ini, skema database,
> dan seed. **Mengubahnya sekarang berarti migrasi data.** Dibuka kembali hanya
> lewat baris baru di §23 dengan **alasan baru**, bukan lewat diskusi ulang.
>
> **`F-04` (migrasi `001_init.sql`) tidak lagi terblokir dari sisi keputusan.**
> `pricing_config`, `streaks.freeze_credits`, `streaks.freeze_purchased_month`,
> dan ukuran squad boleh ditulis di atas angka-angka ini.

> ### Dua kewajiban yang TIDAK ikut terkunci
>
> Penguncian ini mengunci **keputusan produk**, bukan menggugurkan dua hal yang
> masih harus dikerjakan manusia. Keduanya memblokir **pembukaan top-up ke
> publik**, bukan pengembangan.
>
> **1 · Konsultasi hukum (Q2).** Koin non-transferable, non-refundable, dan
> tidak kedaluwarsa dirancang agar statusnya voucher sekali pakai — bukan alat
> pembayaran. **Konsultasi harus selesai sebelum top-up dibuka, bukan sesudah.**
>
> **2 · Harga kontrak Copyleaks (Q7).** Harga ke pengguna terkunci di 2.400 koin
> (cache hit 240). **Biaya vendor di §6.4 masih ILUSTRASI** dengan asumsi
> Rp 2.000 per 1.000 kata. Begitu harga kontrak aktual diketahui, hitung ulang
> margin dengan formula §6.4 — dan kalau biaya vendor ternyata lebih tinggi,
> **naikkan harga scan, jangan menipiskan margin.**

### Q1 — Berapa nilai satu koin?

**Keputusan: 1 koin = Rp 25.**

Alasan: angka bulat, cukup kecil agar hadiah 20 koin terasa seperti "sesuatu" tanpa inflasi, dan cukup besar agar harga scan tidak jadi angka enam digit yang menakutkan.

### Q2 — Koin hasil belajar dan koin hasil beli: satu saldo atau dua?

**Keputusan: satu saldo, dua jejak.**

`users.coin_balance` tunggal. `coin_ledger.entry_type` membedakan asalnya (`earn_lesson`, `earn_streak`, `earn_review` vs `purchase`), sehingga akuntansi tetap bisa memisahkan koin berbayar dari koin hadiah tanpa membebani UI.

**Konsekuensi hukum yang harus dijaga:** koin **tidak bisa dipindahkan antar pengguna**, **tidak bisa diuangkan**, dan **tidak kedaluwarsa**. Ini membuatnya voucher sekali pakai, bukan alat pembayaran. **Konsultasikan ke penasihat hukum sebelum top-up dibuka ke publik** — bukan sesudah.

### Q3 — Berapa kredit freeze, dan diperoleh bagaimana?

**Keputusan:**
- 1 kredit gratis setiap awal bulan kalender (waktu lokal pengguna)
- Maksimal disimpan: 2
- Bisa dibeli: 200 koin per kredit, maksimal 1 pembelian per bulan
- Freeze hanya berlaku untuk **hari berjalan**, dipakai maksimal sekali per hari

Alasan: terlalu murah, streak kehilangan makna; terlalu mahal, pengguna berhenti setelah putus sekali.

### Q4 — Squad dibentuk otomatis atau dipilih sendiri?

**Keputusan: otomatis.**

Job mingguan menempatkan pengguna aktif ke squad 8–12 orang, dikelompokkan berdasarkan rata-rata poin 2 minggu terakhir agar liga kompetitif. Pengguna baru masuk squad pada Senin pertama setelah menyelesaikan lesson pertamanya.

Alasan: dipilih sendiri lebih kuat secara sosial tapi menghasilkan squad timpang, dan butuh UI undangan yang tidak muat di v1.

### Q5 — Apa yang terjadi pada poin liga saat seseorang pindah squad di tengah minggu?

**Keputusan: poin tidak ikut pindah.**

- Baris `squad_members` lama diberi `left_at`, poinnya tetap tercatat di squad lama untuk musim itu
- Baris baru dimulai dari `weekly_points = 0`
- Maksimal 1 perpindahan per musim per pengguna

Alasan: tanpa aturan ini ada eksploitasi jelas — pindah ke squad yang hampir menang di hari terakhir.

### Q6 — Satu mentor membina berapa squad, dan siapa yang menugaskan?

**Keputusan: satu mentor boleh membina banyak squad; penugasan oleh Superadmin.**

Cukup kolom `squads.mentor_id`. Tidak perlu tabel penugasan terpisah karena relasinya satu-ke-banyak, bukan banyak-ke-banyak.

### Q7 — Vendor plagiarisme mana, dan berapa harga ke pengguna?

**Keputusan: Copyleaks sebagai vendor pertama, dengan antarmuka provider di kode sejak awal.**

Harga ke pengguna: **2.400 koin (Rp 60.000)** untuk dokumen sampai 15.000 kata. Cache hit (dokumen identik pernah discan): **240 koin (Rp 6.000)**.

> **Angka biaya vendor di §6 adalah ilustrasi** dengan asumsi Rp 2.000 per 1.000 kata. **Ganti dengan harga kontrak aktual sebelum top-up dibuka.** Formula margin ada di §6.4 — kalau harga vendor berbeda, sesuaikan harga koin, bukan margin.

### Q8 — Zona waktu default pengguna baru?

**Keputusan: deteksi dari browser saat registrasi, fallback `Asia/Jakarta`.**

- Diambil dari `Intl.DateTimeFormat().resolvedOptions().timeZone`
- Divalidasi terhadap daftar IANA; kalau tidak dikenal → `Asia/Jakarta`
- Bisa diubah di profil
- **Perubahan zona waktu tidak retroaktif** — `last_activity_date` yang sudah tercatat tidak dihitung ulang

Alasan: terdengar sepele, tapi ini menentukan kapan streak putus untuk setiap pengguna di sistem.

---

## 6. Ekonomi koin

### 6.1 Perolehan

| Sumber | Koin | Nilai | Batas |
|---|---:|---:|---|
| Menyelesaikan 1 lesson | 20 | Rp 500 | Sekali per lesson per hari |
| Peer review disetujui mentor | 15 | Rp 375 | Maks 5 review berpoin/hari |
| Bonus streak hari ke-3 | 30 | Rp 750 | Sekali |
| Bonus streak hari ke-7 | 70 | Rp 1.750 | Sekali |
| Bonus streak hari ke-14 | 140 | Rp 3.500 | Sekali |
| Bonus streak hari ke-30 | 300 | Rp 7.500 | Sekali |
| Bonus streak hari ke-60 | 600 | Rp 15.000 | Sekali |
| Bonus streak hari ke-100 | 1.000 | Rp 25.000 | Sekali |

Koin per lesson diskalakan dengan skor:

```
coins = max(5, round(base_coins × (0,4 + (score / 100) × 0,6)))
points = max(1, round(base_points × (0,5 + score / 200)))
```

Skor 0 tetap memberi 5 koin. **Menghukum percobaan yang jujur membuat orang berhenti mencoba.**

### 6.2 Pembelanjaan

| Item | Koin | Nilai |
|---|---:|---:|
| Scan plagiarisme (≤15.000 kata) | 2.400 | Rp 60.000 |
| Scan cache hit (dokumen identik) | 240 | Rp 6.000 |
| ATS CV generate | 400 | Rp 10.000 |
| Mastery: sesi wawancara | 300 | Rp 7.500 |
| Mastery: review personal statement | 500 | Rp 12.500 |
| Prompt Lab run | 20 | Rp 500 |
| Kredit freeze | 200 | Rp 5.000 |
| Item store | 300–1.500 | Rp 7.500–37.500 |

### 6.3 Paket top-up

| Paket | Koin | Harga | Efektif |
|---|---:|---:|---:|
| Starter | 1.000 | Rp 25.000 | Rp 25,0/koin |
| Reguler | 2.200 | Rp 50.000 | Rp 22,7/koin |
| Skripsi | 4.800 | Rp 100.000 | Rp 20,8/koin |

### 6.4 Uji kelayakan

**Sisi pengguna.** Pengguna rajin 30 hari (3 lesson/hari) memperoleh 90 × 20 = 1.800 koin, plus bonus streak hari ke-3/7/14/30 = 540 koin. **Total 2.340 koin = 0,97 scan.**

Ini disengaja: sebulan belajar rajin membawa pengguna **hampir** ke satu scan gratis, cukup dekat untuk memotivasi tapi tidak cukup untuk menggratiskan. Sisanya ditutup dengan top-up kecil.

**Sisi platform.**

```
Pendapatan per scan     Rp 60.000
Biaya vendor            Rp 24.000   (12.000 kata @ Rp 2.000/1.000 kata — ILUSTRASI)
Fee payment gateway     Rp  1.740   (2,9%)
──────────────────────────────────
Margin kotor            Rp 34.260   (57%)
```

Cache hit: pendapatan Rp 6.000, biaya vendor Rp 0 → margin ~97% setelah fee.

**Aturan penetapan harga:** harga koin ditetapkan di atas **biaya vendor terburuk**, bukan rata-rata. Kalau harga Copyleaks aktual lebih tinggi dari asumsi, naikkan harga scan — jangan menipiskan margin.

### 6.5 Batas penyalahgunaan

| Batas | Nilai | Alasan |
|---|---|---|
| Lesson berhadiah per hari | Tidak dibatasi jumlah, tapi 1× per lesson per hari | Mencegah farming satu lesson mudah |
| Peer review berpoin per hari | 5 | Mencegah review asal-asalan demi koin |
| Run AI (CV + Prompt Lab + Mastery) per hari | 10 | Mengendalikan biaya LLM |
| Scan per hari | 3 | Mencegah abuse kuota vendor |
| Pembelian kredit freeze per bulan | 1 | Menjaga makna streak |
| Rate limit global per pengguna | 120 req/menit | — |

---

## 7. Spesifikasi fungsional per epik

Format tiap epik: **Tujuan → Aturan bisnis → Acceptance criteria → Kasus tepi**. Acceptance criteria ditulis Given/When/Then agar bisa langsung jadi test.

---

### 7.0 Konvensi penomoran

Dua sistem ID dipakai di proyek ini dan **tidak boleh tertukar**:

| Bentuk | Contoh | Artinya | Ada di |
|---|---|---|---|
| Prefiks + **satu/dua digit** tanpa nol di depan | `CO-7`, `SK-10`, `LE-3` | **Aturan bisnis** di dokumen ini | `PRD.md` saja |
| Prefiks + **dua digit dengan nol di depan** | `C-01`, `ST-02`, `L-03` | **Item backlog** yang dikerjakan | `BACKLOG.md`, branch, commit, PR |

Prefiks aturan per epik: `AU` auth · `LE` learning · `SK` streak · `CO` coin · `SQ` squad · `PA` payment · `KL` klinik · `CV` ATS CV · `SA` superadmin · `PR` peer review · `MT` mastery · `PL` prompt lab · `SR` store · `RT` realtime · `NO` notifikasi.

---

### E1 · Auth & RBAC

**Tujuan.** Pengguna bisa masuk, dan sistem tahu dia siapa dan boleh apa.

**Implementasi:** Better-Auth dengan adapter PostgreSQL. Jangan menulis logika auth sendiri.

> **Keputusan isu #18 — skema mengikuti Better-Auth, bukan sebaliknya (jalan 1).**
>
> §9 versi awal mendefinisikan skema untuk auth **yang ditulis sendiri**, dan itu bertentangan
> dengan kalimat di atas. Pertentangannya nyata, bukan soal penamaan: Better-Auth 1.7.5
> menyimpan password di tabel **`account`** (`providerId: "credential"`), bukan di
> `users.password_hash`. Beda tabel tidak bisa dipetakan lewat konfigurasi.
>
> **Yang berubah di `A-01`:**
> - Tabel baru **`account`** dan **`verification`** → jumlah tabel domain **31 → 33**
> - Kolom **`session.token`** ditambahkan
> - **`users.password_hash` jadi NULLABLE** dan berhenti dipakai. Sekarang ia `NOT NULL`;
>   Better-Auth tidak akan mengisinya, jadi insert pengguna baru **gagal** kalau ini terlewat
> - **`refresh_tokens` dipertahankan tapi tidak dipakai**, dibuang di migrasi terpisah setelah
>   `A-01` stabil (forward-only, expand/contract)
> - Pemetaan field **sudah selesai di `A-01`**: `name → display_name`, `image → avatar_url`,
>   `createdAt → created_at`, `updatedAt → updated_at`, dan `emailVerified → email_verified`.
>   Yang terakhir butuh **kolom baru bertipe boolean** (isu #35 opsi 1) — pemetaan field hanya
>   mengganti nama, tidak pernah tipe
>
> **Harga yang dibayar: AU-5 hilang.** Dijelaskan di bawah.


#### Aturan bisnis

| # | Aturan |
|---|---|
| AU-1 | Registrasi butuh email + password. Email disimpan `citext` (case-insensitive unique). |
| AU-2 | Password minimal 10 karakter. Tidak ada aturan komposisi (huruf besar/simbol) — panjang lebih efektif dan aturan komposisi membuat orang memakai `Password1!`. |
| AU-3 | Password di-hash **Argon2id**. Tidak pernah dicatat di log, tidak pernah dikirim balik. |
| AU-4 | ~~Access token JWT 15 menit, refresh token 30 hari dirotasi setiap dipakai.~~ **DIUBAH isu #18:** sesi Better-Auth di sisi server — token buram di tabel `session`, masa berlaku **30 hari**, dicabut dengan menghapus barisnya. Tidak ada JWT, tidak ada rotasi. |
| AU-5 | ~~Refresh token yang dipakai ulang mencabut seluruh rantai sesi turunannya. Ini deteksi pencurian token.~~ **DIBUANG isu #18 — risiko diterima secara sadar.** Lihat catatan di bawah. |
| AU-6 | Registrasi membuat baris `streaks` dan `reviewer_weights` sekaligus dalam transaksi yang sama. |
| AU-7 | Zona waktu diambil dari body registrasi, divalidasi terhadap daftar IANA, fallback `Asia/Jakarta`. |
| AU-8 | Verifikasi email **tidak memblokir** pemakaian, tapi **memblokir top-up**. Pengguna belum terverifikasi boleh belajar, tidak boleh beli koin. |
| AU-9 | Peran default `student`. Hanya Superadmin yang bisa mengubah peran, lewat Retool, dan tercatat di `audit_log`. |

> **Apa yang sebenarnya hilang bersama AU-5, ditulis terang supaya tidak dilupakan.**
>
> AU-5 adalah deteksi pencurian token: token yang sudah dirotasi lalu dipakai lagi berarti
> **ada dua pihak memegangnya**, dan itu satu-satunya sinyal otomatis yang kita punya bahwa
> sebuah sesi dicuri. Better-Auth tidak merotasi token sesi, jadi sinyal itu tidak ada
> padanannya — membangunnya sendiri di atas Better-Auth berarti "menulis logika auth sendiri"
> lewat pintu belakang, yang justru dilarang kalimat pembuka E1.
>
> **Akibat konkretnya:** token sesi yang dicuri berlaku sampai kedaluwarsa atau sampai
> seseorang mencabutnya manual. Tidak ada yang tahu ia dicuri.
>
> **Yang menggantikannya sebagian, dan wajib ada di `A-01`:**
> - Setiap pembuatan sesi tercatat di `audit_log` dengan `ip` dan `user_agent`, sehingga
>   sesi ganda dari lokasi berbeda masih bisa dilihat manusia — meski tidak otomatis
> - Ganti password **mencabut seluruh sesi** pengguna itu
> - Superadmin bisa mencabut sesi seseorang lewat Retool
>
> Ketiganya mengurangi dampak, **tidak menggantikan deteksinya**. Ini pelemahan keamanan
> yang disengaja, diputuskan Dev A pada 2026-09-15, dan pantas ditinjau ulang di checkpoint
> scope W5 — bukan diturunkan jadi catatan kaki.

#### Acceptance criteria

```
AC-AU-1
  Given pengguna baru dengan email "a@b.com"
  When mendaftar dengan password 10+ karakter
  Then akun dibuat, baris streaks & reviewer_weights ada,
       dan respons memuat access + refresh token

AC-AU-2  (DITULIS ULANG — isu #18 membuang AU-5)
  Given pengguna punya tiga sesi aktif dari tiga perangkat
  When password-nya diganti
  Then KETIGA sesi dicabut, dan audit_log memuat
       action='auth.sessions_revoked' dengan jumlahnya

  Versi lama menuntut deteksi pemakaian ulang refresh token. Better-Auth
  tidak merotasi token sesi, jadi sinyal itu tidak punya padanan, dan
  membangunnya sendiri di atasnya berarti menulis logika auth sendiri —
  yang dilarang kalimat pembuka E1.

  YANG HILANG, ditulis di sini supaya tidak lenyap dari ingatan: token sesi
  yang dicuri berlaku sampai kedaluwarsa, dan TIDAK ADA YANG TAHU ia dicuri.
  Pencabutan massal di atas hanya mengurangi dampak setelah pengguna
  menyadarinya sendiri.

AC-AU-3
  Given pengguna dengan role='student'
  When memanggil GET /admin/transactions
  Then respons 403 dengan code='FORBIDDEN_ROLE'

AC-AU-4
  Given pengguna dengan role='superadmin'
  When memanggil POST /attempts
  Then respons 403 — superadmin tidak otomatis lolos rute student

AC-AU-5
  Given pengguna belum verifikasi email
  When memanggil POST /payments/checkout
  Then respons 403 dengan code='EMAIL_NOT_VERIFIED'
```

#### Kasus tepi

- Email dengan huruf besar (`A@B.com`) harus dianggap sama dengan `a@b.com`.
- Registrasi ganda dengan email sama → 409 `EMAIL_TAKEN`, bukan 500.
- Zona waktu tidak dikenal dari browser (misal `Etc/Unknown`) → fallback diam-diam ke `Asia/Jakarta`, tidak error.

---

### E2 · Learning Engine

**Tujuan.** Pengguna menyelesaikan unit belajar 2–3 menit yang terasa ringan dan memberi hadiah.

**Kedalaman v0.1:** tipe kartu `multiple_choice` dan `swipe_binary`. Tipe `order_steps` dan `reveal` ada di skema tapi tidak diimplementasikan di UI.

#### Aturan bisnis

| # | Aturan |
|---|---|
| LE-1 | Satu lesson berisi 3–5 kartu. Durasi target 120–180 detik. |
| LE-2 | **Penilaian sepenuhnya di server.** Skor yang dikirim client diabaikan. |
| LE-3 | Kunci jawaban (`content.options[].correct` dan `.why`) **dibuang di serializer** sebelum dikirim ke client. Diuji dengan snapshot test atas respons mentah. |
| LE-4 | Satu lesson hanya berhadiah **sekali per hari per pengguna** (unique index `user_id, lesson_id, attempt_date`). Pengulangan tetap diizinkan untuk latihan, tapi `rewarded=false`. |
| LE-5 | `attempt_date` adalah **tanggal lokal pengguna**, dihitung di Postgres: `(now() AT TIME ZONE users.timezone)::date`. |
| LE-6 | Penyelesaian attempt menulis **dalam satu transaksi**: `lesson_attempts` + `streaks` + `coin_ledger` + `users.coin_balance` + `daily_quests` + `squad_members.weekly_points` + `outbox_events`. |
| LE-7 | **Tidak ada penulisan Redis di dalam transaksi.** ZINCRBY dilakukan outbox worker setelah commit. |
| LE-8 | `POST /attempts` wajib membawa header `Idempotency-Key`. Request ulang dengan kunci sama mengembalikan respons pertama, bukan efek kedua. |
| LE-9 | Progres track dihitung dari jumlah lesson yang pernah diselesaikan (bukan attempt), dibagi total lesson di track. |

#### Acceptance criteria

```
AC-LE-1
  Given lesson L belum pernah dikerjakan pengguna U hari ini
  When U mengirim POST /attempts dengan jawaban benar semua
  Then respons memuat rewarded=true, score=100, coins=20, points sesuai formula,
       dan coin_ledger bertambah tepat satu baris entry_type='earn_lesson'

AC-LE-2
  Given U sudah menyelesaikan lesson L hari ini
  When U mengerjakan L lagi
  Then respons rewarded=false, tidak ada entri coin_ledger baru,
       dan streak tidak bertambah

AC-LE-3
  Given transaksi POST /attempts
  When exception dilempar tepat setelah insert coin_ledger
  Then tidak ada baris tersisa di lesson_attempts, coin_ledger,
       outbox_events, maupun perubahan pada streaks dan users.coin_balance

AC-LE-4
  Given request POST /attempts dengan Idempotency-Key K
  When request identik dengan K dikirim lagi
  Then respons sama dengan yang pertama, dan jumlah baris tidak bertambah

AC-LE-5
  Given endpoint GET /lessons/:id/cards
  When responsnya diperiksa sebagai JSON mentah
  Then tidak ada field bernama "correct" maupun "why" di mana pun
```

#### Kasus tepi

- Client mengirim `cardId` yang bukan milik lesson tersebut → 422, bukan skor 0 diam-diam.
- Client mengirim jawaban untuk 2 dari 5 kartu → dinilai sebagai 3 kartu salah, bukan error.
- `duration_ms` yang tidak masuk akal (< 3 detik untuk 5 kartu) → tetap diterima tapi ditandai di `card_results` untuk analisis anti-cheat nanti.

---

### E3 · Career Streak

**Tujuan.** Memberi alasan untuk kembali besok.

> **Keputusan paling menentukan di seluruh epik ini:** "hari ini" dihitung dalam **zona waktu pengguna**, bukan UTC. Kalau memakai UTC, pengguna WIB yang belajar pukul 22.00 tercatat di tanggal besok dan streak-nya putus pukul 07.00 pagi tanpa sebab yang bisa ia pahami. Bug ini tidak muncul di test yang berjalan di UTC.

#### Aturan bisnis

| # | Aturan |
|---|---|
| SK-1 | Streak bertambah kalau pengguna menyelesaikan ≥1 micro-task dalam satu hari lokal. |
| SK-2 | Micro-task = menyelesaikan lesson (berhadiah) **atau** mengirim peer review. |
| SK-3 | Menyelesaikan task kedua di hari yang sama **tidak** menambah streak. |
| SK-4 | Kalau gap = 1 hari → `current_streak + 1`. Kalau gap > 1 → `current_streak = 1` (hari ini tetap dihitung, bukan 0). |
| SK-5 | `longest_streak` tidak pernah turun. |
| SK-6 | Kredit freeze menyelamatkan **hari berjalan**, dipakai maksimal sekali per hari, dan hanya sebelum tengah malam lokal. |
| SK-7 | Kredit gratis diberikan job bulanan di awal bulan kalender waktu lokal pengguna. Maksimal simpan 2. |
| SK-8 | Peringatan dikirim pukul **20.00 waktu lokal pengguna** kalau hari itu belum ada micro-task. Pengguna yang sudah aktif tidak menerima apa pun. |
| SK-9 | Status UI: `active` (sudah aktif hari ini), `at_risk` (belum, ≤4 jam tersisa), `frozen` (dipakai freeze hari ini), `broken` (streak = 0). |
| SK-10 | Status `broken` **tidak pernah memakai warna merah**. Streak putus itu kekecewaan, bukan kesalahan. |

#### Acceptance criteria

```
AC-SK-1
  Given pengguna dengan timezone='Asia/Jakarta', last_activity_date=kemarin, current_streak=5
  When menyelesaikan lesson pukul 22.00 WIB
  Then current_streak menjadi 6 dan last_activity_date = tanggal hari ini WIB
       (BUKAN tanggal besok meski UTC sudah berganti hari)

AC-SK-2
  Given pengguna dengan timezone='Europe/London' dan 'Asia/Jayapura'
  When keduanya menyelesaikan lesson pada waktu lokal 23.00 di hari yang sama lokal
  Then keduanya mendapat streak +1 pada tanggal lokal masing-masing

AC-SK-3
  Given current_streak=10, last_activity_date=3 hari lalu, freeze_credits=0
  When menyelesaikan lesson hari ini
  Then current_streak=1, longest_streak tetap 10

AC-SK-4
  Given pengguna belum aktif hari ini dan freeze_credits=1
  When memanggil POST /streak/freeze
  Then freeze_credits=0, last_activity_date=hari ini lokal, current_streak tidak berubah

AC-SK-5
  Given pengguna sudah memakai freeze hari ini
  When memanggil POST /streak/freeze lagi
  Then respons idempoten — freeze_credits tidak berkurang lagi
```

#### Kasus tepi

- Pengguna mengubah zona waktu di tengah streak → `last_activity_date` lama **tidak** dihitung ulang. Kemungkinan streak putus atau lompat sekali; ini diterima dan dijelaskan di UI saat mengubah zona waktu.
- Daylight saving time di zona waktu non-Indonesia → dihitung Postgres, bukan Node, sehingga otomatis benar.
- Job peringatan berjalan tiap 15 menit dan menyaring pengguna yang jam lokalnya tepat 20.00–20.15.

---

### E4 · Coin & Wallet

**Tujuan.** Setiap koin bisa dipertanggungjawabkan.

> **TIDAK DITIPISKAN.** Ini fondasi seluruh monetisasi dan satu-satunya hal yang tidak bisa diperbaiki belakangan tanpa migrasi data.

#### Aturan bisnis

| # | Aturan |
|---|---|
| CO-1 | `coin_ledger` bersifat **append-only**. Trigger database menolak UPDATE dan DELETE. |
| CO-2 | Koreksi ditulis sebagai entri `adjust` baru, tidak pernah dengan mengubah entri lama. |
| CO-3 | `users.coin_balance` adalah **cache**. Kebenarannya `SUM(coin_ledger.amount)`. |
| CO-4 | Setiap penulisan mengunci baris `users` dengan `SELECT … FOR UPDATE` — titik serialisasi per pengguna. |
| CO-5 | Idempotensi dijamin dua lapis: `idempotency_key UNIQUE` dan partial unique index `(ref_type, ref_id, entry_type)`. |
| CO-6 | Saldo **tidak pernah** negatif — termasuk untuk `entry_type='adjust'`. Koreksi Superadmin dibatasi sebesar saldo yang tersedia; kelebihannya ditolak `INSUFFICIENT_COINS`. Ditegakkan dua lapis: `CoinLedgerService` dan CHECK `users_coin_balance_non_negative`. |
| CO-7 | Pola **hold → settle \| release** wajib untuk semua pekerjaan yang bisa gagal setelah saldo dipotong. Tidak pernah "debit lalu refund manual". |
| CO-8 | `settle` **tidak menulis entri ledger** — hold sudah memotong saldo. Settle adalah perubahan status, jejaknya di `audit_log`. |
| CO-9 | `release` mengembalikan jumlah penuh hold dan bersifat idempoten. |
| CO-10 | Reaper melepas hold yang menggantung > 30 menit. |
| CO-11 | Job rekonsiliasi harian membandingkan cache dengan jumlah ledger; selisih apa pun → `audit_log` + alert. |
| CO-12 | Setiap entri ledger memicu event outbox `wallet.updated`, ditulis dalam transaksi yang sama. |

#### Acceptance criteria

```
AC-CO-1
  Given baris apa pun di coin_ledger
  When dicoba UPDATE atau DELETE lewat SQL langsung
  Then database melempar exception 'coin_ledger bersifat append-only'

AC-CO-2
  Given saldo pengguna 100 koin
  When dua request paralel masing-masing men-debit 80 koin
  Then tepat satu berhasil dan satu ditolak INSUFFICIENT_COINS;
       saldo akhir 20, bukan -60

AC-CO-3
  Given hold 2.400 koin untuk scan S
  When scan gagal dan release dipanggil dua kali
  Then hanya satu entri 'release' tertulis, saldo kembali tepat 2.400

AC-CO-4
  Given users.coin_balance sengaja diubah manual jadi salah
  When job rekonsiliasi berjalan
  Then audit_log memuat action='reconcile.mismatch' dengan selisihnya
       dan alert terkirim

AC-CO-5
  Given hold dibuat 31 menit lalu dan scan masih status 'queued'
  When reaper berjalan
  Then hold dilepas, saldo kembali, scan berstatus 'released'
```

#### Kasus tepi

- Dua worker mencoba `settle` hold yang sama → hanya satu baris `audit_log`, yang kedua no-op.
- `release` dipanggil untuk referensi yang tidak punya hold → mengembalikan `null`, bukan error.
- Rekonsiliasi menemukan selisih → **jangan perbaiki otomatis**. Catat dan alarm, supaya penyebabnya bisa dilacak.

---

### E5 · Squad & Liga

**Tujuan.** Tekanan sosial yang membuat streak bertahan setelah minggu pertama.

#### Aturan bisnis

| # | Aturan |
|---|---|
| SQ-1 | Squad berisi 8–12 anggota, dibentuk otomatis oleh job mingguan. |
| SQ-2 | Satu pengguna hanya boleh aktif di satu squad (partial unique index `user_id WHERE left_at IS NULL`). |
| SQ-3 | Musim = satu minggu ISO, kode `YYYY-Www` (contoh `2026-W37`). |
| SQ-4 | Papan peringkat minggu berjalan dilayani **Redis ZSET**; Postgres tetap sumber kebenaran. |
| SQ-5 | Kunci ZSET dirotasi per musim, bukan di-reset — kunci lama kedaluwarsa sendiri setelah 14 hari. |
| SQ-6 | ZSET harus bisa **dibangun ulang dari Postgres** kapan saja. Kehilangan Redis bukan insiden. |
| SQ-7 | Poin masuk ZSET lewat **outbox worker**, bukan penulisan langsung dari request. |
| SQ-8 | Penutupan musim: 20% teratas promosi, 20% terbawah degradasi. Gold tidak bisa promosi, Bronze tidak bisa degradasi. |
| SQ-9 | Rollup bersifat **idempoten** — dijalankan dua kali tidak menggeser tier dua langkah. |
| SQ-10 | Pindah squad tengah musim: poin tidak ikut, maksimal 1× per musim (lihat §5 Q5). |

#### Acceptance criteria

```
AC-SQ-1
  Given Redis dikosongkan dengan FLUSHALL
  When GET /squads/:id/leaderboard dipanggil
  Then papan terisi dengan angka identik dengan sebelum dihapus,
       dibangun ulang dari lesson_attempts + peer_reviews

AC-SQ-2
  Given dua instance outbox worker berjalan paralel
  When 100 event points.awarded menunggu
  Then setiap event diproses tepat sekali (FOR UPDATE SKIP LOCKED)

AC-SQ-3
  Given musim 2026-W37 sudah ditutup
  When closeSeason('2026-W37') dipanggil lagi
  Then tidak ada squad yang berpindah tier untuk kedua kalinya

AC-SQ-4
  Given pengguna aktif di squad A
  When sistem mencoba memasukkannya ke squad B tanpa left_at di A
  Then database menolak lewat partial unique index
```

#### Kasus tepi

- Squad dengan < 3 anggota aktif di akhir musim → tidak ikut promosi/degradasi, digabung ke squad lain musim berikutnya.
- Pengguna nonaktif 14 hari → dikeluarkan dari squad oleh job mingguan agar tidak membebani squad-nya.

---

### E6 · Payment

**Tujuan.** Rupiah berubah jadi koin, tepat sekali.

**Implementasi:** Midtrans Snap **hosted checkout**. Jangan membuat halaman pembayaran sendiri.

#### Aturan bisnis

| # | Aturan |
|---|---|
| PA-1 | Metode pembayaran v1: **QRIS saja**. Metode lain ditambahkan setelah beta. |
| PA-2 | `POST /payments/checkout` membuat baris `orders` status `pending` + transaksi Snap, mengembalikan `token` dan `redirect_url`. |
| PA-3 | Wajib `Idempotency-Key`. Request ulang mengembalikan order yang sama, bukan order baru. |
| PA-4 | Harga diambil dari `pricing_config` versi aktif; `orders.pricing_version` menyimpan versinya agar order lama tetap terbaca. |
| PA-5 | **Koin HANYA ditambahkan dari webhook bertanda tangan.** Tidak pernah dari redirect client. |
| PA-6 | Webhook memverifikasi signature Midtrans (`SHA512(order_id + status_code + gross_amount + server_key)`). Signature salah → 401 + `audit_log`. |
| PA-7 | Webhook idempoten pada `order_id`: kalau order sudah `paid`, balas 200 tanpa aksi. |
| PA-8 | Penambahan koin, update status order, dan insert `payments` terjadi dalam satu transaksi. |
| PA-9 | Order `pending` lebih dari 24 jam → status `expired` oleh job harian. |
| PA-10 | Top-up diblokir untuk pengguna yang belum verifikasi email. |

#### Acceptance criteria

```
AC-PA-1
  Given order O berstatus pending untuk 2.200 koin
  When webhook settlement yang sah untuk O dikirim tiga kali
  Then koin bertambah tepat 2.200 sekali, orders.status='paid',
       dan payments memuat tiga baris (jejak semua webhook)

AC-PA-2
  Given webhook dengan signature yang salah
  When diterima
  Then respons 401, tidak ada perubahan saldo,
       dan audit_log memuat action='payment.bad_signature'

AC-PA-3
  Given pengguna memanggil halaman "pembayaran berhasil" secara manual
  When tidak ada webhook yang pernah masuk
  Then saldo tidak bertambah sama sekali

AC-PA-4
  Given harga paket berubah (pricing_config v2 diterbitkan)
  When order lama (v1) dibuka di riwayat
  Then harga yang ditampilkan tetap harga v1
```

#### Kasus tepi

- Webhook datang untuk order yang tidak ada → 200 (agar gateway berhenti retry) + `audit_log`, bukan 404.
- Webhook `deny`/`cancel`/`expire` → order jadi `failed`/`expired`, tidak ada koin.
- Pembayaran parsial tidak mungkin di QRIS, tapi kalau `gross_amount` berbeda dari order → tolak dan alarm.

---

### E7 · Klinik Plagiarisme

**Tujuan.** Satu-satunya fitur dengan kesediaan membayar seketika. Ini yang mendanai sisanya.

> **TIDAK DITIPISKAN.**

#### Aturan bisnis

| # | Aturan |
|---|---|
| KL-1 | Format diterima: **PDF dan DOCX**. Maksimal 25 MB, maksimal 15.000 kata. |
| KL-2 | Dokumen di-hash **SHA-256** sebelum apa pun terjadi. |
| KL-3 | **Dedup:** kalau hash + provider sama pernah menghasilkan scan `done`, salin hasilnya dengan tarif diskon (240 koin) dan **jangan panggil vendor**. |
| KL-4 | Jalur normal: `hold` koin → enqueue job → panggil vendor → webhook → `settle`. |
| KL-5 | Hold dibuat **sebelum** job di-enqueue. Kalau saldo kurang, job tidak pernah dibuat. |
| KL-6 | Enqueue dilakukan **setelah** transaksi commit. |
| KL-7 | Kegagalan vendor, timeout, atau job hilang → `release` koin penuh. |
| KL-8 | Reaper melepas hold yang menggantung > 30 menit. |
| KL-9 | Cache dedup diisi **hanya setelah** hasil benar-benar tersimpan. |
| KL-10 | Laporan diunduh lewat **signed URL berlaku 15 menit**. |
| KL-11 | Biaya koin ditampilkan di UI **sebelum** tombol kirim ditekan, beserta estimasi jumlah kata. |
| KL-12 | Antarmuka provider (`PlagiarismProvider`) ada di kode sejak awal agar bisa pindah vendor tanpa migrasi. |

#### Acceptance criteria

```
AC-KL-1
  Given dokumen D belum pernah discan
  When pengguna mengirimnya dengan saldo cukup
  Then entri 'hold' -2400 tertulis, scan status='queued',
       job masuk antrean, dan UI menampilkan status antre

AC-KL-2
  Given dokumen dengan SHA-256 identik sudah pernah discan status done
  When pengguna lain mengirim dokumen yang sama
  Then vendor TIDAK dipanggil, scan langsung status='done',
       dan yang didebit hanya 240 koin

AC-KL-3
  Given scan berstatus 'running' dan worker dimatikan paksa
  When 31 menit berlalu dan reaper berjalan
  Then scan status='released', koin kembali 2.400 penuh

AC-KL-4
  Given saldo pengguna 1.000 koin
  When mencoba scan seharga 2.400
  Then ditolak INSUFFICIENT_COINS sebelum baris scan dibuat

AC-KL-5
  Given webhook hasil dari vendor
  When diterima dua kali untuk scan yang sama
  Then hasil tersimpan sekali, settle tercatat sekali
```

#### Kasus tepi

- Dokumen hasil scan gambar (tidak ada teks) → ditolak sebelum hold dengan pesan jelas.
- Dokumen > 15.000 kata → ditolak dengan saran memecah, bukan dipotong diam-diam.
- Vendor mengembalikan skor > 100 atau negatif → ditolak, scan jadi `failed`, koin dikembalikan.

---

### E8 · ATS CV Builder

**Tujuan.** Mengubah profil/CV lama jadi CV yang terbaca mesin ATS.

**Kedalaman v0.1:** ekspor PDF saja. DOCX ditunda.

> **Pembagian tugas yang menentukan kualitas fitur ini: LLM menulis, kode menilai.** Skor "ramah ATS" adalah aturan mekanis. Kalau diserahkan ke LLM, dokumen yang sama mendapat skor berbeda tiap dijalankan — dan pengguna akan menyadarinya.

#### Aturan bisnis

| # | Aturan |
|---|---|
| CV-1 | Sumber: CV lama (PDF/DOCX) **atau** profil Strive Academy. Salah satu wajib ada. |
| CV-2 | Node **tidak pernah memanggil LLM langsung**. Node membuat `ai_jobs`, worker mengirim ke AI service. |
| CV-3 | Prompt **berversi** (`PROMPT_VERSION`), disimpan di `ai_jobs.prompt_version`. |
| CV-4 | **LLM tidak boleh menambahkan fakta.** Pengalaman, gelar, angka, dan capaian harus bisa ditelusuri ke sumber. Diuji dengan 5 dokumen kontrol. |
| CV-5 | Cache pada `SHA-256(sumber + target_role + bahasa + prompt_version)`, TTL 7 hari. |
| CV-6 | Skor ATS **deterministik**, tanpa LLM. Aturan: kelengkapan kontak, format tanggal `YYYY-MM`, poin terukur, kata kerja aktif, jumlah skill, konsistensi rentang tanggal. |
| CV-7 | Render PDF **satu kolom**, tanpa tabel, tanpa ikon, tanpa header/footer — semuanya memecah parser ATS. |
| CV-8 | Biaya LLM per job dicatat di `ai_jobs.cost_usd` untuk panel admin. |
| CV-9 | Kuota 10 run AI per pengguna per hari (gabungan CV + Prompt Lab + Mastery). |

#### Acceptance criteria

```
AC-CV-1
  Given dokumen sumber yang sama dijalankan dua kali
  When keduanya selesai
  Then ats_score identik persis, dan panggilan LLM kedua tidak terjadi (cache hit)

AC-CV-2
  Given CV sumber tanpa pengalaman kerja sama sekali
  When diproses
  Then structured.experiences kosong — LLM tidak mengarang pengalaman
       (diuji dengan 5 dokumen kontrol di test suite)

AC-CV-3
  Given CV dengan tanggal format "Jan 2024"
  When dinilai
  Then findings memuat severity='error' pada field tanggal dengan pesan
       yang menyebut format YYYY-MM

AC-CV-4
  Given pengguna sudah menjalankan 10 job AI hari ini
  When menjalankan yang ke-11
  Then ditolak dengan code='DAILY_AI_QUOTA_EXCEEDED'
```

#### Kasus tepi

- PDF terenkripsi / berpassword → ditolak dengan pesan jelas.
- CV dua kolom → tetap diekstraksi (pdfplumber dengan layout), tapi ditandai di findings.
- LLM mengembalikan JSON tidak valid → retry sekali dengan instruksi perbaikan, lalu gagal dengan pesan yang bisa dipahami pengguna.

---

### E9 · Panel Superadmin

**Tujuan.** Operator bisa bekerja tanpa membuka database.

**Implementasi:** **Retool** di atas view SQL read-only + beberapa endpoint tulis resmi. Jangan bangun UI React sendiri.

#### Aturan bisnis

| # | Aturan |
|---|---|
| SA-1 | Koneksi Retool memakai role PostgreSQL **read-only**. |
| SA-2 | Semua aksi tulis lewat endpoint resmi (`PATCH /admin/pricing`, dsb.), bukan SQL langsung. |
| SA-3 | Perubahan harga **menerbitkan versi baru** `pricing_config`, tidak pernah menimpa. |
| SA-4 | Setiap aksi Superadmin tercatat di `audit_log` dengan `actor_id`. |
| SA-5 | View `v_transactions` menggabungkan `orders` + `payments` + `coin_ledger` agar satu transaksi bisa ditelusuri dalam satu query. |
| SA-6 | Dasbor biaya vendor menampilkan biaya harian per model LLM dan jumlah scan per vendor. |

#### Acceptance criteria

```
AC-SA-1
  Given Superadmin mengubah harga paket
  When perubahan disimpan
  Then pricing_config bertambah satu baris versi baru,
       versi lama tidak berubah, dan audit_log mencatat pelakunya

AC-SA-2
  Given koneksi Retool
  When mencoba INSERT/UPDATE lewat query SQL
  Then ditolak database karena role read-only
```

---

### E10 · Pengerasan & Rilis

**Tujuan.** Membedakan rilis dari demo.

> **TIDAK DITIPISKAN.** Lihat `DELIVERY-PLAN.md` §2 tuas 3.

Isi lengkap ada di §15 (NFR), §16 (keamanan), §17 (observability), §18 (testing).

**Gate rilis** (seluruhnya wajib):

- [ ] E2E Playwright hijau di CI
- [ ] p95 `GET /hub` < 250 ms pada 500 rps
- [ ] p95 `GET /squads/:id/leaderboard` < 250 ms pada 500 rps
- [ ] Checklist keamanan §16 tuntas, nol temuan kritis
- [ ] Rekonsiliasi koin nol selisih 3 hari berturut-turut
- [ ] Alert biaya vendor aktif dan pernah diuji memicu
- [ ] Runbook insiden tertulis untuk 3 skenario: Redis mati, vendor scan down, biaya LLM melonjak

---

### E11 · Peer Review & Mentor

**Tujuan.** Menambahkan dimensi kualitas ke skor liga, dan memberi mentor sesuatu untuk dikerjakan.

**Kedalaman v0.1:** bobot reviewer **tetap 1,0**. Kalibrasi reputasi otomatis ditunda.

> **Skor dari peer review bisa diakali.** Kalau skor squad naik dari penilaian sesama anggota, squad yang saling memberi nilai penuh akan menang. Tiga kontrol di bawah dirancang untuk itu dan **harus ada sebelum musim liga pertama**, bukan sesudah ada keluhan.

#### Aturan bisnis

| # | Aturan |
|---|---|
| PR-1 | Setiap submission dialokasikan ke **2 reviewer dari squad berbeda**. |
| PR-2 | **Identitas penulis disembunyikan** dari reviewer — dihilangkan di serializer, bukan hanya di UI. |
| PR-3 | **Tidak boleh menilai karya sendiri** — dicek di service dan di CHECK constraint `no_self_review`. |
| PR-4 | Maksimal **5 review berpoin per hari** per reviewer. |
| PR-5 | Poin = `rubrik_total × reviewer_weight`. Di v0.1 `reviewer_weight` selalu 1,00. |
| PR-6 | Mentor memvalidasi review; approve memicu entri koin `earn_review` untuk reviewer **tepat sekali**. |
| PR-7 | Mentor hanya melihat squad yang `mentor_id`-nya dirinya. |
| PR-8 | `reviewer_weights` tetap ada di skema dan diisi 1,00 — supaya kalibrasi bisa diaktifkan tanpa migrasi. |
| PR-9 | Mentor bisa menyesuaikan `reviewer_weight` manual lewat Retool (pengganti kalibrasi otomatis). |

#### Acceptance criteria

```
AC-PR-1
  Given submission dari pengguna U di squad A
  When reviewer dialokasikan
  Then kedua reviewer berasal dari squad selain A,
       dan respons API tidak memuat identitas U di mana pun

AC-PR-2
  Given pengguna U mencoba mereview submission miliknya sendiri
  When request dikirim
  Then ditolak di service DAN ditolak CHECK constraint kalau menembus

AC-PR-3
  Given reviewer sudah mengirim 5 review berpoin hari ini
  When mengirim yang ke-6
  Then review tersimpan tapi weighted_points=0

AC-PR-4
  Given mentor menyetujui review R
  When approve dipanggil dua kali
  Then entri koin earn_review hanya satu
```

---

### E12 · International Mastery Track

**Tujuan.** Membantu persiapan studi lanjut ke luar negeri.

**Kedalaman v0.1:** **satu putaran tanya-jawab**, bukan simulasi wawancara adaptif multi-putaran.

#### Aturan bisnis

| # | Aturan |
|---|---|
| MT-1 | Dua modul: **simulasi wawancara** dan **review personal statement**. |
| MT-2 | Bank pertanyaan **statis**, minimal 30 pertanyaan untuk 3 program target (Chevening, LPDP, Fulbright). |
| MT-3 | Alur wawancara: sistem menampilkan 5 pertanyaan → pengguna menjawab teks → LLM memberi feedback per jawaban. **Tidak ada pertanyaan lanjutan adaptif.** |
| MT-4 | Review personal statement: pengguna menempel/unggah draf → LLM mengembalikan feedback terstruktur (struktur, kejelasan, bukti, kesesuaian program). |
| MT-5 | **Semua output AI ditandai sebagai saran, bukan penilaian resmi.** Ditampilkan eksplisit di UI. |
| MT-6 | Draf jawaban tersimpan otomatis (autosave) agar tidak hilang saat halaman tertutup. |
| MT-7 | Biaya: sesi wawancara 300 koin, review statement 500 koin. Dipotong dengan pola hold/settle. |
| MT-8 | Riwayat sesi bisa dibuka kembali; pengguna hanya bisa membaca sesinya sendiri. |

#### Acceptance criteria

```
AC-MT-1
  Given pengguna memulai sesi wawancara untuk program 'chevening'
  When sesi dibuat
  Then 5 pertanyaan dari bank soal chevening tersimpan di mastery_sessions.turns
       dan 300 koin ditahan (hold)

AC-MT-2
  Given pengguna menyelesaikan seluruh jawaban
  When feedback LLM selesai
  Then hold di-settle, feedback tersimpan, status='ai_reviewed',
       dan UI menampilkan penanda "saran, bukan penilaian resmi"

AC-MT-3
  Given LLM gagal atau timeout
  When job berakhir failed
  Then hold di-release penuh dan sesi bisa diulang tanpa biaya ganda

AC-MT-4
  Given pengguna A membuka sesi milik pengguna B
  Then respons 403
```

---

### E13 · Prompt Lab

**Tujuan.** Melatih penyusunan prompt terstruktur.

**Kedalaman v0.1:** form + 3 template + riwayat.

#### Aturan bisnis

| # | Aturan |
|---|---|
| PL-1 | Prompt disusun dari 5 bagian: `role`, `context`, `task`, `format`, `constraints`. |
| PL-2 | Jalankan bersifat **sinkron** (bukan job), karena outputnya pendek. Timeout 30 detik. |
| PL-3 | Biaya 20 koin per run, dipotong langsung (bukan hold — tidak ada yang bisa gagal setelah respons diterima). |
| PL-4 | Kuota 10 run AI/hari (gabungan dengan CV dan Mastery). |
| PL-5 | 3 template contoh disediakan; pengguna bisa menyalinnya jadi milik sendiri lalu mengubah. |
| PL-6 | Riwayat menampilkan prompt dan hasilnya berpasangan. |

#### Acceptance criteria

```
AC-PL-1
  Given pengguna menyusun prompt lengkap 5 bagian
  When menjalankannya
  Then 20 koin terpotong, hasil tampil, dan prompt_runs bertambah satu baris

AC-PL-2
  Given LLM timeout > 30 detik
  When request gagal
  Then koin TIDAK terpotong dan pengguna melihat pesan yang bisa dipahami
```

---

### E14 · Strive Store

**Tujuan.** Memberi koin tempat untuk dibelanjakan selain fitur berbayar.

**Kedalaman v0.1:** 8 item di-seed manual, tanpa stok/promo/kategori.

#### Aturan bisnis

| # | Aturan |
|---|---|
| SR-1 | Item digital saja: pustaka prompt, template workspace, aset desain. |
| SR-2 | Satu item **dibeli sekali** per pengguna (unique `user_id, item_id`). |
| SR-3 | Pembelian transaksional: debit ledger + insert `store_purchases` dalam satu transaksi. |
| SR-4 | Saldo kurang → ditolak sebelum entri apa pun ditulis. |
| SR-5 | Unduhan lewat **signed URL 15 menit**. Pengguna yang belum membeli tidak bisa menebak URL aset. |
| SR-6 | Item yang dinonaktifkan tetap bisa diunduh oleh yang sudah membeli. |

#### Acceptance criteria

```
AC-SR-1
  Given pengguna sudah membeli item X
  When mencoba membeli X lagi
  Then ditolak dengan code='ALREADY_PURCHASED', saldo tidak berubah

AC-SR-2
  Given signed URL unduhan dibuat 16 menit lalu
  When diakses
  Then ditolak oleh object storage
```

---

### E15 · Realtime

**Tujuan.** Papan peringkat bergerak saat anggota squad lain menyelesaikan lesson.

**Kedalaman v0.1:** **satu kanal** (`squad:{id}`). Kanal `user:` dan `league:` tetap lewat polling.

> **WebSocket adalah pelengkap, bukan pengganti.** Setiap layar harus tetap benar tanpa satu pun event WS. REST memberi keadaan awal; WS hanya mempercepat pembaruan. Aturan ini yang membuat WS bisa gagal tanpa merusak produk.

#### Aturan bisnis

| # | Aturan |
|---|---|
| RT-1 | Satu kanal: `squad:{squad_id}`, event `score.updated`. |
| RT-2 | Redis pub/sub sebagai adapter agar bisa jalan multi-instance **sejak hari pertama**, meski awalnya satu instance. |
| RT-3 | Klien hanya boleh subscribe ke squad-nya sendiri; percobaan lain ditolak saat subscribe. |
| RT-4 | Event dikirim **oleh outbox worker setelah commit**, bukan dari request handler. |
| RT-5 | Klien jatuh ke **polling 30 detik** otomatis kalau WS gagal atau putus. |
| RT-6 | Event `league.standings` di-throttle 10 detik, bukan per event (tidak dipakai di v0.1). |

#### Acceptance criteria

```
AC-RT-1
  Given WS server dimatikan seluruhnya
  When pengguna membuka halaman squad
  Then papan tetap terisi lewat polling, tidak ada layar kosong atau error

AC-RT-2
  Given dua instance API berjalan
  When event terjadi di instance 1
  Then klien yang terhubung ke instance 2 tetap menerimanya

AC-RT-3
  Given pengguna di squad A
  When mencoba subscribe kanal squad:B
  Then ditolak
```

---

### E16 · Notifikasi

**Tujuan.** Mengingatkan tanpa mengganggu.

**Kedalaman v0.1:** in-app + email. **Web Push browser ditunda** — terlalu banyak kasus tepi per-browser untuk 8 minggu.

#### Aturan bisnis

| # | Aturan |
|---|---|
| NO-1 | Jenis: `streak_warning`, `league_change`, `job_done`, `review_validated`. |
| NO-2 | Kanal: lonceng in-app (selalu) + email (untuk `streak_warning` dan `job_done`). |
| NO-3 | Email lewat **Resend**, template diuji di Gmail dan Outlook. |
| NO-4 | Kegagalan kirim di-retry 3× lalu dicatat — **tidak hilang diam-diam**. |
| NO-5 | Maksimal **3 notifikasi per pengguna per hari**. Kelebihan digabung jadi satu ringkasan. |
| NO-6 | Setiap email punya tautan berhenti berlangganan yang berfungsi. |
| NO-7 | Menandai dibaca bersifat optimistik di UI dan pulih kalau request gagal. |

#### Acceptance criteria

```
AC-NO-1
  Given pengguna dengan timezone Asia/Jakarta belum aktif hari ini
  When jam lokalnya mencapai 20.00
  Then satu notifikasi streak_warning dibuat dan email terkirim

AC-NO-2
  Given pengguna sudah menyelesaikan lesson hari ini
  When scheduler berjalan pukul 20.00 lokalnya
  Then TIDAK ada notifikasi apa pun untuknya

AC-NO-3
  Given 5 peristiwa notifikasi terjadi dalam satu hari
  When dikirim
  Then hanya 3 yang terkirim, sisanya digabung jadi satu ringkasan
```

---

## 8. Arsitektur sistem

### 8.1 Tiga deployable

```
┌─────────────────────────────────────────────────────────────┐
│ CLIENT                                                      │
│   Web App — Next.js 15 App Router (PWA)                     │
│   route group (student) + (console)                         │
└──────────────────────┬──────────────────────────────────────┘
                       │ HTTPS / WSS
┌──────────────────────▼──────────────────────────────────────┐
│ EDGE — TLS 1.3 · rate limit · sticky upgrade untuk WS       │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────┐
│ CORE API — Node / NestJS                                    │
│   REST + WebSocket gateway dalam SATU proses                │
│   modul: auth rbac learning streak squad league             │
│          wallet payment store scan mentor admin             │
└───┬───────────────┬────────────────────┬────────────────────┘
    │               │ HTTP               │ job
    │               ▼                    ▼
    │   ┌───────────────────┐  ┌─────────────────────┐
    │   │ AI SERVICE        │  │ WORKER POOL         │
    │   │ Python FastAPI    │  │ Node · BullMQ       │
    │   │ ekstraksi · LLM   │  │ outbox · scan       │
    │   │ skor ATS · render │  │ ai-dispatch· notify │
    │   └─────────┬─────────┘  │ league-rollup       │
    │             │            │ reconcile-balance   │
    │             │            └──────────┬──────────┘
    ▼             ▼                       ▼
┌────────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐
│ PostgreSQL │ │  Redis   │ │ Object   │ │ API eksternal    │
│ 16         │ │  7       │ │ Storage  │ │ Midtrans·Copyleaks│
│ SUMBER     │ │ turunan  │ │ S3/MinIO │ │ OpenAI·Resend    │
│ KEBENARAN  │ │          │ │          │ │                  │
└────────────┘ └──────────┘ └──────────┘ └──────────────────┘
```

### 8.2 Kenapa dibagi begini

| Komponen | Kenapa terpisah | Kenapa **tidak** dipecah lebih jauh |
|---|---|---|
| **Core API** | — | Streak, koin, squad, dan liga saling menulis **dalam satu transaksi**. Memecahnya jadi service berarti distributed transaction — kompleksitas yang tidak dibayar apa pun di tim 2 orang. Batas ditegakkan lewat modul NestJS dan aturan lint impor, bukan lewat jaringan. |
| **AI Service** | Runtime berbeda (Python), ekosistem berbeda (parser PDF/DOCX), pola beban berbeda: lambat, mahal per panggilan, sering gagal. Tidak boleh berbagi thread pool dengan API transaksional. | Satu service untuk semua tugas AI. CV, Mastery, dan Prompt Lab berbagi klien LLM, caching, dan penanganan rate-limit yang sama. |
| **Worker Pool** | Pekerjaan menit-an tidak boleh menahan koneksi HTTP; skalanya independen dari trafik API. | Satu pool, banyak queue dengan prioritas. Bukan satu deployment per jenis job. |
| **WebSocket** | — | Di dalam proses Core API, dengan Redis pub/sub sebagai adapter. Service WS terpisah menambah satu deployment untuk satu kanal. |

### 8.3 Aturan arsitektur yang tidak boleh dilanggar

1. **Postgres menulis, Redis menurunkan.** Seluruh isi Redis harus bisa dibangun ulang dari Postgres dalam hitungan menit. Kehilangan Redis bukan insiden.
2. **Tidak ada penulisan Redis di dalam transaksi Postgres.** Cache yang berisi nilai dari transaksi yang di-rollback lebih berbahaya daripada cache kosong.
3. **Transactional outbox untuk semua efek lintas-sistem.** Event ikut ter-commit bersama datanya; pengantaran at-least-once, konsumen wajib idempoten.
4. **Node tidak pernah memanggil LLM langsung.** Selalu lewat `ai_jobs` + AI service, agar biaya bisa diaudit di satu tempat.
5. **Enqueue setelah commit, tidak pernah di dalam transaksi.**
6. **Setiap efek samping berbayar memakai pola hold/settle/release.**

### 8.4 Tech stack resmi

| Lapisan | Teknologi | Versi minimum |
|---|---|---|
| Frontend | Next.js (App Router), React, TypeScript | Next 15 |
| Styling | Tailwind CSS, Shadcn/UI, Framer Motion | Tailwind 3.4 |
| Core backend | Node.js, NestJS, TypeScript strict | Node 22, Nest 10 |
| Query builder | Kysely (bukan ORM penuh) | 0.27 |
| AI service | Python, FastAPI, Pydantic v2 | Python 3.12 |
| Database | PostgreSQL | 16 |
| Cache & queue | Redis, BullMQ | Redis 7 |
| Object storage | S3-compatible (MinIO di dev) | — |
| Auth | Better-Auth | — |
| Payment | Midtrans Snap | — |
| Plagiarisme | Copyleaks (di balik antarmuka provider) | — |
| LLM | OpenAI GPT-4o / Google Gemini 1.5 | — |
| Email | Resend | — |
| Panel admin | Retool | — |
| Test | Vitest, Playwright, pytest | — |
| Monorepo | pnpm workspaces | pnpm 9 |

---

## 9. Skema database

**31 tabel.** Tidak ada satu pun kolom organisasi/tenant. PostgreSQL 16.

> Angka ini dihitung dari daftar §9.1 di bawah dan **harus tetap cocok dengannya**.
> Dua tabel berdiri lebih dulu daripada fiturnya, dan itu disengaja:
> `push_tokens` (Web Push ditunda — §22) dan `reviewer_weights` (kalibrasi bobot
> ditunda — §7 E11 PR-8). Keduanya ada sejak `001_init.sql` supaya fiturnya bisa
> diaktifkan tanpa migrasi.

### 9.1 Peta domain

| Domain | Tabel |
|---|---|
| Identitas | `users` · `sessions` · `auth_accounts` · `auth_verifications` · ~~`refresh_tokens`~~ · `push_tokens` |
| Pembelajaran | `tracks` · `modules` · `lessons` · `lesson_cards` · `lesson_attempts` |
| Gamifikasi | `streaks` · `daily_quests` · `squads` · `squad_members` · `league_seasons` · `league_standings` |
| Ekonomi | `coin_ledger` · `pricing_config` · `orders` · `payments` · `store_items` · `store_purchases` |
| Akademik | `plagiarism_scans` · `peer_reviews` · `reviewer_weights` |
| Karir & AI | `ai_jobs` · `cv_documents` · `prompt_runs` · `mastery_sessions` |
| Infrastruktur | `outbox_events` · `notifications` · `audit_log` |

### 9.2 ENUM

```sql
CREATE TYPE user_role   AS ENUM ('student', 'mentor', 'superadmin');
CREATE TYPE card_kind   AS ENUM ('multiple_choice', 'swipe_binary', 'order_steps', 'reveal');
CREATE TYPE league_tier AS ENUM ('bronze', 'silver', 'gold');
CREATE TYPE ai_job_kind AS ENUM ('ats_cv', 'prompt_run', 'interview_feedback', 'statement_review');
CREATE TYPE coin_entry  AS ENUM (
  'earn_lesson', 'earn_streak', 'earn_review', 'purchase',
  'hold', 'settle', 'release', 'spend_store', 'spend_scan', 'spend_ai', 'adjust'
);
```

### 9.3 Tabel inti — kolom lengkap

#### `users`

| Kolom | Tipe | Catatan |
|---|---|---|
| `id` | `uuid PK` | `gen_random_uuid()` |
| `email` | `citext UNIQUE NOT NULL` | case-insensitive |
| ~~`password_hash`~~ | `text` **NULLABLE sejak 004** | **USANG.** Password ada di `auth_accounts.password` (Argon2id). Dibuang di migrasi contract |
| `display_name` | `text NOT NULL` | |
| `avatar_url` | `text` | |
| `role` | `user_role NOT NULL DEFAULT 'student'` | |
| `timezone` | `text NOT NULL DEFAULT 'Asia/Jakarta'` | IANA |
| `coin_balance` | `integer NOT NULL DEFAULT 0` | **CACHE** — kebenaran = `SUM(coin_ledger.amount)` |
| `status` | `text NOT NULL DEFAULT 'active'` | `active` \| `suspended` \| `deleted` |
| `email_verified` | `boolean NOT NULL DEFAULT false` | **AU-8: `false` memblokir top-up.** Ditulis Better-Auth |
| ~~`email_verified_at`~~ | `timestamptz` | **USANG sejak 004** (isu #35 opsi 1). Diganti `email_verified` karena `emailVerified` Better-Auth bertipe boolean dan tipenya tidak bisa dipetakan. Dibuang di migrasi contract |
| `created_at` / `updated_at` | `timestamptz NOT NULL DEFAULT now()` | |

Constraint: `CHECK (coin_balance >= 0)`. Index: `(role) WHERE status='active'`.

#### `coin_ledger` — append-only

| Kolom | Tipe | Catatan |
|---|---|---|
| `id` | `bigserial PK` | |
| `user_id` | `uuid NOT NULL REFERENCES users(id)` | |
| `entry_type` | `coin_entry NOT NULL` | |
| `amount` | `integer NOT NULL` | signed: + masuk, − keluar. `CHECK (amount <> 0)` |
| `balance_after` | `integer NOT NULL` | snapshot, ditulis di transaksi yang sama |
| `ref_type` | `text` | `attempt` \| `order` \| `scan` \| `purchase` \| `streak` \| `ai_job` \| `review` |
| `ref_id` | `uuid` | |
| `idempotency_key` | `text UNIQUE` | |
| `note` | `text` | |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | |

```sql
CREATE UNIQUE INDEX coin_ledger_ref_uniq
  ON coin_ledger (ref_type, ref_id, entry_type) WHERE ref_id IS NOT NULL;
CREATE INDEX coin_ledger_user_time_idx ON coin_ledger (user_id, created_at DESC);

CREATE OR REPLACE FUNCTION coin_ledger_immutable() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'coin_ledger bersifat append-only: gunakan entri adjust'; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER coin_ledger_no_mutate
  BEFORE UPDATE OR DELETE ON coin_ledger
  FOR EACH ROW EXECUTE FUNCTION coin_ledger_immutable();
```

#### `streaks`

| Kolom | Tipe | Catatan |
|---|---|---|
| `user_id` | `uuid PK REFERENCES users(id) ON DELETE CASCADE` | |
| `current_streak` | `integer NOT NULL DEFAULT 0` | |
| `longest_streak` | `integer NOT NULL DEFAULT 0` | tidak pernah turun |
| `last_activity_date` | `date` | **TANGGAL LOKAL pengguna**, bukan UTC |
| `timezone` | `text NOT NULL DEFAULT 'Asia/Jakarta'` | disalin dari `users` saat registrasi |
| `freeze_credits` | `smallint NOT NULL DEFAULT 1` | maks 2 |
| `freeze_used_date` | `date` | |
| `freeze_purchased_month` | `char(7)` | `YYYY-MM`, membatasi 1 pembelian/bulan |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | |

Menghitung hari lokal pengguna:

```sql
(now() AT TIME ZONE s.timezone)::date
```

#### `lesson_attempts` — dipartisi

Kunci partisi adalah `attempt_date` (tanggal **lokal**), bukan `completed_at`. Dua alasan yang saling menguatkan:

1. PostgreSQL mewajibkan unique index pada tabel terpartisi memuat seluruh kolom partisi. Index harian kita butuh tanggal lokal, jadi tanggal lokal itulah yang harus jadi kunci partisi.
2. Dipartisi per UTC, satu hari lokal bisa terbelah ke dua partisi di pergantian bulan — dan keunikan hariannya bocor di situ.

```sql
CREATE TABLE lesson_attempts (
  id           uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id),
  lesson_id    uuid NOT NULL REFERENCES lessons(id),
  attempt_date date NOT NULL,          -- (now() AT TIME ZONE users.timezone)::date
  card_results jsonb NOT NULL,         -- [{card_id, answer, correct, ms}]
  score        smallint NOT NULL CHECK (score BETWEEN 0 AND 100),
  points       integer  NOT NULL,
  coins        integer  NOT NULL,
  duration_ms  integer  NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, attempt_date)
) PARTITION BY RANGE (attempt_date);

CREATE UNIQUE INDEX lesson_attempts_daily_uniq
  ON lesson_attempts (user_id, lesson_id, attempt_date);
CREATE INDEX lesson_attempts_user_idx ON lesson_attempts (user_id, completed_at DESC);
```

Job bulanan membuat partisi bulan berjalan + satu bulan ke depan.

#### `squad_members`

PK surrogate, bukan `(squad_id, user_id)` — pengguna yang keluar lalu bergabung lagi ke squad yang sama harus bisa punya baris kedua.

```sql
CREATE TABLE squad_members (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  squad_id      uuid NOT NULL REFERENCES squads(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  weekly_points integer NOT NULL DEFAULT 0,
  joined_at     timestamptz NOT NULL DEFAULT now(),
  left_at       timestamptz
);
CREATE UNIQUE INDEX squad_members_one_active ON squad_members (user_id) WHERE left_at IS NULL;
CREATE INDEX squad_members_squad_idx ON squad_members (squad_id) WHERE left_at IS NULL;
```

#### `plagiarism_scans`

| Kolom | Tipe | Catatan |
|---|---|---|
| `id` | `uuid PK` | |
| `user_id` | `uuid NOT NULL REFERENCES users(id)` | |
| `document_sha256` | `char(64) NOT NULL` | kunci dedup |
| `document_key` | `text NOT NULL` | object storage |
| `filename` | `text NOT NULL` | |
| `word_count` | `integer` | |
| `provider` | `text NOT NULL` | `copyleaks` |
| `provider_scan_id` | `text` | |
| `similarity_score` | `numeric(5,2)` | |
| `report_key` | `text` | |
| `status` | `text NOT NULL DEFAULT 'queued'` | `queued`\|`running`\|`done`\|`failed`\|`released` |
| `cost_coins` | `integer NOT NULL` | |
| `hold_ledger_id` | `bigint REFERENCES coin_ledger(id)` | |
| `cached_from` | `uuid REFERENCES plagiarism_scans(id)` | |
| `error_message` | `text` | |
| `created_at` / `completed_at` | `timestamptz` | |

```sql
CREATE INDEX scan_dedup_idx ON plagiarism_scans (document_sha256, provider) WHERE status='done';
CREATE INDEX scan_stuck_idx ON plagiarism_scans (created_at) WHERE status IN ('queued','running');
```

#### `outbox_events`

```sql
CREATE TABLE outbox_events (
  id           bigserial PRIMARY KEY,
  topic        text NOT NULL,   -- points.awarded | streak.updated | wallet.updated | job.completed
  payload      jsonb NOT NULL,
  attempts     smallint NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);
-- Partial index: hanya baris pending yang diindeks, jadi tetap kecil selamanya.
CREATE INDEX outbox_pending_idx ON outbox_events (id) WHERE processed_at IS NULL;
```

Worker mengambil batch dengan `FOR UPDATE SKIP LOCKED` agar banyak instance aman paralel.

#### Tabel lain

| Tabel | Kolom kunci |
|---|---|
| `sessions` | `id, user_id, expires_at, `**`token`**` UNIQUE, ip `**`text`**`, user_agent, created_at, `**`updated_at`**` ` — `token` & `updated_at` ditambahkan 004. `ip` dilebarkan inet → text: Better-Auth meneruskan `X-Forwarded-For` apa adanya, dan rantai proxy bukan `inet` yang sah |
| `auth_accounts` | `id, account_id, provider_id, user_id, access_token, refresh_token, id_token, access_token_expires_at, refresh_token_expires_at, scope, password, created_at, updated_at` — UNIQUE `(provider_id, account_id)`. **Password Argon2id ada di sini**, provider_id `'credential'` |
| `auth_verifications` | `id, identifier, value, expires_at, created_at, updated_at` — token verifikasi email & reset password |
| ~~`refresh_tokens`~~ | **USANG sejak migrasi 004** (isu #18). AU-4 jadi sesi server Better-Auth; tabel ini tidak dipakai kode mana pun dan dibuang di migrasi contract. |
| `push_tokens` | `id, user_id, endpoint, p256dh, auth` — UNIQUE `(user_id, endpoint)` |
| `tracks` | `id, slug UNIQUE, title, description, category, is_published, sort_order` |
| `modules` | `id, track_id, title, sort_order` |
| `lessons` | `id, module_id, title, est_seconds, base_points (10), base_coins (20), sort_order` |
| `lesson_cards` | `id, lesson_id, kind, prompt, content jsonb, sort_order` |
| `daily_quests` | PK `(user_id, quest_date)`, `target_tasks (3), done_tasks, completed_at` |
| `squads` | `id, name, league_tier, mentor_id, season_id, max_members (12)` |
| `league_seasons` | `id, code UNIQUE ('2026-W37'), starts_at, ends_at, closed_at` |
| `league_standings` | PK `(season_id, squad_id)`, `tier, points, rank, outcome, closed_at` |
| `pricing_config` | `version PK, coin_price_idr, scan_cost_coins, scan_cached_cost_coins, lesson_reward_coins, cv_cost_coins, interview_cost_coins, statement_cost_coins, prompt_run_cost_coins, freeze_cost_coins, packages jsonb, created_by, active_from` |
| `orders` | `id, user_id, pricing_version, coins, amount_idr, status, provider, provider_ref, idempotency_key UNIQUE, paid_at` |
| `payments` | `id, order_id, provider, event_type, raw_payload jsonb, signature_ok, received_at` |
| `store_items` | `id, slug UNIQUE, title, kind, price_coins, asset_key, is_active` |
| `store_purchases` | `id, user_id, item_id, price_coins, ledger_id` — UNIQUE `(user_id, item_id)` |
| `peer_reviews` | `id, attempt_id, **attempt_date**, reviewer_id, author_id, rubric_scores jsonb, comment, weighted_points, mentor_checked, mentor_delta` — UNIQUE `(attempt_id, reviewer_id)`, CHECK `reviewer_id <> author_id`, FK `(attempt_id, attempt_date) → lesson_attempts (id, attempt_date)` |
| `reviewer_weights` | `user_id PK, weight numeric(3,2) DEFAULT 1.00 CHECK (0.50–1.50), samples, avg_deviation` |
| `ai_jobs` | `id, user_id, kind, status, input jsonb, output jsonb, model, prompt_version, input_tokens, output_tokens, cost_usd numeric(10,6), error_message, completed_at` |
| `cv_documents` | `id, user_id, job_id, structured jsonb, ats_score smallint, ats_findings jsonb, pdf_key` |
| `prompt_runs` | `id, user_id, job_id, structure jsonb, output text, self_rating` |
| `mastery_sessions` | `id, user_id, kind ('interview'\|'statement'), target, turns jsonb, feedback jsonb, mentor_id, mentor_note, status` |
| `notifications` | `id, user_id, kind, title, body, data jsonb, read_at, sent_at` |
| `audit_log` | `id bigserial, actor_id, action, subject_type, subject_id, before jsonb, after jsonb, ip inet, created_at` |

> **`peer_reviews.attempt_date` — kolom yang ditambahkan setelah §9 ditulis (isu #15).**
>
> `lesson_attempts` terpartisi, jadi primary key-nya `(id, attempt_date)`. PostgreSQL
> **mewajibkan foreign key menunjuk seluruh primary key**, sehingga FK pada `attempt_id`
> saja mustahil secara teknis — bukan kelalaian.
>
> Tanpa kolom ini, integritas `peer_reviews → lesson_attempts` hanya dijaga disiplin kode.
> Itu tidak cukup: `PR-02` menghitung poin liga berbobot dari review, jadi review yang
> menunjuk attempt fantom = **poin fantom**, dan poin fantom adalah manipulasi skor yang
> tidak meninggalkan jejak.
>
> **`attempt_date` WAJIB diambil dari baris `lesson_attempts` itu sendiri, tidak pernah
> dibentuk di Node.** Itu tanggal LOKAL pengguna (aturan 5); membentuknya dari `Date`
> proses Node akan meleset satu hari untuk sebagian pengguna, dan FK-nya akan menolak
> dengan pesan yang tidak menunjuk ke penyebab sebenarnya.

### 9.4 Peta kunci Redis

Seluruhnya **turunan**. Boleh dihapus kapan saja.

| Kunci | Tipe | Isi | TTL | Kalau hilang |
|---|---|---|---|---|
| `lb:sq:{season}:{squad_id}` | ZSET | `user_id → poin mingguan` | 14 hari | Rebuild dari `lesson_attempts` + `peer_reviews` |
| `lb:lg:{season}:{tier}` | ZSET | `squad_id → poin agregat` | 14 hari | Rebuild dari ZSET squad |
| `streak:{user_id}` | HASH | cache `current`, `longest` | 26 jam | Baca dari Postgres |
| `quest:{user_id}:{date}` | HASH | progres quest harian | 48 jam | Hitung dari attempts hari itu |
| `scan:sha:{hash}:{provider}` | STRING | `scan_id` yang bisa dipakai ulang | 30 hari | Index `scan_dedup_idx` jadi cadangan |
| `ai:cache:{sha256}` | STRING | hasil LLM ter-cache | 7 hari | Panggil LLM lagi |
| `rl:{user_id}:{route}` | STRING | penghitung rate limit | 60 detik | Rate limit longgar sesaat |
| `quota:ai:{user_id}:{date}` | STRING | penghitung kuota AI harian | 26 jam | Kuota longgar sehari |
| `ws:presence:{squad_id}` | SET | anggota yang sedang online | 5 menit | Indikator presence kosong |
| `bull:{queue}:*` | BullMQ | outbox · scan · ai · notify | — | Outbox mengirim ulang |

`{season}` berformat `2026-W37`. Kunci baru tiap minggu berarti reset liga tidak butuh operasi hapus yang mahal.

---

## 10. API spec

Prefiks **`/api/v1`**. Auth Bearer JWT kecuali disebutkan lain.

### 10.1 Konvensi

| Aspek | Aturan |
|---|---|
| **Error** | `{ "error": { "code": "INSUFFICIENT_COINS", "message": "...", "details": {} } }` — **`code` adalah kontrak, `message` bukan.** Jangan pernah parsing `message`. |
| **Idempotency** | Header `Idempotency-Key: <uuid>` wajib pada semua `POST` bertanda ⚡. Request ulang mengembalikan respons pertama. |
| **Paginasi** | Cursor, bukan offset: `?cursor=&limit=` → `{ data, next_cursor }`. Offset pada tabel terpartisi melambat seiring waktu. |
| **Validasi** | Skema zod di `packages/contracts`, dipakai pipe NestJS di server dan form resolver di client. Satu definisi, dua sisi. |
| **Tanggal** | Selalu ISO 8601 dengan offset. Tanggal lokal pengguna dikirim sebagai `YYYY-MM-DD` terpisah. |
| **Rate limit** | 120 req/menit per pengguna. Header `X-RateLimit-Remaining`. |

### 10.2 Kode error standar

| Code | HTTP | Arti |
|---|---|---|
| `UNAUTHENTICATED` | 401 | Token tidak ada / tidak valid |
| `FORBIDDEN_ROLE` | 403 | Peran tidak diizinkan di rute ini |
| `NOT_OWNER` | 403 | Sumber daya bukan milik pemanggil |
| `EMAIL_NOT_VERIFIED` | 403 | Aksi butuh email terverifikasi |
| `EMAIL_TAKEN` | 409 | Registrasi dengan email yang sudah ada |
| `INSUFFICIENT_COINS` | 402 | Saldo kurang. `details: {balance, required}` |
| `DAILY_AI_QUOTA_EXCEEDED` | 429 | Kuota 10 run AI/hari habis |
| `DAILY_SCAN_QUOTA_EXCEEDED` | 429 | Kuota 3 scan/hari habis |
| `ALREADY_PURCHASED` | 409 | Item store sudah dibeli |
| `NO_FREEZE_CREDITS` | 409 | Tidak ada kredit freeze |
| `SELF_REVIEW_FORBIDDEN` | 403 | Menilai karya sendiri |
| `UNSUPPORTED_FILE_TYPE` | 415 | Bukan PDF/DOCX |
| `FILE_TOO_LARGE` | 413 | > 25 MB |
| `DOCUMENT_TOO_LONG` | 422 | > 15.000 kata |
| `SOURCE_TOO_SHORT` | 422 | Sumber CV < 120 karakter |
| `RATE_LIMITED` | 429 | Melewati 120 req/menit |
| `NOT_FOUND` | 404 | Sumber daya tidak ada. Dipakai untuk track, modul, lesson, squad, dan baris streak yang hilang |
| `SQUAD_FULL` | 409 | Squad sudah mencapai `max_members`. `details: {squadId, members, max}` |
| `ALREADY_IN_SQUAD` | 409 | Pengguna sudah aktif di squad lain — satu squad aktif per pengguna |
| `SQUAD_MOVE_LIMIT` | 409 | Sudah memakai jatah 1 perpindahan squad musim ini (§5 Q5) |

> **Daftar ini TERTUTUP.** Kode yang tidak ada di sini tidak boleh dikirim API, karena
> `packages/contracts` diturunkan dari tabel ini dan klien diminta bercabang pada `code`,
> bukan mem-parsing `message`. Butuh kode baru → tambahkan di sini lebih dulu, lewat PR
> tersendiri (isu #25).
>
> Empat kode terakhir ditambahkan **setelah** dipakai di kode — urutan yang terbalik, dan
> justru itu sebabnya catatan "tertutup" ini ada.


### 10.3 Endpoint

⚡ = wajib `Idempotency-Key`

#### Auth

| Metode | Path | Peran | Keterangan |
|---|---|---|---|
| `POST` | `/auth/register` | publik | Body: `{email, password, display_name, timezone?}`. Membuat `streaks` + `reviewer_weights`. |
| `POST` | `/auth/login` | publik | → `{access, refresh, user}` |
| `POST` | `/auth/refresh` | publik | Rotasi token; token lama langsung dicabut |
| `POST` | `/auth/logout` | semua | Mencabut refresh token |
| `POST` | `/auth/verify-email` | publik | Token dari email |
| `GET` | `/me` | semua | Profil, peran, saldo koin, zona waktu |
| `PATCH` | `/me` | semua | `{display_name?, timezone?, avatar_url?}` |

#### Hub & pembelajaran

| Metode | Path | Peran | Keterangan |
|---|---|---|---|
| `GET` | `/hub` | student, mentor | **Satu panggilan untuk seluruh layar Hub:** streak, quest harian, peringkat squad, saldo, 3 kartu berikutnya. Menghindari 5 request saat aplikasi dibuka. |
| `GET` | `/tracks` | student, mentor | Daftar track + progres |
| `GET` | `/tracks/:id` | student, mentor | Modul + lesson + progres per modul |
| `GET` | `/lessons/:id/cards` | student, mentor | **Kunci jawaban dibuang di serializer** |
| `POST` ⚡ | `/attempts` | student, mentor | Inti sistem. Satu transaksi: attempt + streak + koin + quest + poin squad + outbox |
| `GET` | `/attempts?cursor=` | student, mentor | Riwayat attempt milik sendiri |

Contoh `POST /attempts`:

```jsonc
// Request
{
  "lesson_id": "8f...",
  "answers": [
    { "card_id": "a1...", "answer": "opt_b", "ms": 4200 },
    { "card_id": "a2...", "answer": true,    "ms": 2100 }
  ],
  "duration_ms": 142000
}

// Response 200
{
  "attempt_id": "c3...",
  "rewarded": true,
  "score": 80,
  "points": 9,
  "coins": 18,
  "balance": 1258,
  "streak": { "kind": "extended", "current": 13, "longest": 13, "is_new_record": true },
  "quest": { "done_tasks": 2, "target_tasks": 3, "completed": false },
  "feedback": [
    { "card_id": "a1...", "correct": true,  "why": "Fakta terverifikasi..." },
    { "card_id": "a2...", "correct": false, "why": "Permintaan maaf sebelum..." }
  ]
}
```

#### Streak

| Metode | Path | Peran | Keterangan |
|---|---|---|---|
| `GET` | `/streak` | student, mentor | Status, sisa jam hari ini (lokal), kredit freeze |
| `POST` ⚡ | `/streak/freeze` | student, mentor | Memakai 1 kredit untuk hari berjalan |
| `POST` ⚡ | `/streak/freeze/purchase` | student, mentor | Beli 1 kredit seharga 200 koin, maks 1×/bulan |

#### Squad & liga

| Metode | Path | Peran | Keterangan |
|---|---|---|---|
| `GET` | `/squads/me` | student, mentor | Squad, anggota, poin mingguan, tier |
| `GET` | `/squads/:id/leaderboard` | student, mentor | Dari ZSET Redis. `Cache-Control: max-age=30` |
| `GET` | `/leagues/:season/:tier` | student, mentor | Klasemen squad dalam satu tier |

#### Peer review

| Metode | Path | Peran | Keterangan |
|---|---|---|---|
| `GET` | `/reviews/queue` | student, mentor | Tugas yang dialokasikan untuk direview. **Anonim, lintas squad.** |
| `POST` ⚡ | `/reviews/:id` | student, mentor | Kirim penilaian rubrik |
| `GET` | `/reviews/mine` | student, mentor | Review yang saya terima |

#### Dompet & pembayaran

| Metode | Path | Peran | Keterangan |
|---|---|---|---|
| `GET` | `/wallet` | student, mentor | Saldo + 20 entri terakhir |
| `GET` | `/wallet/ledger?cursor=` | student, mentor | Riwayat lengkap |
| `GET` | `/pricing` | semua | Paket koin & harga fitur, versi aktif |
| `POST` ⚡ | `/payments/checkout` | student, mentor | → `{order_id, snap_token, redirect_url}` |
| `GET` | `/payments/orders/:id` | student, mentor | Status order (untuk polling UI) |
| `POST` | `/webhooks/payment` | **signature** | Bukan JWT. Verifikasi SHA512 Midtrans. |

#### Store

| Metode | Path | Peran | Keterangan |
|---|---|---|---|
| `GET` | `/store/items` | student, mentor | Etalase |
| `POST` ⚡ | `/store/purchase` | student, mentor | Debit koin + terbitkan hak akses |
| `GET` | `/store/purchases/:id/download` | student, mentor | → signed URL 15 menit |

#### Klinik plagiarisme

| Metode | Path | Peran | Keterangan |
|---|---|---|---|
| `POST` ⚡ | `/scans` | student, mentor | `multipart/form-data`. Upload → SHA-256 → dedup → hold → enqueue |
| `GET` | `/scans?cursor=` | student, mentor | Riwayat |
| `GET` | `/scans/:id` | student, mentor | Status + skor + URL laporan (signed, 15 menit) |
| `POST` | `/webhooks/copyleaks` | **signature** | Hasil dari vendor |

#### Karir & AI

| Metode | Path | Peran | Keterangan |
|---|---|---|---|
| `POST` ⚡ | `/career/cv` | student, mentor | Membuat `ai_job` kind=`ats_cv` → `202 {job_id}` |
| `GET` | `/career/cv/:id` | student, mentor | Hasil + temuan + URL PDF |
| `POST` ⚡ | `/career/prompt-lab/run` | student, mentor | Sinkron, timeout 30 dtk |
| `GET` | `/career/prompt-lab/history` | student, mentor | Riwayat run |
| `POST` ⚡ | `/mastery/interview` | student, mentor | Membuka sesi wawancara |
| `POST` ⚡ | `/mastery/interview/:id/submit` | student, mentor | Kirim jawaban → feedback LLM |
| `POST` ⚡ | `/mastery/statement` | student, mentor | Kirim draf personal statement |
| `GET` | `/mastery/sessions?cursor=` | student, mentor | Riwayat sesi milik sendiri |
| `GET` | `/ai/jobs/:id` | pemilik, superadmin | Polling cadangan; jalur utama event WS |

#### Mentor

| Metode | Path | Peran | Keterangan |
|---|---|---|---|
| `GET` | `/mentor/queue` | mentor | Review menunggu validasi |
| `POST` | `/mentor/reviews/:id/validate` | mentor | Approve/tolak + catatan |
| `GET` | `/mentor/squads` | mentor | Squad binaan + anggota berisiko putus streak |

#### Superadmin

| Metode | Path | Peran | Keterangan |
|---|---|---|---|
| `GET` | `/admin/transactions?cursor=` | superadmin | Order, pembayaran, entri ledger dengan filter |
| `PATCH` | `/admin/pricing` | superadmin | **Menerbitkan versi baru**, bukan menimpa |
| `GET` | `/admin/audit-log?cursor=` | superadmin | Aksi istimewa, webhook, hasil rekonsiliasi |
| `GET` | `/admin/integrations/health` | superadmin | Status & biaya harian per vendor |
| `PATCH` | `/admin/users/:id/role` | superadmin | Menunjuk mentor |

---

## 11. Kanal realtime

Namespace `/rt`. Autentikasi lewat JWT di query saat handshake.

| Kanal | Event | Payload | Pemicu | v0.1 |
|---|---|---|---|---|
| `squad:{id}` | `score.updated` | `{user_id, points, user_total, squad_total}` | Outbox worker setelah ZINCRBY | ✅ aktif |
| `user:{id}` | `streak.updated` | `{current, longest, date}` | Outbox worker | ⛔ polling |
| `user:{id}` | `wallet.updated` | `{balance, last_entry}` | Outbox worker | ⛔ polling |
| `user:{id}` | `job.completed` | `{job_id, kind, status, result_url}` | Worker scan/AI | ⛔ polling |
| `league:{tier}` | `standings.updated` | `{season, top: [...]}` | Throttle 10 detik | ⛔ polling |

> Klien **wajib** punya fallback polling 30 detik. Mematikan WS server tidak boleh membuat layar mana pun kosong atau error.

---

## 12. Integrasi eksternal

Aturan umum untuk **semua** vendor:

1. Setiap vendor di balik **antarmuka** (`PaymentProvider`, `PlagiarismProvider`, `LlmProvider`, `EmailProvider`), sehingga bisa diganti tanpa menyentuh logika bisnis.
2. Kredensial **hanya** dari environment variable. Tidak pernah di kode, tidak pernah di log.
3. Setiap panggilan keluar punya **timeout eksplisit** dan **retry dengan backoff**.
4. Kegagalan vendor **tidak pernah** meninggalkan koin pengguna tertahan — lihat pola hold/release.
5. Setiap vendor punya **budget alert harian**.

### 12.1 Midtrans (payment)

| Aspek | Detail |
|---|---|
| Produk | Snap **hosted checkout** |
| Metode v1 | QRIS saja |
| Env | `MIDTRANS_SERVER_KEY`, `MIDTRANS_CLIENT_KEY`, `MIDTRANS_IS_PRODUCTION` |
| Alur | `POST /payments/checkout` → buat `orders` pending → `snap.createTransaction` → kembalikan `token` + `redirect_url` |
| Verifikasi webhook | `SHA512(order_id + status_code + gross_amount + server_key)` dibandingkan dengan `signature_key` |
| Status yang diterima | `settlement`, `capture` (dengan `fraud_status=accept`) → `paid` |
| Status lain | `deny`, `cancel`, `expire` → `failed`/`expired`, tanpa koin |
| Timeout | 10 detik untuk create transaction |
| Idempotensi | Pada `order_id`. Order sudah `paid` → balas 200 tanpa aksi. |

> **Jangan pernah menambah koin dari respons redirect client.** Satu-satunya sumber yang boleh dipercaya adalah webhook bertanda tangan dari sisi server. Halaman "pembayaran berhasil" hanyalah tampilan — pengguna bisa memanggilnya sendiri.

### 12.2 Copyleaks (plagiarisme)

| Aspek | Detail |
|---|---|
| Env | `COPYLEAKS_EMAIL`, `COPYLEAKS_API_KEY`, `COPYLEAKS_WEBHOOK_SECRET` |
| Alur | login → dapat access token (cache 24 jam) → submit scan dengan `scanId` milik kita → vendor memanggil webhook kita |
| `scanId` | Pakai `plagiarism_scans.id` sebagai `scanId` agar korelasi tidak perlu tabel tambahan |
| Timeout submit | 30 detik |
| Timeout hasil | 30 menit — setelah itu reaper melepas hold |
| Retry | 3× dengan backoff eksponensial untuk kegagalan jaringan; **tidak** retry untuk 4xx |
| Budget alert | Jumlah scan harian melewati ambang → alert |

**Antarmuka provider:**

```ts
interface PlagiarismProvider {
  readonly name: string;
  submit(p: { scanId: string; documentUrl: string; filename: string }): Promise<{ providerScanId: string }>;
  verifyWebhook(headers: Record<string,string>, rawBody: Buffer): boolean;
  parseWebhook(body: unknown): { scanId: string; score: number; reportUrl: string } | { scanId: string; error: string };
}
```

### 12.3 LLM (OpenAI / Gemini)

| Aspek | Detail |
|---|---|
| Env | `LLM_PROVIDER` (`openai`\|`gemini`), `OPENAI_API_KEY`, `GEMINI_API_KEY`, `LLM_MODEL` |
| Model default | `gpt-4o` untuk penyusunan CV; `gpt-4o-mini` untuk feedback Mastery & Prompt Lab |
| Temperature | **0,2** untuk penyusunan CV (tugas penataan, bukan kreatif); 0,5 untuk feedback |
| Output | **JSON mode / structured output** dengan skema Pydantic. JSON tidak valid → retry sekali dengan instruksi perbaikan, lalu gagal. |
| Timeout | 60 detik |
| Cache | `SHA-256(sumber + parameter + prompt_version)`, TTL 7 hari |
| Pencatatan biaya | `input_tokens`, `output_tokens`, `cost_usd` ke `ai_jobs` setiap panggilan |
| **Hard limit** | **Pasang batas biaya di dashboard vendor sejak hari pertama**, bukan setelah tagihan pertama |
| Budget alert | Biaya harian melewati ambang → alert ke Superadmin |

### 12.4 Resend (email)

| Aspek | Detail |
|---|---|
| Env | `RESEND_API_KEY`, `EMAIL_FROM` |
| Template | Verifikasi email, reset password, peringatan streak, job selesai, ringkasan harian |
| Pengujian | Template wajib lulus render di Gmail dan Outlook sebelum rilis |
| Retry | 3× lalu catat ke `notifications.sent_at = NULL` + `audit_log` — tidak hilang diam-diam |
| Unsubscribe | Setiap email punya tautan berhenti berlangganan yang berfungsi |

### 12.5 Retool (panel admin)

| Aspek | Detail |
|---|---|
| Koneksi | Role PostgreSQL **read-only** ke view `v_transactions`, `v_audit`, `v_vendor_cost` |
| Aksi tulis | Hanya lewat endpoint resmi dengan API key khusus Retool |
| Audit | Setiap aksi tulis tercatat di `audit_log` dengan `actor_id` |

### 12.6 Object storage (S3-compatible)

| Aspek | Detail |
|---|---|
| Dev | MinIO lewat docker-compose |
| Bucket | `strive-documents` (privat), `strive-assets` (privat), `strive-public` (avatar) |
| Akses | **Signed URL 15 menit.** Tidak ada bucket publik untuk dokumen pengguna. |
| Enkripsi | Server-side encryption aktif |
| Retensi | Dokumen scan dihapus otomatis setelah 90 hari; laporan disimpan 1 tahun |

---

## 13. AI pipeline

### 13.1 Batas tanggung jawab

```
Core API (Node)              AI Service (Python FastAPI)
─────────────────            ──────────────────────────
membuat ai_jobs         →    menerima job
memotong koin                mengekstraksi dokumen
mencatat biaya               memanggil LLM
mengirim notifikasi          menilai (deterministik)
                             merender output
                        ←    mengembalikan hasil + usage
```

**Node tidak pernah memanggil LLM langsung.** Batas ini yang membuat biaya LLM bisa diaudit di satu tempat.

### 13.2 Pipeline ATS CV

| # | Tahap | Di mana | Masuk → keluar |
|---|---|---|---|
| 1 | Buat job | Core API | `POST /career/cv` → baris `ai_jobs` (`queued`) + `202` |
| 2 | Dispatch | Worker | Job → `POST` ke AI service dengan token service-to-service |
| 3 | Ekstraksi | FastAPI | PDF/DOCX lama **atau** profil pengguna → teks mentah |
| 4 | Penyusunan | FastAPI + LLM | Teks mentah → JSON terstruktur (`StructuredCV`) |
| 5 | **Penilaian ATS** | FastAPI | JSON → skor 0–100 + daftar temuan. **Deterministik, tanpa LLM.** |
| 6 | Render | FastAPI | JSON → PDF satu kolom |
| 7 | Simpan | Worker | Object storage + `cv_documents`; job → `done` |
| 8 | Kabari | Core API | WS `user:{id}` → `job.completed` (atau polling) |

### 13.3 Aturan penilaian ATS (deterministik)

Skor mulai 100, dikurangi per pelanggaran. Setiap aturan mencerminkan perilaku parser ATS nyata, bukan selera desain.

| Aturan | Penalti | Severity |
|---|---:|---|
| Email tidak ada / tidak valid | −20 | error |
| Nomor telepon tidak ada | −5 | warning |
| Ringkasan < 25 kata | −8 | warning |
| Ringkasan > 120 kata | −5 | info |
| Tidak ada pengalaman sama sekali | −25 | error |
| Format tanggal bukan `YYYY-MM` | −4 per kejadian | error |
| Peran tanpa poin capaian | −6 per peran | warning |
| Tidak ada poin terukur (tanpa angka) | −5 per peran | warning |
| Mayoritas poin tidak mulai kata kerja aktif | −3 per peran | info |
| > 6 poin per peran | −2 per peran | info |
| Skill < 5 | −6 | warning |
| Skill > 25 | −4 | info |
| Pendidikan kosong | −8 | warning |
| Tanggal selesai < tanggal mulai | −6 per kejadian | error |

### 13.4 Aturan prompt

1. **Prompt berversi.** Konstanta `PROMPT_VERSION` (contoh `ats-cv/2026-09-01`) disimpan di `ai_jobs.prompt_version`. Mengubah prompt = menaikkan versi = cache batal.
2. **Prompt disimpan di file terpisah** (`app/prompts/`), bukan di dalam fungsi, agar bisa di-review dan di-diff.
3. **Larangan halusinasi ditulis eksplisit** di system prompt: *"JANGAN menambahkan pengalaman, gelar, angka, atau capaian yang tidak ada di sumber. Kalau sebuah field tidak ada datanya, kosongkan — jangan mengarang."*
4. **Diuji dengan 5 dokumen kontrol** di test suite yang memeriksa tidak ada fakta baru yang muncul.
5. **Output selalu ditandai sebagai saran**, bukan penilaian resmi — di UI dan di payload.

### 13.5 Pengendalian biaya

| Mekanisme | Detail |
|---|---|
| Cache hash | Input identik tidak menagih biaya LLM dua kali |
| Kuota harian | 10 run AI per pengguna per hari |
| Model berjenjang | `gpt-4o-mini` untuk tugas ringan, `gpt-4o` hanya untuk penyusunan CV |
| Batas token output | Eksplisit per jenis job (CV 3.000, feedback 800) |
| Hard limit vendor | Di dashboard vendor, sejak hari pertama |
| Alert harian | Biaya melewati ambang → notifikasi ke Superadmin di hari yang sama |

---

## 14. Design system

Satu set token, **dua profil kepadatan**: Student bermain, Console (mentor + superadmin) padat.

### 14.1 Palet

Setiap warna aksen dipatok ke **satu makna** dan tidak boleh dipinjam. Ini aturan yang paling sering dilanggar di produk gamified: begitu oranye dipakai untuk tombol biasa, api streak berhenti berarti.

| Token | Terang | Gelap | Makna |
|---|---|---|---|
| `indigo-600` | `#4F3DE8` | `#8477FF` | Aksi utama, tautan, fokus. Warna merek. |
| `flame-500` | `#FF6B35` | `#FF7A45` | **Streak dan hanya streak.** Tidak untuk CTA. |
| `coin-500` | `#FFC24B` | `#FFC94F` | Strive Coins, hadiah, liga Gold |
| `mint-500` | `#14B88A` | `#2FCB9C` | Benar, selesai, tervalidasi |
| `rose-500` | `#E5484D` | `#F26B70` | Salah, gagal, destruktif |
| `ink-900` | `#14122B` | `#F0EDFF` | Teks utama (netral berbias indigo) |
| `ink-500` | `#7C74A3` | `#8A82B4` | Teks sekunder, label |
| `paper` | `#FBFAFE` | `#0D0B1A` | Latar aplikasi |
| `surface` | `#FFFFFF` | `#161231` | Latar kartu |
| `line` | `#E4E0F3` | `#2A2452` | Garis pemisah |

> **Mode gelap bukan inversi.** Setiap token punya nilai gelap yang ditulis terpisah. Uji kontras setiap aksen di kedua latar sebelum token dikunci. Kontras teks utama minimal **4,5:1**.

### 14.2 Tipografi

| Peran | Font | Ukuran | Bobot |
|---|---|---|---|
| Display | Bricolage Grotesque | 40px | 800 |
| Judul | Bricolage Grotesque | 24px | 700 |
| Body | Plus Jakarta Sans | 15px | 400 |
| Caption | Plus Jakarta Sans | 13px | 500 |
| Label | JetBrains Mono | 11px, `letter-spacing: .1em`, uppercase | 500 |
| Data/angka | JetBrains Mono, `tabular-nums` | 14px | 400 |

**Plus Jakarta Sans** dipilih karena tinggi x-nya besar (terbaca di kartu kecil) dan menangani diakritik Indonesia dengan benar.

### 14.3 Spacing, radius, gerak

| Token | Nilai | Profil Student | Profil Console |
|---|---|---|---|
| Basis spacing | 4px | skala 4·8·12·16·24·32·48 | sama, padding kartu −1 langkah |
| `--r-card` | | 18px — lembut, mengundang swipe | 8px — padat, mudah dipindai |
| `--r-ctl` | | 999px (pill) | 6px |
| `--t-base` | | 320 ms `cubic-bezier(.34,1.56,.64,1)` | 160 ms `ease-out` |
| `--t-cel` | | 640 ms — confetti koin, api streak | tidak ada |
| Maskot | | toast kontekstual, maks 3/hari | tidak pernah tampil |
| Bayangan | | hanya pada kartu yang bisa di-swipe | hanya pada popover & menu |

**Aturan gerak.** Animasi hanya untuk dua hal: (1) memberi tahu bahwa sesuatu diperoleh, (2) menunjukkan asal-tujuan. Gerakan dekoratif dimatikan. Semua durasi jadi 0 saat `prefers-reduced-motion` — **Framer Motion menghormati ini lewat `useReducedMotion()`, tapi harus dipanggil, tidak otomatis.**

### 14.4 Komponen wajib

| Komponen | Varian | Catatan |
|---|---|---|
| `StreakChip` | `active` · `at_risk` · `frozen` · `broken` | `broken` **tidak pernah merah** |
| `CoinPill` | saldo · delta positif · delta negatif | `tabular-nums` |
| `LeagueBadge` | bronze · silver · gold | Gradien metalik **hanya** di dalam badge |
| `LessonCard` | multiple_choice · swipe_binary | radius 18px, bayangan, swipe |
| `ConsoleRow` | default · menunggu · selesai | radius 8px, tanpa bayangan |
| `QuestProgress` | 0/3 · 1/3 · 2/3 · selesai | |
| `EmptyState` | setiap daftar wajib punya | Tidak ada layar kosong tanpa penjelasan |
| `ErrorState` | dengan aksi coba lagi | Menampilkan `code`, bukan stack trace |

### 14.5 Aksesibilitas

- Kontras teks utama ≥ 4,5:1, teks besar ≥ 3:1, di **kedua** mode
- Seluruh alur inti bisa diselesaikan **dengan keyboard saja**
- `:focus-visible` terlihat jelas di setiap elemen interaktif
- Kartu swipe punya alternatif tombol (swipe bukan satu-satunya cara)
- Setiap gambar/ikon bermakna punya `aria-label`
- `prefers-reduced-motion` dihormati di semua animasi

---

## 15. Non-functional requirements

### 15.1 Performa

| Metrik | Target | Cara ukur |
|---|---|---|
| `GET /hub` p95 | < 250 ms @ 500 rps | Load test `R-02` |
| `GET /squads/:id/leaderboard` p95 | < 250 ms @ 500 rps | Load test `R-02` |
| `POST /attempts` p95 | < 400 ms | Load test |
| First Contentful Paint (halaman publik) | < 1,5 detik | Lighthouse |
| Largest Contentful Paint (Hub) | < 2,5 detik | Lighthouse |
| Waktu CI penuh | < 5 menit | — |
| E2E suite | < 8 menit | — |

> **Target dinyatakan sebagai throughput + latensi, bukan "N concurrent users".** "10.000 concurrent" tidak bisa diuji dan tidak memberi tahu apa pun tentang apa yang harus dioptimalkan. 500 rps dengan p95 < 250 ms bisa dites dan dicapai satu instance Postgres + satu Redis.

### 15.2 Skala target beta

| Dimensi | Target |
|---|---|
| Pengguna terdaftar | 5.000 |
| Pengguna aktif harian | 500 |
| Attempt per hari | 1.500 |
| Scan per hari | 30 |
| Job AI per hari | 100 |

### 15.3 Ketersediaan

| Aspek | Target |
|---|---|
| Uptime | 99,5% (beta) — bukan 99,9%, karena tidak ada tim on-call 24/7 |
| RPO (kehilangan data maksimum) | 5 menit — PITR PostgreSQL |
| RTO (waktu pulih) | 1 jam |
| Kehilangan Redis | **Bukan insiden.** Semua isinya dibangun ulang otomatis. |

### 15.4 Kompatibilitas

- Browser: 2 versi terakhir Chrome, Safari, Firefox, Edge
- Mobile: iOS Safari 16+, Android Chrome 110+
- Lebar layar minimum: **360px**
- PWA: installable, offline shell (bukan offline penuh)

---

## 16. Keamanan & privasi

### 16.1 Checklist wajib sebelum rilis (`R-03`)

- [ ] TLS 1.3, HSTS aktif
- [ ] Password Argon2id, tidak pernah di log
- [ ] JWT ditandatangani dengan secret ≥ 32 byte dari env
- [ ] Refresh token disimpan sebagai **hash**, bukan plaintext
- [ ] Deteksi token reuse aktif dan mencabut rantai sesi
- [ ] Rate limit 120 req/menit per pengguna, lebih ketat untuk `/auth/*` (10/menit)
- [ ] Webhook memverifikasi signature **sebelum** memproses apa pun
- [ ] Upload divalidasi tipe **dan** magic bytes, bukan hanya ekstensi
- [ ] Upload disimpan di luar webroot, diakses hanya lewat signed URL
- [ ] Tidak ada bucket publik untuk dokumen pengguna
- [ ] Query memakai parameter binding (Kysely), tidak ada string concat
- [ ] Header keamanan: `Content-Security-Policy`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`
- [ ] CORS whitelist eksplisit, bukan `*`
- [ ] Secret tidak pernah masuk log, error message, atau respons API
- [ ] Dependency audit (`pnpm audit`, `pip-audit`) nol kerentanan tinggi
- [ ] Kepemilikan sumber daya dicek di service, bukan hanya di guard
- [ ] Reviewer tidak bisa melihat identitas penulis di respons API mana pun
- [ ] OWASP ASVS Level 1 tuntas

### 16.2 Data pribadi

| Data | Klasifikasi | Perlakuan |
|---|---|---|
| Email, nama | PII | Terenkripsi at rest (disk), tidak dibagikan |
| Password | Rahasia | Argon2id, tidak pernah bisa dibaca |
| Dokumen skripsi | **Sensitif** | Signed URL saja, dihapus otomatis 90 hari |
| CV & personal statement | **Sensitif** | Sama; tidak dipakai untuk melatih model |
| Riwayat belajar | Internal | Dipakai untuk analytics agregat |
| Saldo & transaksi | Finansial | Audit log, akses Superadmin tercatat |

**Komitmen yang harus ditulis di kebijakan privasi:**
- Dokumen pengguna **tidak** dipakai untuk melatih model AI
- Data dikirim ke vendor LLM hanya untuk memproses permintaan pengguna itu
- Pengguna bisa meminta ekspor dan penghapusan akun

### 16.3 Penghapusan akun

- Soft delete: `users.status='deleted'`, PII di-anonimkan (`email` → `deleted-{id}@invalid`, `display_name` → `Pengguna terhapus`)
- `coin_ledger` **tidak dihapus** — catatan finansial wajib disimpan, tapi tidak lagi terhubung ke identitas
- Dokumen di object storage dihapus permanen dalam 7 hari
- Kontribusi peer review jadi anonim, tidak dihapus (agar skor squad historis tetap konsisten)

---

## 17. Observability & alerting

### 17.1 Log

- **Terstruktur JSON**, bukan teks bebas
- Wajib ada: `request_id`, `user_id` (kalau ada), `route`, `duration_ms`, `status`
- **Tidak boleh ada**: password, token, isi dokumen, API key
- Level: `error` untuk yang butuh tindakan, `warn` untuk anomali, `info` untuk peristiwa bisnis

### 17.2 Metrik yang dipantau

| Metrik | Ambang alert |
|---|---|
| Error rate 5xx | > 1% selama 5 menit |
| p95 latency `/hub` | > 500 ms selama 10 menit |
| Panjang antrean BullMQ | > 100 job selama 10 menit |
| Outbox pending | > 500 baris selama 5 menit |
| Selisih rekonsiliasi koin | **apa pun ≠ 0** |
| Biaya LLM harian | > ambang yang disepakati |
| Jumlah scan harian | > ambang yang disepakati |
| Hold menggantung > 30 menit | > 0 |
| Kegagalan webhook payment | > 3 dalam 1 jam |

### 17.3 Runbook wajib (`R-04`)

Tiga skenario harus punya runbook tertulis sebelum rilis:

1. **Redis mati.** Langkah: verifikasi Postgres sehat → restart Redis → jalankan `rebuildAllSquads()` → verifikasi papan → tidak perlu maintenance mode.
2. **Vendor scan down.** Langkah: matikan tombol scan di UI lewat feature flag → reaper melepas hold otomatis → umumkan ke pengguna yang punya scan tertahan.
3. **Biaya LLM melonjak.** Langkah: cek `ai_jobs` per pengguna → turunkan kuota harian lewat config → kalau pola abuse, suspend akun → naikkan hard limit vendor kalau memang organik.

---

## 18. Strategi testing

### 18.1 Piramida

| Lapisan | Cakupan | Alat | Target |
|---|---|---|---|
| Unit | Logika murni: formula poin/koin, skor ATS, perhitungan streak | Vitest, pytest | Setiap formula punya test |
| Integrasi | Service + database nyata (testcontainers) | Vitest | **Semua jalur uang wajib** |
| Kontrak | Skema zod cocok antara web dan api | tsc | Otomatis lewat tipe |
| E2E | Alur inti dari browser | Playwright | 1 alur utuh |

### 18.2 Yang wajib punya test, tanpa pengecualian

| Area | Kenapa |
|---|---|
| Setiap penulisan `coin_ledger` | Uang |
| Idempotensi `POST /attempts`, webhook, hold/release | Duplikasi = kerugian nyata |
| Rollback transaksi `POST /attempts` | Konsistensi lintas 6 tabel |
| Perhitungan streak lintas zona waktu & tengah malam | Bug yang tidak muncul di UTC |
| Matriks akses RBAC | Setiap peran salah harus ditolak di setiap rute |
| Anonimitas peer review | Kebocoran identitas |
| Rebuild ZSET dari Postgres | Jaminan "Redis boleh hilang" |
| Verifikasi signature webhook | Gerbang uang |
| Determinisme skor ATS | Janji ke pengguna |
| Larangan halusinasi LLM (5 dokumen kontrol) | Kepercayaan |

### 18.3 Alur E2E (`R-01`)

```
1. Daftar akun baru
2. Selesaikan satu lesson  → cek koin bertambah, streak = 1
3. Cek Hub                 → quest 1/3, saldo benar
4. Top-up sandbox          → cek koin bertambah setelah webhook
5. Upload dokumen scan     → cek hold, tunggu hasil sandbox, cek settle
6. Buka dompet             → cek riwayat ledger lengkap dan benar
```

---

## 19. Environment & deployment

### 19.1 Tiga environment

| Env | Untuk | Data | Vendor |
|---|---|---|---|
| `local` | Pengembangan | docker-compose (PG, Redis, MinIO) | Semua sandbox/mock |
| `staging` | Verifikasi & gate mingguan | DB terkelola kecil | Semua sandbox |
| `production` | Beta tertutup | DB terkelola + PITR | Live |

### 19.2 Variabel environment

```bash
# Proses
MODE=api                  # api | worker — satu image, dua peran (lihat §8.1)
WEB_PORT=3000             # Next.js
API_PORT=3001             # NestJS
AI_SERVICE_PORT=8000      # FastAPI

# Core
NODE_ENV=                 # development | production
APP_URL=                  # https://app.striveacademy.id
API_URL=
DATABASE_URL=             # postgres://...
REDIS_URL=                # redis://...

# Auth
AUTH_SECRET=              # >= 32 byte
ACCESS_TOKEN_TTL=15m
REFRESH_TOKEN_TTL=30d

# Storage
S3_ENDPOINT= S3_BUCKET_DOCUMENTS= S3_BUCKET_ASSETS=
S3_ACCESS_KEY= S3_SECRET_KEY=

# Payment
MIDTRANS_SERVER_KEY= MIDTRANS_CLIENT_KEY= MIDTRANS_IS_PRODUCTION=false

# Plagiarisme
COPYLEAKS_EMAIL= COPYLEAKS_API_KEY= COPYLEAKS_WEBHOOK_SECRET=

# LLM
LLM_PROVIDER=openai
OPENAI_API_KEY= GEMINI_API_KEY= LLM_MODEL=gpt-4o
AI_SERVICE_URL= AI_SERVICE_TOKEN=

# Email
RESEND_API_KEY= EMAIL_FROM=

# Observability
SENTRY_DSN= LOG_LEVEL=info

# Feature flags
FEATURE_SCAN_ENABLED=true
FEATURE_MASTERY_ENABLED=true
FEATURE_WS_ENABLED=true
```

### 19.3 Feature flag

Empat fitur wajib punya kill switch agar bisa dimatikan tanpa deploy:

| Flag | Kenapa |
|---|---|
| `FEATURE_SCAN_ENABLED` | Vendor down → matikan tombol, hindari hold tertahan |
| `FEATURE_MASTERY_ENABLED` | Fitur `preview`, mungkin perlu dimatikan cepat |
| `FEATURE_WS_ENABLED` | WS bermasalah → paksa semua klien ke polling |
| `FEATURE_TOPUP_ENABLED` | Masalah payment → hentikan penjualan, bukan seluruh app |

### 19.4 Migrasi

- SQL murni, berurut, **forward-only**
- Dijalankan otomatis saat deploy, **sebelum** aplikasi versi baru menerima trafik
- Setiap migrasi harus aman dijalankan saat versi lama masih berjalan (expand/contract)
- **Tidak ada `DROP COLUMN` dalam deploy yang sama dengan kode yang berhenti memakainya** — pisahkan ke deploy berikutnya

---

## 20. Analytics & metrik sukses

### 20.1 Metrik utara

**D7 retention.** Kalau orang tidak kembali di hari ke-7, tidak ada fitur berbayar yang akan menyelamatkan produk ini.

### 20.2 Metrik yang dipantau sejak beta

| Metrik | Target beta | Kenapa |
|---|---|---|
| D1 retention | > 40% | Onboarding bekerja |
| **D7 retention** | **> 25%** | Loop harian bekerja |
| D30 retention | > 12% | Produk punya tempat di kebiasaan |
| Rata-rata streak aktif | > 4 hari | Mekanisme streak bekerja |
| Lesson per pengguna aktif per hari | > 2 | Quest 3/hari realistis |
| % pengguna dalam squad aktif | > 70% | Auto-assign bekerja |
| Konversi ke top-up pertama | > 5% | Monetisasi bekerja |
| Scan per pengguna berbayar | > 1,5 | Ada pembelian berulang |
| Cache hit rate scan | > 15% | Dedup memberi margin |
| Biaya LLM per pengguna aktif | < Rp 500/bulan | Biaya terkendali |

### 20.3 Gate keputusan

| Kalau | Maka |
|---|---|
| D7 < 15% | Masalahnya **konten modul**, bukan gamifikasi. Jangan tambah mekanik baru di atas loop yang bocor. |
| D7 25–35% | Loop bekerja. Fokus ke konversi monetisasi. |
| Konversi top-up < 2% | Harga terlalu tinggi **atau** nilai scan belum terasa. Uji harga sebelum menambah fitur. |
| Cache hit < 5% | Asumsi dedup salah. Hitung ulang margin. |

---

## 21. Risiko produk

| Risiko | Dampak | Mitigasi |
|---|---|---|
| **Retensi core loop tidak tercapai** | Tinggi | Ukur D1/D7/D30 sejak beta pertama. D7 < 15% → perbaiki konten, bukan tambah mekanik. |
| **Biaya LLM & plagiarisme lepas kendali** | Tinggi | Dedup SHA-256, kuota harian, alarm biaya harian per vendor, hard limit di dashboard vendor. Harga koin di atas biaya vendor terburuk. |
| **Status hukum koin berbayar** | Tinggi | Koin non-transferable, non-refundable, tidak kedaluwarsa = voucher sekali pakai. **Konsultasi hukum sebelum top-up dibuka.** |
| **Manipulasi skor liga** | Tinggi | Reviewer lintas squad & anonim, cap 5 review/hari, 1× lesson berhadiah/hari, cap 1 pindah squad/musim. |
| **Konten modul tidak siap** | Tinggi | Pemilik konten di luar tim developer sejak hari pertama. Lihat `DELIVERY-PLAN.md` §6. |
| **Ketergantungan satu vendor plagiarisme** | Sedang | Antarmuka `PlagiarismProvider` sejak awal; kolom `provider` per scan. |
| **Halusinasi LLM merusak kepercayaan** | Sedang | Larangan eksplisit di prompt, 5 dokumen kontrol di test, output ditandai sebagai saran. |
| **Vendor payment lambat verifikasi merchant** | Sedang | Pakai sandbox sampai rilis; go-live payment jadi item pasca-beta. |
| **Squad timpang membuat liga tidak seru** | Sedang | Pengelompokan berdasarkan rata-rata poin 2 minggu; squad < 3 anggota digabung. |

---

## 22. Out of scope

Ditulis eksplisit agar tidak diam-diam masuk kembali.

| Tidak dibangun | Catatan |
|---|---|
| Multi-tenancy / B2B / white-label | Tidak ada `tenant_id` di skema mana pun |
| Blockchain, wallet, minting, SBT | Tidak ada dependensi chain |
| Kartu NFC / phygital | Tidak ada modul hardware |
| Kanban board & AI SOP converter | Fitur workspace tim, bukan B2C |
| Aplikasi native iOS/Android | PWA cukup untuk beta |
| Live class / video conference | — |
| Marketplace mentor berbayar | — |
| Web Push browser | Ditunda ke pasca-rilis (§7 E16) |
| Ekspor CV ke DOCX | Ditunda ke pasca-rilis (§7 E8) |
| Kalibrasi bobot reviewer otomatis | Ditunda ke pasca-rilis (§7 E11) |
| Simulasi wawancara adaptif multi-putaran | Ditunda ke pasca-rilis (§7 E12) |
| Kartu tipe `order_steps` & `reveal` | Ada di skema, tidak di UI v1 |

---

## 23. Catatan perubahan

| Tanggal | Versi | Perubahan | Oleh |
|---|---|---|---|
| 14 Sep 2026 | 2.0 | Versi awal end-to-end. Scope B2C dikunci, 17 epik, ekonomi koin ditetapkan. | — |
| 14 Sep 2026 | 2.0.1 | **§9** jumlah tabel dikoreksi 26 → **31**, dihitung ulang dari daftar §9.1 yang tidak berubah. Angka 26 tidak pernah cocok dengan daftarnya; acceptance criteria `F-04` ikut dikoreksi. Tidak ada tabel yang ditambah atau dibuang. | sesi fondasi repo |
| 14 Sep 2026 | 2.0.1 | **§19.2** menambah `MODE`, `WEB_PORT`, `API_PORT`, `AI_SERVICE_PORT`. `MODE=api\|worker` sudah jadi keputusan arsitektur di §8.1 tapi tidak pernah tercantum sebagai variabel environment. | sesi fondasi repo |
| 14 Sep 2026 | 2.0.1 | **§5** ditegaskan memblokir `F-04`. Tidak ada angka keputusan yang diubah. | sesi fondasi repo |
| 14 Sep 2026 | **2.1** | **§5 DIKUNCI: USULAN → TERKUNCI.** Kedelapan keputusan disetujui apa adanya; **nol angka berubah**. `F-04` tidak lagi terblokir dari sisi keputusan. Dua kewajiban dicatat eksplisit sebagai TIDAK ikut terkunci dan tetap memblokir pembukaan top-up: konsultasi hukum (Q2) dan harga kontrak Copyleaks (Q7). | **Fatih Maulana** |
| 15 Sep 2026 | **2.2** | **§7 E1 + §9 — skema auth mengikuti Better-Auth (isu #18, jalan 1).** `account` dan `verification` ditambahkan (31 → **33** tabel), `session.token` ditambahkan, `users.password_hash` jadi nullable dan berhenti dipakai, `refresh_tokens` dipertahankan tapi tidak dipakai. **AU-4 diubah** (sesi server, bukan JWT + rotasi) dan **AU-5 DIBUANG** — deteksi pemakaian ulang token tidak punya padanan di Better-Auth. Pelemahan keamanan yang disengaja, dengan tiga penggantinya dicatat sebagai kewajiban `A-01`. | **Fatih Maulana** |
| 15 Sep 2026 | 2.2 | **§9.3 — `peer_reviews.attempt_date` ditambahkan** beserta FK `(attempt_id, attempt_date) → lesson_attempts` (isu #15). Tanpa kolom ini FK mustahil: PK `lesson_attempts` adalah `(id, attempt_date)` karena terpartisi, dan PostgreSQL mewajibkan FK menunjuk seluruh PK. Poin liga berbobot dihitung dari tabel ini, jadi review yang menunjuk attempt fantom = poin fantom. | **Fatih Maulana** |
| 15 Sep 2026 | 2.2 | **§10.2 — 4 kode error ditambahkan** (`NOT_FOUND`, `SQUAD_FULL`, `ALREADY_IN_SQUAD`, `SQUAD_MOVE_LIMIT`) dan daftarnya **dinyatakan tertutup** (isu #25). Keempatnya sudah dipakai di kode sebelum ada di sini — urutan terbalik yang justru jadi alasan catatan "tertutup" itu ditulis. | **Fatih Maulana** |
| 15 Sep 2026 | 2.2 | **§9 CO-6 ditulis ulang** (isu #27). Teks lama menjanjikan pengecualian saldo negatif untuk `entry_type='adjust'` yang **database-nya tidak punya** — CHECK `users_coin_balance_non_negative` tidak mengenal pengecualian, jadi setengah CO-6 tidak pernah bisa dijalankan. Sekarang: saldo tidak pernah negatif, koreksi Superadmin dibatasi saldo tersedia. | **Fatih Maulana** |
| 17 Sep 2026 | **2.3** | **`A-01` selesai — §7 E1 & §9 diselaraskan dengan skema yang benar-benar dibuat.** Tabelnya `auth_accounts` & `auth_verifications` (jamak + berprefiks, supaya tidak terbaca seperti tabel keuangan di sebelah `orders`/`payments`), bukan `account`/`verification`. `users.email_verified` boolean menggantikan `email_verified_at` (isu #35 opsi 1). `sessions` dapat `token` & `updated_at`, dan `ip` dilebarkan inet → text. `password_hash`, `email_verified_at`, dan `refresh_tokens` ditandai USANG — dibuang di migrasi contract, bukan sekarang. | **Fatih Maulana** |
| 17 Sep 2026 | 2.3 | **`AC-AU-2` ditulis ulang.** Versi lama masih menuntut deteksi pemakaian ulang refresh token — AU-5 yang dibuang isu #18 — sehingga `A-01` punya kriteria yang mustahil dipenuhi. Diganti dengan pencabutan massal saat ganti password, dan apa yang HILANG ditulis di dalam kriterianya sendiri supaya tidak lenyap dari ingatan. | **Fatih Maulana** |
| | | _Isi baris baru setiap kali ada keputusan yang mengubah dokumen ini._ | |

---

## Lampiran A — Hubungan antar dokumen

```
PRD.md            sumber kebenaran PERILAKU    (apa yang harus terjadi)   ← file ini
BACKLOG.md        sumber kebenaran ESTIMASI    (berapa lama, siapa, kapan)
DELIVERY-PLAN.md  sumber kebenaran JADWAL      (urutan, gate, konfigurasi)
CLAUDE.md         sumber kebenaran KONVENSI    (bagaimana menulis kodenya)
MASTER-PROMPT.md  instruksi untuk Claude Code  (cara memakai keempatnya)
```

Kalau ada pertentangan: **PRD menang untuk perilaku**, **BACKLOG menang untuk angka**, **CLAUDE.md menang untuk konvensi kode**.

## Lampiran B — State machine

**Scan plagiarisme**

```
                   ┌──────────────► done ────► settle (audit_log)
                   │  webhook OK
   queued ────► running
     │             │  error / >30 mnt
     │             └──────────────► released ──► release (+koin)
     │
     └─ cache hit ────────────────► done (tarif diskon, vendor tidak dipanggil)

   Reaper: queued|running > 30 menit → released
```

**Order pembayaran**

```
   pending ──webhook settlement──► paid ──► entri 'purchase' (+koin)
      │
      ├──webhook deny/cancel────► failed
      └──24 jam tanpa webhook───► expired
```

**Streak**

```
   gap = 0  → already_active   (tidak berubah)
   gap = 1  → extended         (current + 1)
   gap > 1  → restarted        (current = 1, longest tetap)
   freeze   → frozen           (last_activity_date = hari ini, current tetap)
```

## Lampiran C — Formula

```
points = max(1, round(base_points × (0,5 + score / 200)))
coins  = max(5, round(base_coins  × (0,4 + (score / 100) × 0,6)))

hari_lokal_pengguna = (now() AT TIME ZONE users.timezone)::date

season_code = ISO week → "YYYY-Www"   contoh "2026-W37"

promosi  = 20% teratas   (tidak berlaku di Gold)
degradasi = 20% terbawah (tidak berlaku di Bronze)

ats_score = max(0, min(100, 100 − Σ penalti))
```

