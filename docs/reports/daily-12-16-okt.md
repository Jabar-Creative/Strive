# Daily Report Strive Dev — Kemal (Senin 12 – Jumat 16 Okt 2026)

> Lima laporan di bawah disusun sesuai permintaan: pekerjaan satu minggu
> dikerjakan serentak pada sesi susulan 18 Okt, laporan tetap dipecah per
> hari kerja. Isi tiap laporan adalah pekerjaan yang BENAR-BENAR selesai dan
> terverifikasi — tanggal commit di repo tetap jujur (18 Okt).

---

## 📌 DAILY REPORT STRIVE DEV — KEMAL
### Senin, 12/10/2026

**1 · Pekerjaan selesai**

TASK DIKERJAKAN: N-02 (UI lonceng notifikasi + banner peringatan streak, 0,5
hari) → PR #229. Dua AC terbukti: "jumlah belum dibaca akurat" → field baru
`unread_count` dihitung SERVER (COUNT per pengguna, terpisah dari isi halaman
— pengguna yang sepekan tidak membuka aplikasi punya belum-dibaca lebih
banyak dari halaman pertama; 4 test integrasi DB nyata, termasuk "halaman
dipotong limit, angka tetap akurat"). NO-7 optimistik+pulih: mesin murni 13
unit test, pemulihan dibuktikan MERAH lewat sabotase lalu dipulihkan.
BUKTI BROWSER (Playwright + API nyata, 7 langkah lulus, 3 screenshot,
`docs/reports/N-02/`): daftar → semai 3 notifikasi → Hub menampilkan banner
streak + lencana "2" → klik item di panel → lencana 1 optimistik TANPA
reload → tutup banner → lencana hilang DAN server 0 belum dibaca → 375px
tanpa scroll horizontal → console bersih. **Verifikasi menemukan bug sendiri
sebelum reviewer:** lonceng dan banner mula-mula pegang state MASING-MASING
— menutup banner (PATCH sampai server) meninggalkan lencana "1" selamanya.
Diperbaiki dengan satu state bersama (`NotificationProvider`); keduanya
berubah dan pulih BERSAMA. Kontrak berubah aditif (Dev B pemilik
packages/contracts). Audit agent-security: nol Kritis/Tinggi/Sedang; satu
catatan Rendah utk Dev A (komentar `session.guard.ts:42` menyebut guard yang
tak pernah ada — dilaporkan, tak kusedik file-nya).

**2 · Progres**
Papan (saat merge nanti): 60/80 done. W5 Dev B tinggal P-04 (menunggu
kredensial vendor) — N-02 ini salah satunya.

**3 · Isu**
Dibuka: — (catatan komentar guard dilaporkan di PR #229)

**4 · Blocker**
Fatih: review PR #229. Staging: kredit Railway (lihat catatan lama).

**5 · Selasa**
RT-02 (hook realtime umum — mesin Q-05 tinggal digeneralisasi).

---

## 📌 DAILY REPORT STRIVE DEV — KEMAL
### Selasa, 13/10/2026

**1 · Pekerjaan selesai**

TASK DIKERJAKAN: RT-02 (hook useRealtime + fallback polling, 0,5 hari) →
PR #232. AC "mematikan WS server tidak membuat layar kosong" terbukti dua
keadaan di browser + stack nyata: (A) WS hidup → papan 3 baris, chip
"Langsung"; (B) rute WS diblokir total level browser (WS "mati" dari sudut
klien; REST hidup — RT-02 item KLIEN) → papan TETAP 3 baris via polling,
chip jujur "per 30 dtk", NOL layar kosong. Penyegaran nyata tanpa reload:
poin diubah di Postgres + kunci ZSET dibuang → SATU tick polling menampilkan
nilai baru lewat rebuildSquad milik aplikasi (aturan keras 7, bukan tulis
Redis manual). Penjaga refetch in-flight+SATU-trailing diangkat dari closure
tak teruji squad-screen jadi `lib/refetch-guard` (5 unit test; pengerasan
audit: lemparan SINKRON tidak membekukan penjaga — dimerahkan dulu).

AI-05 (render PDF satu kolom, 0,5 hari) → PR #230: delegasi penuh ke agent
Python, hasilnya KUVERIFIKASI SENDIRI: pytest 111→97 lama +10 baru
dijalankan ulang olehku di branch, sabotase seksi-x320 dimerahkan 2 test
lalu dipulihkan. SATU KOLOM tiga lapis bukti (posisi-x, celah antar-kata,
detektor dua kolom extract.py = False), round-trip render→ekstrak semua
field kembali, skor §13.3 100→100 nol penalti baru, determinisme byte
`invariant=1`. Audit (PDF hostil sungguhan): nol temuan; reportlab 4.4.10
bersih CVE.

**TEMUAN BUG PRA-ADA (bukan milikku, tidak kuperbaiki):** layar squad CRASH
total ("Application error") di jalur API NYATA — `to_char(...,'OF')` Q-06
menghasilkan offset tanpa menit ("+00") → `new Date()` Invalid → Intl
melempar. Verifikasi Q-05 dulu pakai stub jadi tak pernah ketahuan.
Mitigasi web kupasang ("—" + tak crash); akarnya **isu #231** untuk Fatih.

**2 · Progres**
Papan 61/80 (N-02+RT-02 setelah merge). Audit lokal lima langkah hijau.

**3 · Isu**
Dibuka: **#231** (ends_at offset tanpa menit — layar squad crash; bukti
satu-baris `node -e` ada di isu).

**4 · Blocker**
Fatih: review #229 #230 #232; putuskan perbaikan #231 (modul squad milikmu).

**5 · Rabu**
ST-02 (etalase store + unduh signed URL).

---

## 📌 DAILY REPORT STRIVE DEV — KEMAL
### Rabu, 14/10/2026

**1 · Pekerjaan selesai**

TASK DIKERJAKAN: ST-02 (UI etalase + unduh aset, 1 hari) → PR #236. Rute BARU
`GET /store/purchases/:id/download` (sebelumnya hanya janji §10.3): kepemilikan
di WHERE (pola F-14), NOT_FOUND seragam, SR-6 item nonaktif tetap terunduh,
`expires_at` dari KONSTANTA yang sama dengan penandatangan (satu angka, bukan
dua). Etalase kini membawa `owned` + `purchase_id` (aditif; §10.3 tak punya
rute daftar pembelian — unduhan menunjuk BARIS pembelian, etalase satu-satunya
pembawa id-nya). `asset_key` tetap tak pernah keluar service.

BUKTI END-TO-END MinIO SUNGGUHAN (`docs/reports/ST-02/`, 7 langkah lulus):
8 item nyata → beli 300 koin → tombol jadi Unduh, saldo 1.700 KATA SERVER →
klik Unduh → signed URL `X-Amz-Expires=900` → URL ITU BENAR-BENAR mengunduh
dari MinIO (200 + isi aset persis) → tebak URL objek tanpa tanda tangan →
**403**. SR-5 dua arah, bukan cuma bentuk URL. Integrasi store 18/18 (5
baru), web 85/85 (7 baru).

Audit agent-security: nol Kritis/Tinggi/Sedang, 4 Low — TIGA kupasang
susulan (purchaseId non-UUID kini NOT_FOUND seragam bukan 500 — kelas jebakan
uuid-vs-bind CLAUDE.md, +2 test; rantai opener jendela unduh diputus anti
tabnabbing; komentar controller basi dibuang). SATU jadi isu utk pemilik
filenya: `bucketAssets()` default-dev saat env kosong di produksi (**#237**).

**2 · Progres**
Papan 62/80 (N-02+RT-02+AI-05+ST-02 setelah merge).

**3 · Isu**
Dibuka: **#237** (bucket default menunjuk dev di produksi — storage milik Dev A).

**4 · Blocker**
Fatih: review #229 #230 #232 #236.

**5 · Kamis**
P-04 (UI top-up).

---

## 📌 DAILY REPORT STRIVE DEV — KEMAL
### Kamis, 15/10/2026

**1 · Pekerjaan selesai**

TASK DIKERJAKAN: P-04 (UI top-up: pilih paket, bayar, status, kembali ke
dompet, 0,5 hari) → **PR #235 (bertumpuk di #234)**. Seksi "Isi koin" di
dompet: 3 paket NYATA dari GET /pricing, checkout ⚡ (kunci idempoten MILIK
PERCOBAAN, PA-3), polling status order tiap 5 dtk dengan BATAS WAKTU 10
menit — AC "tidak menggantung selamanya" teruji unit (600→0 → fase tenggang
STABIL; sabotase leder dimerahkan) DAN browser: order → paid di DB → kartu
"Top-up berhasil · 2.200 koin" muncul TANPA reload via polling API nyata
(`docs/reports/P-04/`).

**DUA TEMUAN BESAR (bukan kode-ku, dua-duanya menghentikan alur):**
1. **#233: `POST /payments/checkout` TIDAK PERNAH punya controller.** Service
   P-02 ter-merge & teruji, tapi rutenya tak pernah diekspos — komentar
   `checkout.service.ts:66` sendiri menuliskannya; ACCESS_MATRIX mendaftarkan
   rute hantu. P-04 kutandai `blocked` (bukan done) sampai rute + kredensial
   Midtrans ada; jalur 404 dibuktikan bersih, jalur menunggu→berhasil
   dibuktikan dengan intercept Playwright → order pending SUNGGUHAN.
2. **Kontrak ≠ nyata:** `pricingPackageSchema` {code,label} vs seed+API
   {id,name} — P-04 konsumen PERTAMA endpoint ini; mismatch tak terlihat
   setahun. Ditutup PR terpisah **#234** sesuai aturan breaking kontrak.

Dua bug verifikasi-browser juga ketemu dan diperbaiki (bukan dari baca
kode): `onKoinMasuk` dipanggil DI DALAM updater state (React menolak) +
`muat()` me-reset wallet ke fase yang melepas seksi top-up (remount
menghancurkan state polling). Audit: 0 K/T; 3 Low DIPASANG (validasi URL
Snap https+allowlist host Midtrans, window.open keluar dari updater —
StrictMode membuka dua tab, harga menunggu mengikuti ORDER bukan daftar).

**2 · Progres**
Papan: 62 done + P-04 blocked-menunggu-#233. 5 PR menunggu review.

**3 · Isu**
Dibuka: **#233** (controller checkout tidak pernah ada — beserta dua syarat
wajib saat membangunnya: filter user_id di GET orders, idempotensi
per-pengguna). PR: **#234** (kontrak {id,name}).

**4 · Blocker**
Fatih: review #234 → #235 (bertumpuk), keputusan #233, PUTUSKAN RAILWAY
(kredit ±15–20 Okt), kredensial Midtrans (membuka P-02+P-04 end-to-end).

**5 · Jumat**
PL-01 (prompt lab) + wireframe seluruh halaman.

---

## 📌 DAILY REPORT STRIVE DEV — KEMAL
### Jumat, 16/10/2026

**1 · Pekerjaan selesai**

TASK DIKERJAKAN: PL-01 (form prompt terstruktur + jalankan + simpan) —
**SEPARUH, jujur begitu**: sisi layanan AI SELESAI → **PR #239**
(implementasi POST /v1/prompt menggantikan 503; prompt berversi
`prompt-lab/2026-10-18`; larangan halusinasi §13.4.3 VERBATIM dikunci test;
5 bagian wajib; batas 800 token / temp 0,3 / timeout 25 dtk DI BAWAH potongan
30 dtk Node; `MAKS_KARAKTER_BAGIAN` 10.000 menolak context 9MB SEBELUM
menyentuh LLM; TANPA cache — kuota & koin dihitung per run; balasan FLAT
menyesuaikan `bacaHasil` Node). Pytest **111/111 dijalankan ulang olehku di
commit** (bukan klaim agent). Bonus layak: `errors.py` mensanitasi ctx
validasi — 422 sah tidak lagi jadi 500 (lubang laten SEMUA rute).

**Sisi NODE DITUNDA dengan alasan, bukan ditinggal:** rute ⚡-nya butuh SATU
keputusan domain coin_leder (Dev A): `RefType` tak punya `'prompt_run'` dan
`prompt_runs` tak punya kolom idempotensi — tanpa salah satunya, retry kunci
sama bisa menulis BARIS RUN KEDUA di jalur uang. Kubuka **isu #238** dengan
dua usulan; desain Node sudah siap (quota PL-4 zona waktu pengguna, timeout
30 dtk tanpa potongan koin, debit spend_ai setelah sukses).

BONUS (bukan backlog, diminta langsung): **wireframe seluruh 15 halaman** →
PR #240. Dua keluaran: `PROMPTS-STITCH.md` (15 prompt siap-tempel ke Stitch —
Stitch butuh login Google, agent tak bisa memegangnya) + `index.html`
cadangan self-contained (grayscale, tanpa JS/CDN). Verifikasi render
Playwright: 15/15 section, TOC jalan, console bersih — screenshot terlampir.

**2 · Progres**
Papan: 62 done (setelah 5 PR di-merge: 63) · 5 blocked · PL-01 in_progress.
Minggu 6 Dev B: AI-04 ✓ (sebelumnya), AI-05 ✓, ST-02 ✓, P-04 blocked-#233,
PL-01 setengah-blocked-#238. W5 bersih: N-02 ✓, RT-02 ✓.

**3 · Isu**
Dibuka pekan ini: #231 (Q-06 tanggal), #233 (controller checkout), #237
(bucket default), #238 (RefType PL-01). PR: #229 #230 #232 #234 #235 #236
#239 #240.

**4 · Blocker**
Fatih: review DELAPAN PR (urut: #229 → #232 → #230 → #236 mandiri; #234 →
#235 bertumpuk; #239; #240 ringan). Keputusan: #233 (rute checkout + dua
syaratnya), #238 (RefType/idempotensi PL-01), #231, #237. Luar repo:
kredensial Midtrans, Railway.

**5 · Senin**
PL-01 sisi Node begitu #238 diputuskan (desain siap); respons review
delapan PR diutamakan begitu turun.

*Catatan verifikasi: seluruh klaim browser di lima laporan ini berasal dari
run Playwright sungguhan dengan screenshot di docs/reports/<ITEM>/; seluruh
angka test dijalankan ulang setelah perubahan terakhir. Lingkungan verifikasi
lokal penuh: PostgreSQL/Redis/MinIO Docker + stack e2e terisolasi (DB
strive_e2e, API :3002, web :3005).*
