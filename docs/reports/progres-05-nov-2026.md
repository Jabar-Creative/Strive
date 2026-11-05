# Progres Strive Academy — 5 November 2026

> Potret keadaan pada hari kerja **ke-39 dari 40** rencana delapan minggu
> (`docs/DELIVERY-PLAN.md`: W1 mulai 14 Sep, W8 berakhir 6 Nov). Seluruh angka
> di bawah **dihitung dari baris papan** `docs/BACKLOG.md`, bukan ditulis
> tangan — lihat skrip di `AGENTS.md` §8.

---

## 1 · Angka

| | |
|---|---|
| **Item selesai** | **68 / 80** |
| **Dev-hari selesai** | **65,0 / 78,5 → 82,8%** |
| Sisa | 13,5 dev-hari (7 `todo` = 8,5 · 5 `blocked` = 5,0) |
| Kalender terpakai | hari kerja **39 / 40 → 97,5%** |
| Migrasi | 10 |
| Isu terbuka | 21 |
| PR terbuka | 0 |
| CI `main` | hijau (`bb2b569`) |

### Kalender sudah mendahului pekerjaan

Dua angka itu yang paling penting di laporan ini: **97,5% kalender terpakai,
82,8% pekerjaan selesai.** Rencana delapan minggu **tidak akan tutup besok.**

Kapasitas yang tersisa di dalam rencana adalah satu hari kerja × dua dev ≈ **1,7
dev-hari efektif**, terhadap **13,5 dev-hari** sisa. Selisihnya ~11,8 dev-hari.

Ini bukan kejutan yang baru; `DELIVERY-PLAN.md` §7 sudah menuliskannya pada hari
pertama — kapasitas 68 dev-hari terhadap lingkup 78,5, **115% terisi**, dengan
rekomendasi eksplisit **opsi B: sembilan minggu**. Yang terjadi hari ini adalah
konsekuensi yang sudah dihitung, bukan yang terlewat.

### Kecepatan per bulan

| Bulan | Dev-hari selesai | Kumulatif |
|---|---:|---:|
| September | +52,5 | 52,5 |
| Oktober | +12,5 | 65,0 |
| November | +0 | 65,0 |

September menyelesaikan **80%** dari seluruh pekerjaan yang sudah jadi.
Oktober seperlimanya. **Commit terakhir 28 Oktober — tujuh hari tanpa commit
sama sekali** sampai laporan ini ditulis.

---

## 2 · Sembilan dari tujuh belas epik TUNTAS

| Epik | Cakupan | Item | Dev-hari | % |
|---|---|---:|---:|---:|
| `C` | Koin & dompet | 4/4 | 4,0/4,0 | **100%** |
| `L` | Learning engine | 5/5 | 7,5/7,5 | **100%** |
| `N` | Notifikasi | 2/2 | 1,5/1,5 | **100%** |
| `PL` | Prompt Lab | 2/2 | 1,5/1,5 | **100%** |
| `PR` | Peer review & mentor | 4/4 | 4,0/4,0 | **100%** |
| `Q` | Squad & liga | 6/6 | 6,0/6,0 | **100%** |
| `RT` | Realtime | 2/2 | 2,0/2,0 | **100%** |
| `S` | Streak & Hub | 5/5 | 5,5/5,5 | **100%** |
| `ST` | Store | 2/2 | 2,0/2,0 | **100%** |
| `A` | Auth & profil | 4/5 | 4,0/4,5 | 89% |
| `F` | Fondasi & perkakas | 13/14 | 11,0/12,5 | 88% |
| `AI` | Layanan AI & ATS CV | 6/7 | 5,5/6,5 | 85% |
| `SA` | Panel superadmin | 4/5 | 2,0/2,5 | 80% |
| `P` | Pembayaran | 3/4 | 2,5/3,5 | 71% |
| `K` | Klinik plagiarisme | 2/4 | 2,5/5,0 | 50% |
| `R` | Rilis & pengerasan | 3/5 | 3,0/6,0 | 50% |
| `MT` | **Mastery Track** | **1/4** | **0,5/4,0** | **12%** |

**Seluruh mesin retensi tuntas** — streak, learning engine, squad, liga,
realtime, notifikasi, koin, store, peer review. Yang tertinggal ada di sisi
monetisasi dan pengerasan.

Dan `MT` di 12% persis seperti yang diramalkan `DELIVERY-PLAN.md` §7 untuk opsi
A: *"minggu 8 mengerjakan Mastery Track bersamaan dengan pengerasan … Mastery
Track rilis tanpa diuji sungguhan"*. Ramalan itu tepat, termasuk item mana yang
jadi korbannya.

---

## 3 · Sisa kartu — dua belas, dan hanya tujuh yang bisa ditulis sebagai kode

### 3.1 `todo` — 7 kartu, 8,5 dev-hari

| Kartu | Dev | Hari | W | Menunggu |
|---|---|---:|---|---|
| `MT-02` Wawancara terpandu: bank soal + jawaban | B | 1,5 | W8 | — **siap** |
| `MT-03` Review personal statement (LLM terstruktur) | B | 1,0 | W8 | — **siap** |
| `MT-04` UI kedua modul Mastery | B | 1,0 | W8 | `MT-02`, `MT-03` |
| `AI-07` UI CV builder | B | 1,0 | W7 | — **siap**; baca #197 & #207 lebih dulu |
| `K-04` UI klinik | B | 1,0 | W7 | — **siap**; jalur scan NYATA tetap butuh #90 |
| `R-01` E2E Playwright | B | 1,0 | W8 | `K-04` |
| `R-05` Cadangan perbaikan bug | AB | 2,0 | W8 | — penyangga, bukan fitur |

Empat dari tujuh **siap dikerjakan sekarang** tanpa menunggu apa pun.

### 3.2 `blocked` — 5 kartu, 5,0 dev-hari · **nol yang bisa dibuka dengan menulis kode**

| Kartu | Dev | Hari | Yang menahan | Sejak |
|---|---|---:|---|---|
| `P-02` POST /payments/checkout | A | 1,0 | kredensial **Midtrans** (#57) | 17 Sep |
| `K-03` Worker Copyleaks + webhook | A | 1,5 | kredensial **Copyleaks** (#90) | 20 Sep |
| `SA-04` Dasbor Retool | A | 0,5 | langganan **Retool** (#77) | 20 Sep |
| `A-04` Middleware rute student/console | B | 0,5 | **dua domain** (#176) | 28 Sep |
| `F-05` Deploy staging otomatis | A | 1,5 | **V13 mustahil** — staging mati | 28 Okt |

Tiga vendor sudah menahan **enam sampai tujuh minggu**. Rutenya sendiri sudah
ada dan terverifikasi seluas permukaan yang bisa diverifikasi (`P-02` lewat
#243, `K-03` lewat #91); yang belum pernah terbukti adalah alur dengan uang dan
dokumen sungguhan.

`F-05` berpindah dari `review` ke `blocked` pada 28 Okt: dua belas dari tiga
belas V terbukti, dan **V13 (rollback terukur) menjadi mustahil** begitu
instance Railway-nya berhenti. Peringatannya tertulis tiga kali (13, 17, 20 Okt)
dengan kalimat yang sama; peringatan yang benar tapi tidak ditindaklanjuti tetap
berakhir dengan hal yang diperingatkannya.

### 3.3 Staging MATI sejak ~26 Oktober

`api` dan `ai` menjawab `404 Application not found` dari edge Railway — bukan
502 dari service yang sakit, melainkan service yang sudah tidak ada. Kredit
trial US$5 habis seperti yang dijadwalkan kalender sejak 25 Sep. Web di Vercel
tetap 200, **tanpa backend**.

Pemicu otomatis `deploy-staging.yml` sudah dimatikan (#264); `workflow_dispatch`
dipertahankan. Deploy sukses terakhir `a56cb96` (20 Okt), tag `staging-live`
masih di situ.

**Catatan untuk staging berikutnya:** dua belas V yang terbukti **tidak otomatis
berlaku** untuk instance baru di penyedia lain — kebanyakan baris itu
membuktikan perilaku infrastrukturnya, bukan perilaku kodenya. V1–V12 perlu
dijalankan ulang.

---

## 4 · Apa yang menutup sisanya

| | Butuh | Menutup |
|---|---|---|
| **Satu minggu kerja lagi** | 8,5 dev-hari ÷ 2 dev ≈ 5 hari | **seluruh 7 kartu `todo`** |
| **Keputusan pengadaan** | Midtrans · Copyleaks · Retool | 3,0 dev-hari (`P-02`, `K-03`, `SA-04`) |
| **Keputusan hosting** | penyedia staging + metode bayar | 1,5 dev-hari (`F-05` V13) |
| **Keputusan arsitektur** | satu domain, atau terima #176 | 0,5 dev-hari (`A-04`) |

Antrean Dev A **kosong**: keempat kartu A yang tersisa semuanya `blocked`, dan
tidak satu pun bisa dibuka dengan menulis kode. Jadi kapasitas Dev A tersedia
penuh untuk mengambil kartu Dev B — pola yang sudah dipakai dua kali (`Q-04` dan
`ST-01`, dipindah 22 Sep). Dengan begitu 8,5 dev-hari itu selesai dalam satu
minggu, bukan dua.

---

## 5 · Mutu, supaya kecepatan tidak dibaca sendirian

| | |
|---|---|
| Test | 310 unit + 545 integrasi (46 berkas), semuanya hijau di CI |
| Migrasi | 10, forward-only, checksum diperiksa |
| Rute yatim | **0** dari 59 yang dijanjikan PRD §10.3 |
| Audit dependensi | 11 tinggi/kritis, **11 punya pengecualian tertulis**, 0 baru, 0 pengecualian basi |
| Job CI wajib | `lint · typecheck · test · build` · `ai service · test` · `migrasi kering` |
| `image runtime` | lulus di setiap PR, **belum jadi required check** (#151) |

Tiga fitur **dipotong dengan sengaja** 14 Okt (#223), bukan hilang diam-diam:
presence squad (#119), bonus milestone + kredit freeze bulanan (#115), promosi/
degradasi squad (#111). Potongan yang dipilih lebih baik daripada potongan yang
terjadi sendiri.
