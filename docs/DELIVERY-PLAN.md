# DELIVERY PLAN — Strive Academy

> **Versi:** 2.0 · semua fitur · 2 developer · 8 minggu
> **Diturunkan dari:** `BACKLOG.md` (sumber kebenaran estimasi) dan `PRD.md` (sumber kebenaran perilaku)
> **Beban:** 72,5 dev-hari terhadap 68 tersedia — **107% terisi, tanpa cadangan**

---

## Ringkasan satu paragraf

Seluruh 17 epik masuk dalam 8 minggu untuk 2 developer — tapi hanya pada **kedalaman v0.1**, dengan tiga komponen dibeli alih-alih dibangun, dan dengan konsekuensi yang tidak bisa dihindari: minggu ke-8 mengerjakan fitur terakhir (Mastery Track) bersamaan dengan pengerasan. Kelebihannya 4,5 dev-hari — setengah minggu, bukan sebulan. §7 menyebut tiga cara menutupnya; yang paling murah adalah menambah satu minggu.

---

## 1. Kapasitas nyata

| | Dev-hari | Keterangan |
|---|---:|---|
| Kotor | 80 | 2 orang × 8 minggu × 5 hari |
| Overhead | −12 | 15% untuk code review, sinkron harian, triase bug, context switch |
| **Efektif** | **68** | Yang benar-benar bisa dipakai membangun |
| Backlog kedalaman penuh | 110 | Semua fitur seperti di blueprint |
| Setelah penipisan (§2 tuas 1) | 89 | −21 hari |
| Setelah membeli komponen (§2 tuas 2) | **72,5** | −16,5 hari — **rencana ini** |
| **Selisih** | **+4,5** | Kelebihan beban. Tidak ada cadangan. |

Per developer: Dev A **37,25** hari terhadap 34 tersedia (110%), Dev B **35,25** terhadap 34 (104%).

> **Keduanya di atas 100%, dan itu bukan kesalahan pembagian.** 72,5 hari dibagi dua orang menghasilkan 36,25 masing-masing terhadap 34 yang tersedia. Tidak ada susunan tugas yang menurunkan angka ini di bawah 100% — yang bisa hanya menambah waktu, menambah orang, atau mengurangi fitur.

---

## 2. Tiga tuas

Hanya ada tiga cara memasukkan 110 hari pekerjaan ke dalam 68 hari kapasitas.

### Tuas 1 — Tipiskan kedalaman · hemat 21 hari · **dipakai**

Enam fitur turun ke v0.1. Fiturnya ada dan bisa dipakai; cakupannya dipersempit. Rinciannya di §3.

**Harga yang dibayar:** beta terasa seperti demo di beberapa tempat. Bulan pertama pasca-rilis habis untuk mendalamkan, bukan menambah.

### Tuas 2 — Beli, jangan bangun · hemat 16,5 hari · **dipakai**

| Komponen | Diganti dengan | Hemat |
|---|---|---:|
| Implementasi auth sendiri | Better-Auth | 1,5 |
| Halaman checkout sendiri | Midtrans Snap (hosted) | 1,5 |
| Panel Superadmin React | Retool di atas view SQL | 2 |
| UI kit dari nol | Shadcn blocks apa adanya | 1 |
| Layanan email sendiri | Resend | 0,5 |
| Wireframe terpisah | Page stub langsung di kode | 1 |
| Penipisan kedalaman lain-lain | (lihat §3) | 9 |

**Harga yang dibayar:** lima ketergantungan vendor, kustomisasi terbatas, biaya langganan bulanan.

### Tuas 3 — Potong pengerasan · hemat 6 hari · **DITOLAK**

Membuang load test, audit keamanan, observability, E2E, dan cadangan bug akan langsung menyelesaikan kelebihan beban. **Tuas ini tetap tidak ditarik.**

Produk ini menahan saldo koin yang dibeli dengan rupiah, memanggil vendor berbayar per dokumen, dan mencetak tagihan LLM per pemakaian. Tanpa alert biaya, satu bug loop bisa menghabiskan anggaran sebulan dalam semalam. Tanpa rekonsiliasi dan audit, selisih saldo baru ketahuan dari komplain pengguna. Enam hari itu bukan poles akhir — itu satu-satunya hal yang membedakan rilis dari eksperimen.

---

## 3. Kedalaman tiap fitur

"Semua fitur masuk" hanya berarti sesuatu kalau jelas versi mana yang masuk.

| Epik | Fitur | Penuh | v0.1 | Yang tetap ada | Yang hilang sampai pasca-rilis |
|---|---|---:|---:|---|---|
| `E0` | Fondasi & setup | 12,5 | 10 | Monorepo, CI, migrasi, staging, design token, contracts | Wireframe terpisah — jadi page stub di kode |
| `E1` | Auth & RBAC | 4 | 2,5 | 3 peran, guard, matriks akses ter-test | Implementasi auth sendiri → Better-Auth |
| `E2` | Learning engine | 8,5 | 7,5 | Kartu pilihan ganda + swipe, penilaian server, transaksi attempt | Kartu tipe `order_steps` dan `reveal` |
| `E3` | Career Streak | 5,5 | 5 | Timezone-aware, freeze, peringatan, 4 status chip | Animasi perayaan milestone |
| `E4` | Coin & wallet | 4 | **4** | **Semuanya** — ledger append-only, hold/settle, rekonsiliasi | _tidak ditipiskan_ |
| `E5` | Squad & liga | 6,5 | 5,5 | Auto-assign, ZSET, rollup mingguan, promosi/degradasi | UI gabung/keluar squad manual |
| `E6` | Payment | 5 | 3,5 | Paket koin, webhook bertanda tangan, idempotensi | Halaman checkout sendiri → Snap hosted |
| `E7` | Klinik plagiarisme | 5,5 | 5 | **Hampir semuanya** — dedup SHA-256, hold/settle, reaper | Hanya polish UI riwayat |
| `E8` | ATS CV builder | 8 | 6,5 | Ekstraksi, penyusunan LLM, skor deterministik, ekspor PDF | Ekspor DOCX; aturan skor hanya yang inti |
| `E9` | Superadmin | 4 | 2 | Transaksi, audit log, ubah harga, biaya vendor harian | UI React sendiri → Retool |
| `E10` | Pengerasan & rilis | 6,5 | **6** | **Semuanya** — E2E, load test, audit, observability, cadangan | _tidak ditipiskan_ |
| `E11` | Peer review & mentor | 9 | 4 | Alokasi 2 reviewer lintas squad & anonim, form rubrik, konsol validasi mentor | **Bobot reputasi dinamis**, spot-check otomatis 10%, kalibrasi mingguan. Bobot tetap 1,0; mentor menyesuaikan manual lewat Retool. |
| `E12` | Mastery Track | 12 | 4 | Bank pertanyaan statis, jawaban teks, feedback LLM, review personal statement | **Simulasi wawancara adaptif multi-putaran**, rekaman audio, rubrik per program beasiswa, validasi mentor. Jadi satu putaran tanya-jawab. |
| `E13` | Prompt Lab | 5 | 1,5 | Form prompt terstruktur, jalankan, simpan, 3 template | Perbandingan antar-model, versioning prompt pengguna, berbagi |
| `E14` | Strive Store | 5 | 2 | Etalase, pembelian transaksional dari ledger, unduh aset | Kategori, stok, promo, preview. 8 item di-seed manual. |
| `E15` | Realtime | 5 | 2 | WS gateway + Redis pub/sub, **kanal squad saja**, fallback polling | Kanal `user:` dan `league:` — tetap polling 30 detik |
| `E16` | Notifikasi | 4 | 1,5 | Tabel notifikasi, email (Resend), lonceng in-app, banner streak | **Web Push browser** — terlalu banyak kasus tepi per-browser |
| | **Total** | **110** | **72,5** | 17 dari 17 epik hadir di beta | tidak ada yang ditunda seluruhnya |

---

## 4. Pembagian dua developer

Dibagi per **alur vertikal**, bukan per lapisan. Masing-masing memiliki fitur dari skema database sampai layar, sehingga tidak ada yang menunggu API orang lain selesai.

### Dev A — Core transaksional & integrasi · 37,25 hari

- Infra, CI, migrasi, deploy staging
- Integrasi auth + RolesGuard + matriks akses
- Coin ledger, hold/settle/release, rekonsiliasi
- Learning API + transaksi `POST /attempts`
- Streak engine + scheduler peringatan
- Squad, ZSET liga, outbox worker, WS gateway
- Payment checkout + webhook bertanda tangan
- Klinik: hold/settle, worker Copyleaks, reaper
- Alokasi peer review + poin berbobot
- Skema Mastery, dispatcher AI, view SQL admin
- Load test, audit keamanan, observability

**Profil:** Node/TypeScript, PostgreSQL, integrasi pihak ketiga. Nyaman berpikir dalam transaksi dan kegagalan parsial.

### Dev B — Antarmuka, AI service & fitur mandiri · 35,25 hari

- Design system, UI kit, `packages/contracts`
- Seluruh layar student & console
- Kartu belajar, Hub, dompet, leaderboard
- AI service FastAPI penuh (ekstraksi → LLM → skor → render)
- ATS CV, Prompt Lab, Mastery Track
- Store, notifikasi + email, rollup liga
- UI peer review + konsol mentor
- Dasbor Retool
- E2E test

**Profil:** React/Next.js dan CSS, cukup nyaman menulis Python untuk service AI yang berdiri sendiri.

### Batas milik bersama

| Milik bersama | Aturan |
|---|---|
| `db/migrations` | **Hanya Dev A.** Kebutuhan skema dari Dev B disampaikan sebagai isu, bukan migrasi tandingan — dua orang menulis migrasi paralel adalah konflik yang tidak terdeteksi sampai deploy. |
| `packages/contracts` | Dev B menulis skema zod, Dev A memakainya sebagai pipe validasi. **Perubahan breaking wajib PR terpisah** agar terlihat di review, tidak terselip dalam PR fitur. |
| `packages/ui` | **Hanya Dev B.** Dev A memakai komponen apa adanya; kalau kurang, minta — jangan bikin varian sendiri. |
| Transaksi `POST /attempts` | **Sepenuhnya Dev A.** Attempt, streak, koin, dan outbox ada di satu transaksi; memecah kepemilikan di dalamnya adalah cara tercepat menciptakan bug konsistensi. |
| Kontrak AI service | Dev B memiliki isinya, Dev A memiliki dispatcher-nya. Batasnya satu endpoint HTTP + tabel `ai_jobs`, disepakati di W3 sebelum keduanya menulis kode. |
| `coin_ledger` | Dev A menulis service-nya (`C-01`, W2). Store (Dev B, W6) dan scan (Dev A, W6) sama-sama memanggil service itu — **tidak ada yang menulis `coin_ledger` langsung.** |

---

## 5. Timeline mingguan

Setiap minggu punya satu tujuan dan satu gate yang bisa dijawab ya/tidak. Gate yang tidak lolos bukan alasan menambah jam kerja — itu sinyal untuk membuka §7.

### Minggu 1 — Fondasi, desain & keputusan
**Dev A 5,25 · Dev B 4,75**

Tidak ada fitur yang dikirim minggu ini, dan itu disengaja. Yang dikirim adalah **kemampuan mengirim**.

| Dev A | Dev B |
|---|---|
| `F-01` Monorepo, TS strict, lint, hook · 1 | `F-02` docker-compose dev · 0,5 |
| `F-03` CI: lint, typecheck, test, build · 1 | `F-06` Token → Tailwind + Shadcn + dark · 1 |
| `F-04` Migrasi 001 + codegen Kysely · 1,5 | `F-07` UI kit dari Shadcn blocks · 1 |
| `F-05` Deploy staging otomatis · 1,5 | `F-08` contracts: skema zod · 1 |
| `F-10` Kunci 8 keputusan produk · 0,25 | `F-09` Wireframe sebagai page stub · 0,5 |
| | `F-11` Pipeline seed konten · 0,5 |
| | `F-10` Kunci 8 keputusan produk · 0,25 |

**Gate:** staging hidup dan menerima deploy dari `main`; 31 tabel berdiri; halaman `/_specimen` tampil di dua tema; 12 rute bisa dinavigasi; **8 keputusan produk tertulis dan ditandatangani di PRD §5**.

### Minggu 2 — Auth, ledger & rangka aplikasi
**Dev A 5,0 · Dev B 4,0**

Dua fondasi yang dipakai hampir semua fitur lain: siapa penggunanya, dan bagaimana koin berpindah.

| Dev A | Dev B |
|---|---|
| `A-01` Integrasi Better-Auth · 0,5 | `A-03` Layar auth + sesi · 0,5 |
| `A-02` Guard + matriks akses ter-test · 1 | `A-04` Middleware rute student/console · 0,5 |
| `C-01` CoinLedgerService + trigger · 2 | `L-02` GradingService server-side · 1 |
| `L-01` API baca konten + serializer · 1,5 | `L-04` UI kartu: pilihan ganda + swipe · 2 |

**Gate:** daftar → login → Hub kosong sesuai peran, di staging. Ledger lulus test dua request paralel tanpa menggandakan koin. Student yang membuka `/console` mendapat 403.

### Minggu 3 — Transaksi inti & Hub
**Dev A 5,0 · Dev B 4,5**

Minggu terberat Dev A. Transaksi penyelesaian micro-task adalah jantung sistem — kalau ini benar, sisanya menempel padanya.

| Dev A | Dev B |
|---|---|
| `C-02` API wallet + ledger cursor · 0,5 | `AI-01` FastAPI skeleton + auth s2s · 1 |
| `L-03` POST /attempts satu transaksi · 2 | `C-03` UI dompet + riwayat · 1 |
| `S-01` StreakService timezone-aware · 1,5 | `L-05` Daftar track & progres · 1 |
| `S-02` GET /hub agregat · 1 | `S-03` UI Hub + streak chip 4 status · 1,5 |

**Gate:** satu lesson selesai end-to-end — kartu dijawab, dinilai server, koin masuk ledger, streak bertambah, event outbox tertulis. Exception di tengah transaksi meninggalkan nol baris di keempat tabel.

### Minggu 4 — Squad, liga & notifikasi
**Dev A 4,5 · Dev B 4,0**

Loop harian jadi utuh dan mulai terasa kompetitif.

| Dev A | Dev B |
|---|---|
| `C-04` Job rekonsiliasi + alert · 0,5 | `AI-02` Ekstraksi PDF/DOCX · 1 |
| `Q-01` Auto-assign squad · 0,5 | `N-01` notifications + API + email · 1 |
| `Q-02` LeaderboardService ZSET + rebuild · 1,5 | `P-01` pricing_config berversi · 0,5 |
| `Q-03` Outbox worker + retry + DLQ · 1 | `Q-05` UI squad + leaderboard · 1,5 |
| `S-04` Scheduler peringatan streak · 1 | |

**Gate:** poin masuk ZSET lewat outbox; Redis di-`FLUSHALL` lalu papan pulih otomatis dengan angka identik; streak benar saat jam sistem dimajukan lintas tengah malam di tiga zona waktu.

### Minggu 5 — Realtime, uang masuk & alokasi review ⚑ CHECKPOINT
**Dev A 5,0 · Dev B 4,0**

Rupiah nyata bisa berubah jadi koin. Setengah waktu sudah lewat.

| Dev A | Dev B |
|---|---|
| `P-02` Checkout Snap (hosted) · 1 | `AI-03` LLM structuring + prompt berversi · 1,5 |
| `P-03` Webhook + signature + idempotensi · 1,5 | `N-02` UI lonceng + banner streak · 0,5 |
| `PR-01` Alokasi 2 reviewer lintas squad · 1 | `P-04` UI top-up (redirect Snap) · 0,5 |
| `RT-01` WS gateway + Redis pub/sub · 1,5 | `Q-04` Rollup mingguan + promosi · 1 |
| | `RT-02` Client hook + fallback polling · 0,5 |

**CHECKPOINT.** Bandingkan realisasi W2–W5 dengan 36 dev-hari yang direncanakan. **Di bawah 31 → jalankan urutan pemotongan §7 sekarang**, bukan di minggu 7 saat sudah tidak ada pilihan.

**Gate teknis:** top-up sandbox menambah koin tepat sekali meski webhook dikirim tiga kali. Webhook dengan signature salah → 401 dan tercatat di `audit_log`.

### Minggu 6 — Klinik, store & pipeline AI
**Dev A 4,0 · Dev B 4,0**

Fitur berbayar kedua berdiri, dan AI service mulai menghasilkan sesuatu.

| Dev A | Dev B |
|---|---|
| `K-01` Upload + SHA-256 + storage · 1 | `AI-04` Skor ATS deterministik · 0,5 |
| `K-02` ScanService hold/settle + reaper · 1,5 | `AI-05` Render PDF ramah parser · 0,5 |
| `MT-01` Skema mastery_sessions + API · 0,5 | `PL-01` Form prompt terstruktur · 1 |
| `PR-02` API submit review + poin berbobot · 1 | `ST-01` store_items + purchase · 1 |
| | `ST-02` UI etalase + unduh aset · 1 |

**Gate:** worker scan dimatikan paksa di tengah jalan → koin kembali otomatis dalam ≤30 menit lewat reaper. Satu CV terstruktur keluar dari LLM dengan skor ATS yang stabil untuk input yang sama.

### Minggu 7 — Selesaikan fitur berbayar & peer review
**Dev A 3,5 · Dev B 4,5**

Fitur terakhir selain Mastery Track. Setelah minggu ini, feature freeze.

| Dev A | Dev B |
|---|---|
| `AI-06` ai_jobs + dispatcher + biaya · 1 | `AI-07` UI CV builder + temuan + unduh · 1 |
| `K-03` Worker Copyleaks + webhook · 1,5 | `K-04` UI klinik: unggah, antrean, laporan · 1 |
| `SA-01` View SQL + Retool read-only · 0,5 | `PL-02` 3 template + riwayat run · 0,5 |
| `SA-02` PATCH pricing berversi · 0,5 | `PR-03` UI antrean review + rubrik · 1 |
| | `PR-04` Konsol mentor: approve/tolak · 1 |

**Gate:** scan berbayar tuntas end-to-end di sandbox vendor; satu CV ter-generate sampai PDF terunduh; mentor bisa memvalidasi satu peer review. **Feature freeze mulai akhir minggu ini — kecuali Mastery Track.**

### Minggu 8 — Mastery Track + pengerasan ⚠ KELEBIHAN BEBAN
**Dev A 5,0 · Dev B 5,5**

Fitur terakhir dan pengerasan berjalan bersamaan. **Ini harga Konfigurasi A.**

| Dev A | Dev B |
|---|---|
| `R-02` Load test hub & leaderboard · 1 | `MT-02` Wawancara terpandu + feedback LLM · 1,5 |
| `R-03` Audit keamanan checklist · 1 | `MT-03` Review personal statement · 1 |
| `R-04` Observability + alert biaya · 1 | `MT-04` UI kedua modul Mastery · 1 |
| `SA-03` Health + biaya vendor harian · 0,5 | `R-01` E2E Playwright alur inti · 1 |
| `SA-04` Dasbor Retool · 0,5 | `R-05` Cadangan bug · 1 |
| `R-05` Cadangan bug · 1 | |

**Gate rilis:**
- E2E hijau di CI
- p95 `GET /hub` < 250 ms @ 500 rps
- Checklist keamanan tuntas tanpa temuan kritis
- Rekonsiliasi koin nol selisih selama 3 hari berturut-turut
- Beta tertutup dibuka untuk 30–50 pengguna nyata
- **Mastery Track dirilis bertanda `preview`**

---

## 6. Jalur kritis

### Rantai utama — tidak ada yang punya kelonggaran

```
F-04 (W1)  →  A-01 (W2)  →  C-01 (W2)  →  L-03 (W3)  →  Q-03 (W4)  →  Q-05 (W4)
migrasi       auth          ledger        attempt tx     outbox        leaderboard
                                             ↑
                                          S-01 (W3)
                                          streak
```

Panjangnya 4 minggu. Satu item mundur, rilis mundur.

### Rantai paralel — dibuka oleh ledger

```
C-01 (W2) ─┬─→ P-03 (W5)  webhook pembayaran
           └─→ K-02 (W6)  hold scan
```

### Rantai konten — TIDAK dikerjakan siapa pun di rencana ini

```
Penulisan ±90 kartu (W1–W3)  →  L-04 UI kartu belajar (W2)  →  demo apa pun
        ↑
   BUKAN pekerjaan developer
```

> **Penyumbat yang paling sering menjatuhkan rencana seperti ini bukan kode.** Dua developer bisa menyelesaikan seluruh rantai teknis tepat waktu dan tetap tidak punya apa pun untuk didemokan, karena tidak ada isi di dalam kartu belajarnya. **Tetapkan pemilik konten di hari pertama**, atau kurangi target jadi satu track dengan 40 kartu dan terima itu sebagai batas beta.

---

## 7. Tiga konfigurasi

Kelebihan 4,5 hari itu kecil — setengah minggu. Ada tiga cara menutupnya, dan pilihannya bukan teknis melainkan bisnis.

| Konfigurasi | Kapasitas | Beban | Konsekuensi |
|---|---:|---:|---|
| **A · 8 minggu, 2 dev** _(yang diminta)_ | 68 | 72,5 | Semua fitur hadir. Minggu 8 mengerjakan Mastery Track sambil load test dan audit keamanan. **Mastery Track rilis tanpa diuji sungguhan**, dan cadangan bug 2 hari kemungkinan besar terpakai untuk menyelesaikan fitur, bukan memperbaiki bug. Kalau ada satu estimasi meleset, yang dikorbankan adalah pengerasan. |
| **B · 9 minggu, 2 dev** _(rekomendasi)_ | 76,5 | 72,5 | Semua fitur hadir pada kedalaman yang sama, tapi minggu 9 murni pengerasan dengan cadangan 4 hari. **Satu minggu tambahan membeli seluruh selisihnya.** Pilihan termurah dari ketiganya, dan satu-satunya yang tidak mengorbankan apa pun. |
| **C · 8 minggu, 3 dev dari W3** | 93 | 72,5 | Muat dengan lapang, dan beberapa fitur bisa naik dari v0.1 ke kedalaman penuh — `E11` peer review dan `E12` Mastery Track kandidat pertama. Tapi onboarding developer ketiga memakan ~3 hari dari dua orang yang sudah 110% terisi, dan menambah jalur koordinasi. **Menambah orang di tengah proyek pendek jarang secepat yang diharapkan.** |

### Kalau Konfigurasi A tetap dipilih

Tetapkan **sekarang** bahwa Mastery Track boleh rilis di belakang seluruh beta: fitur hadir di produk tapi ditandai `preview`, dengan target pengerasan di dua minggu pertama pasca-rilis. Itu mengubah konsekuensinya dari kejutan hari terakhir menjadi keputusan yang diambil sadar.

### Urutan pemotongan kalau estimasi meleset

Disepakati sekarang, saat semua orang tenang — bukan di minggu 7 saat semua orang lelah.

| # | Yang dipotong | Hemat | Batas putusan |
|---|---|---:|---|
| 1 | **Prompt Lab ditunda seluruhnya** (`E13`) — paling lemah kaitannya dengan retensi maupun pendapatan | 1,5 | Akhir W5 |
| 2 | **Strive Store ditunda** (`E14`) — toko dengan 8 item bisa menunggu sampai ada yang layak ditukar | 2 | Akhir W5 |
| 3 | **Realtime WS dibuang, polling saja** (`E15`) — pengalaman hampir sama, satu subsistem hilang | 2 | Akhir W4 |
| 4 | **Mastery Track tinggal review personal statement** — buang `MT-02` | 2,5 | Akhir W6 |
| 5 | **Peer review ditunda** (`E11`) — skor liga murni dari penyelesaian lesson | 4 | Akhir W5 |

**Yang tidak boleh dipotong, apa pun keadaannya:** `C-01`, `C-04`, `L-03`, `P-03`, `K-02`, dan seluruh `E10`. Lihat `BACKLOG.md` bagian akhir.

---

## 8. Risiko jadwal

| Risiko | Kemungkinan | Deteksi dini | Respons |
|---|---|---|---|
| **Konten kartu tidak siap** | Tinggi | Akhir W2: berapa kartu yang sudah jadi? | Turunkan target ke 40 kartu, batasi beta ke satu track |
| **W3 meleset (minggu terberat)** | Tinggi | Gate W3: satu lesson end-to-end? | `S-01` geser ke W4, atau Dev B mengambil `L-02` yang paling mudah dipisah dari transaksi utama |
| **Verifikasi merchant payment lambat** | Tinggi | W1: akun sandbox sudah aktif? | Pakai sandbox sampai rilis; go-live payment jadi item pasca-beta |
| **Satu developer sakit/cuti seminggu** | Tinggi | — | Kehilangan 5 dev-hari → potongan #1, #2, dan #3 langsung dieksekusi. Rencana ini tidak punya cadangan untuk itu. |
| **Estimasi meleset 20% merata** | Tinggi | Hitungan mingguan sejak W2 | 87 dev-hari vs 68 → seluruh daftar potongan (12 hari) **masih belum cukup**. Perlu pindah ke Konfigurasi B atau C. |
| **Biaya LLM/scan meledak saat beta** | Sedang | Alert biaya harian (`R-04`) | Kuota harian per pengguna sudah ada di desain; turunkan angkanya |
| **Halusinasi LLM pada review statement** | Sedang | 5 dokumen kontrol di `AI-03` | Output AI selalu ditandai saran, bukan penilaian. Mentor tetap lapisan akhir. |

> **Baris "estimasi meleset 20%" layak dibaca dua kali.** Estimasi hampir selalu meleset sebesar itu. Kalau terjadi, seluruh daftar pemotongan yang tersedia masih belum cukup mengembalikan jadwal. Artinya **8 minggu untuk 2 orang realistis hanya kalau scope sudah dipotong sejak sekarang** — bukan kalau dipotong nanti saat terdesak.

---

## 9. Cara kerja

### Ritual

| Kapan | Apa | Berapa lama | Kenapa ada |
|---|---|---|---|
| Tiap hari | Sinkron singkat | 10 menit | Dengan dua orang ini cukup. Yang penting: apa yang memblokir, bukan apa yang dikerjakan. |
| Tiap PR | Review oleh satu-satunya rekan | < 4 jam tunggu | PR yang menunggu sehari menghentikan setengah tim. |
| Akhir minggu | Cek gate + hitung dev-hari selesai | 45 menit | Angka realisasi vs rencana adalah satu-satunya peringatan dini yang dimiliki rencana 107%. |
| Akhir W5 | **Checkpoint scope** | 2 jam | Keputusan potong/lanjut, mengacu ke §7. Sekali saja, di titik yang sudah ditentukan. |
| Akhir W7 | Feature freeze — _kecuali Mastery Track_ | — | Pengecualian ini adalah harga Konfigurasi A, dan harus disebut terang-terangan agar tidak jadi kejutan. |

### Satu aturan yang layak dipegang

Dua developer tidak boleh mengerjakan file yang sama di minggu yang sama. Pembagian di §4 dirancang untuk itu; kalau ternyata sering bertabrakan, itu tanda pembagiannya yang salah, bukan tanda perlu koordinasi lebih banyak.

---

## 10. Harus siap sebelum hari pertama

Rencana 107% terisi tidak punya ruang untuk menunggu. Setiap baris di bawah ini memblokir pekerjaan developer dan **tidak satu pun dikerjakan developer**.

| Kebutuhan | Memblokir | Kenapa mendesak |
|---|---|---|
| **Pemilik konten** | `L-04` · gate W3 | ±90 kartu untuk satu track. Kalau dua developer ini yang menulis, hilang 5–8 hari dari 72,5 yang ada — dan rencananya sudah kelebihan 4,5. |
| ~~**Jawaban 8 keputusan produk**~~ **SELESAI** | `F-10` · seluruh W2 | **Terkunci 14 Sep 2026 oleh Fatih Maulana** — `PRD.md` §5 berstatus TERKUNCI, kedelapan angka disetujui apa adanya. `F-04` tidak lagi terblokir dari sisi keputusan. |
| **Akun sandbox Midtrans/Xendit** | `P-02` · W5 | Verifikasi merchant bisa makan berhari-hari. |
| **Akun & kuota Copyleaks** | `K-03` · W7 | Harga ke pengguna sudah dikunci (2.400 koin, `PRD.md` §5 Q7). Yang masih terbuka adalah **harga kontrak aktual** — itu menentukan margin, bukan harga. Lihat §6.4. |
| **API key LLM + hard limit** | `AI-03` · W5 | Pasang batas biaya di dashboard vendor sejak awal, bukan setelah tagihan pertama. |
| **Lisensi Retool + Resend** | `SA-04` · W8, `N-01` · W4 | Dua dari komponen yang dibeli. Tanpa ini, 2,5 hari kembali jadi pekerjaan developer. |
| **Domain + akun cloud** | `F-05` · W1 | Deploy staging berhenti tanpa ini di hari kedua. |

---

## Lampiran — hubungan antar dokumen

```
PRD.md            sumber kebenaran PERILAKU    (apa yang harus terjadi)
BACKLOG.md        sumber kebenaran ESTIMASI    (berapa lama, siapa, kapan)
DELIVERY-PLAN.md  sumber kebenaran JADWAL      (urutan, gate, konfigurasi)  ← file ini
CLAUDE.md         sumber kebenaran KONVENSI    (bagaimana menulis kodenya)
MASTER-PROMPT.md  instruksi untuk Claude Code  (cara memakai keempatnya)
```

Kalau ada pertentangan: **PRD menang untuk perilaku**, **BACKLOG menang untuk angka**, **CLAUDE.md menang untuk konvensi kode**.
