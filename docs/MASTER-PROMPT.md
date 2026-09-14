# MASTER PROMPT — Setup Repo Strive Academy

Satu prompt, dijalankan **sekali**, di folder kosong.

**Yang dihasilkan:** repository berisi dokumentasi produk lengkap, aturan agent, backlog dengan papan status, task per developer, struktur folder standar, dan boilerplate kosong yang siap dilanjutkan.

**Yang TIDAK dihasilkan:** satu pun fitur bisnis. Prompt ini berhenti tepat sebelum development dimulai.

---

## Sebelum menjalankan

Siapkan folder kosong dengan **delapan file** ini di dalamnya (letaknya diatur oleh prompt nanti):

```
AGENTS.md                      protokol kerja agent
CLAUDE.md                      aturan kode & konvensi
PRD.md                         spesifikasi produk end-to-end
BACKLOG.md                     73 item + papan status
DELIVERY-PLAN.md               jadwal 8 minggu
TASKS-DEV-A.md                 antrean kerja Dev A
TASKS-DEV-B.md                 antrean kerja Dev B
AGENT-NOTES-RISKY-ITEMS.md     catatan untuk 6 item berisiko
```

Prasyarat: Node 22, pnpm 9, Python 3.12, Docker, dan akses tulis ke `https://github.com/Jabar-Creative/Strive.git`.

---

## Prompt

Salin seluruh blok di bawah ini ke Claude Code.

````
Kamu Lead Engineer yang menyiapkan repository untuk Strive Academy — platform
belajar-karir B2C untuk mahasiswa Indonesia, dikerjakan 2 developer selama
8 minggu dengan metode agentic development.

════════════════════════════════════════════════════════════════════════
BATAS TUGAS — BACA INI DULU
════════════════════════════════════════════════════════════════════════

Sesi ini HANYA menyiapkan fondasi: dokumentasi, struktur folder, dan
boilerplate kosong.

JANGAN mengimplementasikan satu pun fitur bisnis. Tidak ada auth, tidak ada
coin ledger, tidak ada migrasi tabel, tidak ada komponen UI berisi logika.
Semua itu dikerjakan sesi-sesi berikutnya oleh agent masing-masing developer
lewat protokol AGENTS.md.

Kalau kamu tergoda menulis logika bisnis, BERHENTI. Itu di luar scope.

════════════════════════════════════════════════════════════════════════
LANGKAH 1 — BACA SELURUH DOKUMEN
════════════════════════════════════════════════════════════════════════

Baca kedelapan file yang ada di folder ini, seluruhnya, sebelum menulis apa pun:

  AGENTS.md · CLAUDE.md · PRD.md · BACKLOG.md · DELIVERY-PLAN.md
  TASKS-DEV-A.md · TASKS-DEV-B.md · AGENT-NOTES-RISKY-ITEMS.md

Perhatikan khusus:
  - PRD.md §8 arsitektur, §9 skema database, §10 API spec, §19 environment
  - CLAUDE.md "Sepuluh aturan" dan "Struktur repo"
  - AGENTS.md protokol sembilan langkah

Setelah membaca, tulis ringkasan 10 baris: apa produk ini, dua mesinnya,
berapa item backlog, pembagian dua developer, dan tiga aturan paling keras.
Ini membuktikan kamu benar-benar membaca.

════════════════════════════════════════════════════════════════════════
LANGKAH 2 — GIT
════════════════════════════════════════════════════════════════════════

  git init
  git branch -M main
  git remote add origin https://github.com/Jabar-Creative/Strive.git

Buat .gitignore yang menutup: node_modules, .next, dist, build, coverage,
.env dan seluruh variannya kecuali .env.example, __pycache__, .venv, .pytest_cache,
.DS_Store, *.log, .turbo, playwright-report, test-results.

JANGAN push dulu. Push dilakukan manusia di akhir setelah memeriksa.

════════════════════════════════════════════════════════════════════════
LANGKAH 3 — TATA LETAK DOKUMEN
════════════════════════════════════════════════════════════════════════

Pindahkan file ke posisi akhirnya:

  /AGENTS.md                          tetap di root — dibaca agent tiap sesi
  /CLAUDE.md                          tetap di root — dibaca Claude Code otomatis
  /README.md                          BUAT BARU (lihat langkah 6)
  /docs/PRD.md
  /docs/BACKLOG.md
  /docs/DELIVERY-PLAN.md
  /docs/TASKS-DEV-A.md
  /docs/TASKS-DEV-B.md
  /docs/AGENT-NOTES-RISKY-ITEMS.md

Setelah memindahkan, PERIKSA seluruh rujukan silang antar dokumen masih benar
(mis. teks "docs/BACKLOG.md" vs "BACKLOG.md"). Perbaiki yang salah, dan
laporkan apa saja yang kamu perbaiki.

════════════════════════════════════════════════════════════════════════
LANGKAH 4 — STRUKTUR FOLDER & BOILERPLATE
════════════════════════════════════════════════════════════════════════

Bangun struktur PERSIS seperti CLAUDE.md bagian "Struktur repo".

Aturan boilerplate — ini yang paling sering disalahpahami:

  BUAT: folder, file konfigurasi, file index/barrel kosong, tipe dasar,
        satu contoh kecil per pola supaya developer tahu bentuknya
  JANGAN BUAT: implementasi fitur apa pun

4.1 Monorepo
  - pnpm-workspace.yaml: apps/*, packages/*
  - package.json root dengan SELURUH script di CLAUDE.md bagian "Perintah"
    (yang belum ada implementasinya cukup echo pesan "belum diimplementasikan")
  - tsconfig.base.json strict: true, noUncheckedIndexedAccess: true
  - ESLint + Prettier, satu konfigurasi dipakai seluruh workspace
  - Husky + lint-staged: commit ditolak kalau lint gagal
  - Aturan lint impor yang MELARANG impor lintas modul NestJS selain lewat
    barrel file — ini yang menegakkan batas modul di CLAUDE.md

4.2 apps/web — Next.js 15 App Router
  - Route group (auth), (student), (console) dengan layout masing-masing
  - 12 page stub sesuai daftar rute di CLAUDE.md, isinya judul + placeholder,
    bisa dinavigasi
  - lib/api-client.ts  KERANGKA typed client, belum ada endpoint
  - lib/ws-client.ts   KERANGKA, belum konek
  - Tailwind terpasang, shadcn/ui ter-init — TANPA token warna Strive,
    itu item F-06 milik Dev B

4.3 apps/api — NestJS
  - main.ts dengan switch MODE=api|worker
  - common/    folder + barrel kosong untuk guards, interceptors, filters, pipes
  - infra/     KERANGKA modul kosong: kysely, redis, bullmq, storage
  - modules/   satu folder per modul di CLAUDE.md, masing-masing berisi
               .module.ts kosong yang sudah terdaftar di AppModule
  - realtime/  folder kosong + barrel
  - workers/   folder kosong + barrel
  - SATU contoh modul lengkap tapi trivial (mis. modules/health) berisi
    controller + service + test, supaya developer tahu bentuk yang diharapkan

4.4 services/ai — FastAPI
  - main.py dengan satu endpoint /health
  - routers/ pipelines/ prompts/ core/ — folder + __init__.py
  - pyproject.toml, requirements.txt
  - core/config.py membaca env sesuai PRD.md §19.2
  - SATU test pytest untuk /health

4.5 packages/contracts
  - Struktur folder per domain, index.ts barrel
  - SATU skema zod contoh (mis. health) + tipe turunannya
  - TANPA skema endpoint sungguhan — itu item F-08 milik Dev B

4.6 packages/ui
  - Struktur folder + barrel
  - TANPA komponen Strive — itu item F-07 milik Dev B

4.7 db
  - db/migrations/ KOSONG, dengan README yang menjelaskan:
    SQL murni, berurut, forward-only, hanya Dev A yang menulis,
    dan bahwa 001_init.sql adalah item F-04
  - db/seeds/ kosong + README

4.8 infra
  - docker-compose.yml: PostgreSQL 16, Redis 7, MinIO — dengan healthcheck,
    volume persisten, port yang tidak bentrok
  - Dockerfile untuk web, api, ai
  - .env.example memuat SELURUH variabel PRD.md §19.2, tiap baris berkomentar,
    nilai dev yang aman

4.9 .github
  - workflows/ci.yml: lint, typecheck, test, build. Target < 5 menit.
  - PULL_REQUEST_TEMPLATE.md yang memaksa pengisian:
      ID item · acceptance criteria sebagai checklist ·
      "apa yang bisa rusak" · bukti test dijalankan
  - ISSUE_TEMPLATE/ untuk bug dan untuk permintaan perubahan skema
    (permintaan skema wajib lewat isu — lihat CLAUDE.md kepemilikan file)

════════════════════════════════════════════════════════════════════════
LANGKAH 5 — VERIFIKASI PAPAN STATUS
════════════════════════════════════════════════════════════════════════

Buka docs/BACKLOG.md papan status. Pastikan:

  - Ada 73 baris item
  - SELURUHNYA berstatus `todo`
  - Ringkasan progres menunjukkan done=0, todo=73, 72,5 dev-hari

Item yang kamu kerjakan di sesi ini (F-01, F-02, F-03, F-09, dan sebagian F-05)
BELUM boleh ditandai done — kamu hanya membuat kerangkanya, belum memenuhi
acceptance criteria-nya. Biarkan `todo`.

Kalau kamu tidak setuju dengan penilaian ini untuk item tertentu, KATAKAN
alasannya di laporan akhir — jangan mengubah papan sendiri.

════════════════════════════════════════════════════════════════════════
LANGKAH 6 — README.md
════════════════════════════════════════════════════════════════════════

Tulis README.md yang memuat, ringkas:

  1. Apa produk ini, dalam 3 kalimat
  2. Peta dokumen: file mana untuk pertanyaan apa (tabel)
  3. Cara menjalankan dari nol — target 10 menit, langkah per langkah
  4. Cara kerja agentic: baca AGENTS.md, tempel prompt pembuka sesi,
     satu sesi satu item
  5. Pembagian dua developer dan file milik masing-masing
  6. Peringatan: JANGAN menulis coin_ledger di luar CoinLedgerService,
     JANGAN pakai ::date tanpa AT TIME ZONE

README ditujukan ke developer yang baru bergabung dan belum tahu apa-apa.

════════════════════════════════════════════════════════════════════════
LANGKAH 7 — VERIFIKASI
════════════════════════════════════════════════════════════════════════

Jalankan dan TUNJUKKAN OUTPUT masing-masing. Jangan klaim, buktikan.

  pnpm i
  pnpm lint
  pnpm typecheck
  pnpm build
  docker compose up -d && docker compose ps      # ketiganya healthy
  pnpm dev                                        # web + api + ai hidup
  curl -s localhost:3000 | head -5                # page stub merespons
  curl -s localhost:3001/health                   # api merespons
  curl -s localhost:8000/health                   # ai service merespons
  cd services/ai && pytest                        # test health hijau
  git remote -v                                   # origin menunjuk ke Strive.git

Lalu periksa manual dan laporkan:
  - Seluruh 12 rute web bisa dibuka
  - .env.example dibandingkan baris-per-baris dengan PRD.md §19.2 —
    sebutkan variabel yang hilang kalau ada
  - Struktur folder dibandingkan dengan CLAUDE.md "Struktur repo" —
    sebutkan yang berbeda kalau ada

════════════════════════════════════════════════════════════════════════
LANGKAH 8 — COMMIT
════════════════════════════════════════════════════════════════════════

Commit terpisah per kelompok, jangan satu commit raksasa:

  chore: inisialisasi repo, gitignore, remote
  docs: tata letak dokumen produk dan protokol agent
  chore: monorepo pnpm, typescript strict, lint, hook
  chore: kerangka apps/web
  chore: kerangka apps/api
  chore: kerangka services/ai
  chore: kerangka packages/contracts dan packages/ui
  chore: infra docker-compose, dockerfile, env example
  chore: ci, template PR dan isu
  docs: README

JANGAN push. Laporkan bahwa repo siap di-push manusia.

════════════════════════════════════════════════════════════════════════
LAPORAN AKHIR — WAJIB EMPAT BAGIAN
════════════════════════════════════════════════════════════════════════

SELESAI
  Daftar yang dibuat, dengan bukti perintah verifikasi yang dijalankan.

KUPUTUSKAN SENDIRI
  Setiap hal yang tidak dijawab dokumen dan kamu putuskan sendiri —
  versi library, struktur file, penamaan. Tulis "tidak ada" kalau memang
  tidak ada, jangan dikosongkan.

MASALAH YANG KUTEMUKAN DI DOKUMEN
  Pertentangan antar dokumen, bagian yang tidak bisa diimplementasikan,
  variabel env yang hilang, rujukan file yang salah. Ini bagian paling
  berguna dari laporanmu — jangan disopankan.

SIAP DIKERJAKAN BERIKUTNYA
  Item pertama untuk Dev A dan Dev B menurut papan status dan antrean,
  beserta dependensinya.
````

---

## Setelah prompt ini selesai

1. **Periksa laporan "MASALAH YANG KUTEMUKAN"** — perbaiki dokumennya sebelum development dimulai. Jauh lebih murah sekarang daripada di minggu 4.
2. **Push manual:** `git push -u origin main`
3. **Mulai development.** Dua developer, masing-masing sesi agent sendiri, memakai prompt pembuka di `AGENTS.md`:

```
Kamu agent untuk Dev A di repo Strive Academy.

Jalankan protokol AGENTS.md dari langkah 1 sampai 9.
Kerjakan SATU item berikutnya dari antrean docs/TASKS-DEV-A.md.

Jangan lewati langkah 2 (verifikasi silang) — papan status tidak boleh
dipercaya begitu saja.
```

Untuk `C-01`, `L-03`, `S-01`, `P-03`, `K-02`, `Q-02`/`Q-03`, tempelkan blok dari `docs/AGENT-NOTES-RISKY-ITEMS.md` di atas prompt itu.

---

## Yang dihasilkan repo ini

```
Strive/
├─ AGENTS.md                     protokol 9 langkah untuk agent
├─ CLAUDE.md                     10 aturan keras, konvensi, kepemilikan file
├─ README.md                     onboarding
├─ docs/
│  ├─ PRD.md                     23 bagian, 17 epik, skema, API, NFR
│  ├─ BACKLOG.md                 73 item + PAPAN STATUS yang di-update agent
│  ├─ DELIVERY-PLAN.md           8 minggu, gate, 3 konfigurasi
│  ├─ TASKS-DEV-A.md             antrean Dev A, 36 item
│  ├─ TASKS-DEV-B.md             antrean Dev B, 39 item
│  └─ AGENT-NOTES-RISKY-ITEMS.md syarat tambahan 6 item berisiko
├─ apps/web · apps/api · services/ai
├─ packages/contracts · packages/ui
├─ db/migrations · db/seeds        kosong, dengan README
├─ infra/                          compose, dockerfile, env
└─ .github/                        CI, template PR & isu
```

---

## Batas yang perlu dijaga

| Hal | Siapa | Kenapa penting |
|---|---|---|
| Papan status di `BACKLOG.md` | **Agent** menulis, manusia mengoreksi | Satu-satunya sumber keadaan. Agent wajib verifikasi silang dulu (AGENTS.md langkah 2) |
| ID, estimasi, urutan minggu | **Manusia saja** | Agent tidak boleh mengubahnya — itu keputusan perencanaan |
| `db/migrations/` | **Dev A saja** | Dua orang menulis migrasi paralel = konflik yang baru ketahuan saat deploy |
| `packages/ui`, `packages/contracts` | **Dev B saja** | Dev A memakai, tidak mengubah |
| Perubahan skema di luar PRD §9 | **Berhenti, buka isu** | Skema yang menyimpang dari PRD adalah utang tak terlihat |

---

## Jujur soal batasnya

Repo ini membuat setiap sesi agent punya konteks yang sama, sehingga kode sesi ke-50 masih cocok dengan arsitektur sesi ke-3. Itu nilainya.

Yang **tidak** dilakukannya:

- **Tidak berjalan sendiri.** Kamu menjalankan ~76 sesi dan mereview hasilnya.
- **Tidak menggantikan review.** Agent akan menulis kode yang lolos test tapi salah secara bisnis. Aturan "guard tidak menjawab kepemilikan" di `CLAUDE.md` adalah contoh persisnya.
- **Tidak menambah kapasitas.** Backlog 72,5 dev-hari tetap melawan 68 yang tersedia. Dokumen membuat 68 hari terpakai efisien, tidak membuatnya jadi 73.
- **Tidak mengerjakan yang bukan kode.** 90 kartu konten, akun vendor, konsultasi hukum, dan 8 keputusan produk tetap milik manusia — dan semuanya memblokir.
