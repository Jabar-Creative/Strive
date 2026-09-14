# Catatan agent — enam item berisiko

Enam item ini paling mudah salah, dan salahnya **tidak bisa diperbaiki tanpa migrasi data**. Tempelkan blok yang sesuai **di atas** prompt pembuka sesi di `AGENTS.md`.

Protokol sembilan langkah tetap berlaku penuh. Blok di bawah hanya menambah syarat, tidak menggantikan apa pun.

---

## `C-01` — CoinLedgerService · Dev A · W2

```
TAMBAHAN UNTUK C-01

Ini item paling penting di seluruh proyek. Salah di sini tidak bisa diperbaiki
tanpa migrasi data.

WAJIB ADA:
- write(trx, {...}) mengunci baris users dengan SELECT ... FOR UPDATE
- hold / settle / release dengan semantik persis PRD.md §7 E4 aturan CO-7 s/d CO-10
- settle TIDAK menulis entri ledger — hold sudah memotong saldo. Settle adalah
  perubahan status; jejaknya di audit_log. Idempotensi settle dicek di audit_log,
  BUKAN di coin_ledger.
- SEMUA method menerima `trx` — tidak ada method yang membuka transaksinya sendiri
- findDrift() untuk job rekonsiliasi

TEST WAJIB (database nyata, testcontainers) — tunjukkan kelimanya BERJALAN:
1. UPDATE coin_ledger ditolak trigger
2. Dua request paralel debit 80 dari saldo 100 → satu berhasil, satu ditolak,
   saldo akhir 20 (BUKAN -60)
3. release dipanggil dua kali → hanya satu entri, saldo kembali tepat sekali
4. idempotency_key sama dua kali → satu entri
5. Saldo tidak boleh negatif kecuali entry_type='adjust'
```

---

## `L-03` — POST /attempts · Dev A · W3

```
TAMBAHAN UNTUK L-03

Ini jantung sistem. Satu transaksi menulis ENAM hal — lihat CLAUDE.md bagian
"Transaksi penyelesaian micro-task".

WAJIB:
- attempt_date dihitung di Postgres: (now() AT TIME ZONE users.timezone)::date
- SEMUA penulisan dalam satu db.transaction()
- outbox_events ditulis DI DALAM transaksi
- queue.add() SETELAH commit, tidak pernah di dalam
- TIDAK ADA penulisan Redis di dalam transaksi
- Idempotency-Key wajib; request ulang mengembalikan respons pertama

TEST WAJIB:
1. Exception dilempar setelah insert coin_ledger → NOL baris tersisa di
   lesson_attempts, coin_ledger, outbox_events; streaks dan users.coin_balance
   tidak berubah
2. Lesson sama dikerjakan dua kali sehari → attempt kedua rewarded=false,
   tanpa entri koin baru, streak tidak bertambah
3. Idempotency-Key sama dua kali → satu attempt, satu entri koin
4. Skor yang dikirim client diabaikan sepenuhnya
```

---

## `S-01` — StreakService · Dev A · W3

```
TAMBAHAN UNTUK S-01

Bug di sini TIDAK MUNCUL di test yang berjalan di UTC. Baca PRD.md §7 E3
catatan pembuka.

WAJIB:
- "Hari ini" SELALU (now() AT TIME ZONE users.timezone)::date, dihitung di
  Postgres bukan Node
- gap=0 → already_active, gap=1 → extended, gap>1 → restarted (current=1, bukan 0)
- longest_streak tidak pernah turun
- Cache Redis ditulis outbox worker SETELAH commit, bukan di dalam transaksi

TEST WAJIB — tiga zona waktu:
1. Asia/Jakarta, aktif pukul 22.00 WIB → tercatat di tanggal HARI INI WIB,
   bukan besok meski UTC sudah berganti hari
2. Europe/London dan Asia/Jayapura, keduanya aktif pukul 23.00 lokal →
   keduanya dapat streak +1 di tanggal lokal masing-masing
3. Gap 3 hari → current=1, longest tetap nilai lama
4. Task kedua di hari yang sama → streak tidak bertambah
5. Freeze dipakai dua kali sehari → idempoten
```

---

## `P-03` — Webhook pembayaran · Dev A · W5

```
TAMBAHAN UNTUK P-03

Ini gerbang uang masuk. Baca PRD.md §12.1.

WAJIB:
- Verifikasi signature SHA512(order_id + status_code + gross_amount + server_key)
  SEBELUM memproses apa pun
- Signature salah → 401 + audit_log, TANPA perubahan saldo
- Idempoten pada order_id: order sudah 'paid' → 200 tanpa aksi
- Penambahan koin, update order, insert payments dalam SATU transaksi
- gross_amount berbeda dari order → tolak dan alarm
- Webhook untuk order tidak dikenal → 200 (agar gateway berhenti retry) + audit_log

TEST WAJIB:
1. Webhook sah yang sama dikirim 3× → koin bertambah TEPAT SEKALI,
   payments memuat 3 baris
2. Signature salah → 401, saldo tidak berubah, audit_log tercatat
3. gross_amount tidak cocok → ditolak
4. Memanggil halaman "pembayaran berhasil" tanpa webhook → saldo TIDAK bertambah
```

---

## `K-02` — ScanService hold/settle/release · Dev A · W6

```
TAMBAHAN UNTUK K-02

Baca PRD.md §7 E7 dan Lampiran B (state machine scan).

WAJIB:
- SHA-256 dihitung SEBELUM apa pun terjadi
- Dedup dicek SEBELUM hold dibuat (cache hit tidak pernah menahan tarif penuh)
- Hold dibuat sebelum job di-enqueue; enqueue setelah commit
- Reaper melepas hold menggantung > 30 menit
- Cache dedup diisi HANYA setelah hasil benar-benar tersimpan
- Antarmuka PlagiarismProvider, bukan panggilan Copyleaks langsung

TEST WAJIB:
1. Dokumen identik kedua → vendor TIDAK dipanggil, hanya 240 koin didebit
2. Worker dimatikan paksa, 31 menit berlalu, reaper jalan → koin kembali 2400
   penuh, scan status 'released'
3. Saldo kurang → ditolak sebelum baris scan dibuat
4. Webhook hasil diterima dua kali → hasil tersimpan sekali, settle sekali
```

---

## `Q-02` / `Q-03` — Leaderboard & outbox · Dev A · W4

```
TAMBAHAN UNTUK Q-02 / Q-03

WAJIB:
- Kunci ZSET dirotasi per musim (lb:sq:{season}:{squad_id}), BUKAN di-reset
- rebuildSquad() menghitung ulang dari lesson_attempts + peer_reviews
- Outbox worker memakai FOR UPDATE SKIP LOCKED
- Event gagal 5× → audit_log, antrean tidak macet
- SEMUA konsumen outbox harus IDEMPOTEN (pengantaran at-least-once)

TEST WAJIB:
1. Redis FLUSHALL → papan pulih otomatis dengan angka IDENTIK dengan sebelumnya
2. Dua instance worker paralel, 100 event → setiap event diproses tepat sekali
3. closeSeason dipanggil dua kali untuk musim sama → tidak ada squad yang
   berpindah tier dua langkah
```
