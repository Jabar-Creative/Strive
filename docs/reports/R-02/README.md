# `R-02` — Load test `/hub` · baseline

> **Angka terukur, bukan perkiraan.** Seluruh isi tabel di bawah berasal dari
> `baseline.json`, yang ditulis mesin oleh `scripts/load-test.mjs` — tidak ada angka di
> halaman ini yang diketik tangan.

## Hasil

Target `R-02`: **p95 < 250 ms @ 500 rps.**

| Beban | p50 | **p95** | p99 | maks | rps tercapai | gagal | Verdict |
|---:|---:|---:|---:|---:|---:|---:|---|
| **500 rps** | 3,3 ms | **6,0 ms** | 12,2 ms | 64 ms | 499,9 / 500 | 0 | **LULUS** |
| 1000 rps | 3,3 ms | 20,0 ms | 51,7 ms | — | 999,8 / 1000 | 0 | lulus |
| 1500 rps | 21,8 ms | **353,1 ms** | 368,9 ms | — | 1499,7 / 1500 | 0 | tidak lulus |
| 3000 rps | 7954,7 ms | 16804,1 ms | 17140,9 ms | — | **1616,6** / 3000 | 15389 | jenuh |

**Target terpenuhi dengan margin ~40×** pada p95 (6 ms vs 250 ms).

**Langit-langitnya antara 1000 dan 1500 rps.** Di 3000 rps server hanya sanggup melayani
~1617 rps dan 15.389 permintaan gagal — itu bukan "lambat", itu tumbang.

Jadi headroom terhadap target: **2–3×**, bukan tak terbatas. Angka itu yang berguna, bukan
kata "lulus".

## Kenapa satu titik yang lulus bukan baseline

Kalau halaman ini hanya memuat baris 500 rps, ia menjawab *"apakah kita memenuhi target?"*
dan tidak menjawab *"berapa jauh kita dari batasnya?"*. Pertanyaan kedua yang menentukan
apakah lonjakan trafik jadi insiden — dan pertanyaan kedua juga yang bisa dibandingkan
bulan depan.

## Keputusan metodologi yang menentukan angkanya

**Beban dikirim open-loop.** Permintaan berangkat pada jadwal tetap, tidak menunggu respons
sebelumnya.

Yang lazim ditulis orang adalah closed-loop: N pekerja, tiap pekerja menunggu responsnya
sebelum mengirim lagi. Itu mengukur hal yang berbeda, dan **kesalahannya searah**: saat
server melambat, closed-loop otomatis mengurangi laju kirimnya. Beban berkurang tepat ketika
server sedang kesulitan, dan p95 yang dilaporkan terlihat bagus **karena permintaan yang akan
lambat tidak pernah dikirim**. Namanya *coordinated omission*.

Baris 3000 rps di atas adalah buktinya bekerja: closed-loop akan melaporkan angka yang jauh
lebih ramah untuk keadaan yang sebenarnya sudah tumbang.

Tiga keputusan lebih kecil, masing-masing searah:

- **Badan respons ikut dibaca** (`res.arrayBuffer()`). Tanpa itu yang terukur hanya waktu
  sampai header, dan `/hub` mengembalikan lima bagian.
- **Permintaan gagal tetap dicatat latensinya.** Membuangnya akan membuat p95 *membaik*
  justru saat server mulai menolak koneksi.
- **Persentil dari seluruh sampel**, bukan aproksimasi bucket.

## Yang TIDAK diukur, dan kenapa

**Leaderboard.** Judul `R-02` menyebut *"/hub & leaderboard"*, tapi
`GET /squads/:id/leaderboard` **tidak ada** — tidak ada item yang membangunnya. `Q-02`
membuat `LeaderboardService` dan AC-nya terpenuhi seluruhnya; ia memang tidak pernah
menjanjikan endpoint. Dicatat di **isu #79**, yang juga menahan `Q-05` milik Dev B.

Begitu endpointnya ada, mengukurnya satu baris: tambahkan jalurnya ke `jalankan()`.

## Lingkungan — baca sebelum membandingkan

| | |
|---|---|
| Mesin | laptop dev (macOS, Apple Silicon) |
| PostgreSQL | 16 di Docker, port 55432 |
| Redis | 7 di Docker, port 56379 |
| API | `node apps/api/dist/main.js`, `NODE_ENV=production`, **satu proses, tanpa cluster** |
| Data | 300 pengguna, 38 squad, 12 lesson |
| Node | v24.20.0 |

**Ini bukan angka produksi.** Klien beban, API, dan database berjalan di mesin yang sama dan
berebut CPU yang sama — yang berarti angkanya bisa **lebih baik** di produksi (database
terpisah) atau **lebih buruk** (latensi jaringan, data lebih besar, cold cache).

Yang berguna dari baseline ini bukan angka absolutnya, tapi **perbandingannya**: jalankan
ulang dengan perintah yang sama setelah perubahan besar, dan pergeserannya berarti sesuatu.

## Cara menjalankan ulang

```bash
docker compose up -d
pnpm db:migrate
pnpm build

export DATABASE_URL='postgres://strive:strive_dev_only@localhost:55432/strive'
node scripts/load-test.mjs seed --users 300

# API di port terpisah — 3001 sering sudah dipakai Docker
API_PORT=3199 NODE_ENV=production MODE=api node apps/api/dist/main.js &

API_URL=http://127.0.0.1:3199 \
  node scripts/load-test.mjs run --rps 500,1000,1500,3000 --duration 15 --users 300 \
    --out docs/reports/R-02
```

Data seed-nya memakai email `load-test-%@uji.test` dan dihapus-ulang di awal tiap `seed` —
aman dijalankan berkali-kali, dan tidak menyentuh data lain.
