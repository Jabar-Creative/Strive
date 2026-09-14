# TASKS — Dev B

> **Peran:** Antarmuka, AI service & fitur mandiri  
> **Beban:** 35,25 dev-hari terhadap 34 tersedia  
> **Antrean kerja.** Kerjakan dari atas ke bawah. Jangan melompat kecuali dependensi memaksa.

Status ada di papan status `BACKLOG.md`, bukan di file ini. File ini adalah **urutan**, bukan **keadaan**.

## Milik kamu sendiri

- `packages/ui/` — design system dan primitif
- `packages/contracts/` — skema zod (Dev A memakainya, tidak mengubahnya)
- `apps/web/` — seluruh layar
- `services/ai/` — AI service FastAPI

**Jangan sentuh** file milik Dev A. Kalau butuh perubahan di sana, buka isu — jangan edit langsung.

## Minggu 1 — 4,75 hari

| # | ID | Item | Hari | Butuh |
|---:|---|---|---:|---|
| 1 | `F-02` | docker-compose dev: PostgreSQL 16, Redis 7, MinIO, .env.example | 0,5 | — |
| 2 | `F-06` | Token design system -> tailwind.config, init Shadcn, mode gelap | 1 | — |
| 3 | `F-07` | UI kit dari Shadcn blocks: button, card, pill, streak chip, coin pill, badge liga, kartu lesson | 1 | `F-06` |
| 4 | `F-08` | packages/contracts: skema zod seluruh endpoint MVP | 1 | — |
| 5 | `F-09` | Wireframe sebagai page stub di kode (12 layar inti) | 0,5 | — |
| 6 | `F-10` | Kunci 8 keputusan produk (PRD §5) · **bersama** | 0,25 | — |
| 7 | `F-11` | Pipeline seed konten (CSV/JSON -> DB) + impor 1 track percontohan | 0,5 | `F-04` _(Dev A)_ |

## Minggu 2 — 4 hari

| # | ID | Item | Hari | Butuh |
|---:|---|---|---:|---|
| 1 | `A-03` | Layar login/register/reset + penyimpanan sesi client | 0,5 | `A-01` _(Dev A)_, `F-07` |
| 2 | `A-04` | Middleware rute: (student) vs (console) | 0,5 | `A-02` _(Dev A)_ |
| 3 | `L-02` | GradingService — penilaian sepenuhnya di server | 1 | `L-01` _(Dev A)_ |
| 4 | `L-04` | UI kartu bite-sized: pilihan ganda + swipe, feedback, animasi | 2 | `F-07`, `L-01` _(Dev A)_ |

## Minggu 3 — 4,5 hari

| # | ID | Item | Hari | Butuh |
|---:|---|---|---:|---|
| 1 | `AI-01` | FastAPI skeleton + auth service-to-service + config + cache | 1 | `F-05` _(Dev A)_ |
| 2 | `C-03` | UI dompet: saldo, riwayat, penjelasan tiap jenis entri | 1 | `C-02` _(Dev A)_, `F-07` |
| 3 | `L-05` | Layar daftar track & progres | 1 | `L-01` _(Dev A)_ |
| 4 | `S-03` | UI Hub + streak chip 4 status + quest harian | 1,5 | `S-02` _(Dev A)_ |

## Minggu 4 — 4 hari

| # | ID | Item | Hari | Butuh |
|---:|---|---|---:|---|
| 1 | `AI-02` | Ekstraksi PDF/DOCX + penyusunan dari profil pengguna | 1 | `AI-01` |
| 2 | `N-01` | Tabel notifications + API + pengiriman email (Resend) | 1 | `F-04` _(Dev A)_ |
| 3 | `P-01` | pricing_config berversi + 3 paket koin | 0,5 | `F-04` _(Dev A)_ |
| 4 | `Q-05` | UI squad + leaderboard (WS + fallback polling 30 dtk) | 1,5 | `Q-02` _(Dev A)_ |

## Minggu 5 — 4 hari

| # | ID | Item | Hari | Butuh |
|---:|---|---|---:|---|
| 1 | `AI-03` | Penyusunan LLM -> JSON terstruktur, prompt berversi, cache SHA-256 | 1,5 | `AI-02` |
| 2 | `N-02` | UI lonceng notifikasi + banner peringatan streak | 0,5 | `N-01` |
| 3 | `P-04` | UI top-up: pilih paket, bayar, status, kembali ke dompet | 0,5 | `P-02` _(Dev A)_ |
| 4 | `Q-04` | Job rollup mingguan + promosi/degradasi 20% | 1 | `Q-02` _(Dev A)_ |
| 5 | `RT-02` | Client hook useRealtime + fallback polling otomatis | 0,5 | `RT-01` _(Dev A)_ |

## Minggu 6 — 4 hari

| # | ID | Item | Hari | Butuh |
|---:|---|---|---:|---|
| 1 | `AI-04` | Skor ATS deterministik + daftar temuan konkret | 0,5 | `AI-03` |
| 2 | `AI-05` | Render PDF satu kolom, ramah parser | 0,5 | `AI-03` |
| 3 | `PL-01` | Form prompt terstruktur (role/context/task/format/constraints) + jalankan + simpan | 1 | `AI-01` |
| 4 | `ST-01` | store_items + pembelian transaksional (debit ledger) | 1 | `C-01` _(Dev A)_ |
| 5 | `ST-02` | UI etalase + unduh aset (signed URL 15 menit) | 1 | `ST-01` |

## Minggu 7 — 4,5 hari

| # | ID | Item | Hari | Butuh |
|---:|---|---|---:|---|
| 1 | `AI-07` | UI CV builder: isi profil, jalankan, lihat temuan, unduh | 1 | `AI-05` |
| 2 | `K-04` | UI klinik: unggah, antrean, skor kemiripan, riwayat | 1 | `K-02` _(Dev A)_ |
| 3 | `PL-02` | 3 template contoh + riwayat run | 0,5 | `PL-01` |
| 4 | `PR-03` | UI antrean review + form rubrik | 1 | `PR-02` _(Dev A)_ |
| 5 | `PR-04` | Konsol mentor: antrean validasi, approve/tolak, catatan | 1 | `PR-02` _(Dev A)_ |

## Minggu 8 — 5,5 hari  ⚠ **lewat batas 5 hari**

| # | ID | Item | Hari | Butuh |
|---:|---|---|---:|---|
| 1 | `MT-02` | Wawancara terpandu: bank soal statis + jawaban teks + feedback LLM | 1,5 | `MT-01` _(Dev A)_, `AI-01` |
| 2 | `MT-03` | Review personal statement (LLM terstruktur) | 1 | `MT-01` _(Dev A)_, `AI-01` |
| 3 | `MT-04` | UI kedua modul Mastery | 1 | `MT-02`, `MT-03` |
| 4 | `R-01` | E2E Playwright: daftar -> belajar -> streak -> top-up -> scan | 1 | `A-03`, `L-04`, `P-04`, `K-04` |
| 5 | `R-05` | Cadangan perbaikan bug · **bersama** | 1 | — |

---

## Dependensi lintas developer

Item milik Dev B yang menunggu Dev A. **Cek status ini sebelum memulai minggu baru.**

| Item kamu | W | Menunggu | Milik | W |
|---|:---:|---|:---:|:---:|
| `F-11` | W1 | `F-04` | Dev A | W1 |
| `A-03` | W2 | `A-01` | Dev A | W2 |
| `A-04` | W2 | `A-02` | Dev A | W2 |
| `L-02` | W2 | `L-01` | Dev A | W2 |
| `L-04` | W2 | `L-01` | Dev A | W2 |
| `AI-01` | W3 | `F-05` | Dev A | W1 |
| `C-03` | W3 | `C-02` | Dev A | W3 |
| `L-05` | W3 | `L-01` | Dev A | W2 |
| `S-03` | W3 | `S-02` | Dev A | W3 |
| `N-01` | W4 | `F-04` | Dev A | W1 |
| `P-01` | W4 | `F-04` | Dev A | W1 |
| `Q-05` | W4 | `Q-02` | Dev A | W4 |
| `P-04` | W5 | `P-02` | Dev A | W5 |
| `Q-04` | W5 | `Q-02` | Dev A | W4 |
| `RT-02` | W5 | `RT-01` | Dev A | W5 |
| `ST-01` | W6 | `C-01` | Dev A | W2 |
| `K-04` | W7 | `K-02` | Dev A | W6 |
| `PR-03` | W7 | `PR-02` | Dev A | W6 |
| `PR-04` | W7 | `PR-02` | Dev A | W6 |
| `MT-02` | W8 | `MT-01` | Dev A | W6 |
| `MT-03` | W8 | `MT-01` | Dev A | W6 |
