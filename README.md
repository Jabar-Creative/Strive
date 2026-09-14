# Strive Academy

Platform belajar-karir **B2C** untuk mahasiswa Indonesia. Dua mesin yang saling
mengunci: **retensi** (streak harian, kartu belajar 2–3 menit, squad, liga) dan
**monetisasi** (klinik plagiarisme, ATS CV builder, Mastery Track, store).
Penghubungnya **Strive Coins** — koin yang diperoleh dari belajar mengurangi
biaya alat berbayar, sehingga belajar punya nilai rupiah yang bisa dirasakan.

> **Status repo: fondasi.** Struktur, konfigurasi, dan boilerplate kosong sudah
> berdiri. **Nol fitur bisnis.** Seluruh 73 item di `docs/BACKLOG.md` masih
> `todo`. Pekerjaan dimulai lewat protokol di [`AGENTS.md`](AGENTS.md).

---

## 1. Peta dokumen

Ada lima dokumen dan masing-masing menjawab pertanyaan yang berbeda. Salah buka
= jawaban yang salah.

| Pertanyaanmu                                               | Buka                                                                                        |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| "Apa yang harus terjadi kalau pengguna X?"                 | [`docs/PRD.md`](docs/PRD.md) — **sumber kebenaran perilaku**, 23 bagian                     |
| "Bagaimana cara menulis kodenya di repo ini?"              | [`CLAUDE.md`](CLAUDE.md) — **sumber kebenaran konvensi**, 10 aturan keras                   |
| "Apa yang dikerjakan berikutnya, dan apa statusnya?"       | [`docs/BACKLOG.md`](docs/BACKLOG.md) — **73 item + papan status**                           |
| "Kapan, siapa, dan apa gate minggu ini?"                   | [`docs/DELIVERY-PLAN.md`](docs/DELIVERY-PLAN.md) — 8 minggu, gate, 3 konfigurasi            |
| "Aku agent/developer, bagaimana satu sesi kerja berjalan?" | [`AGENTS.md`](AGENTS.md) — protokol 9 langkah                                               |
| "Antrean kerjaku apa?"                                     | [`docs/TASKS-DEV-A.md`](docs/TASKS-DEV-A.md) · [`docs/TASKS-DEV-B.md`](docs/TASKS-DEV-B.md) |
| "Item ini rawan — ada catatan tambahan?"                   | [`docs/AGENT-NOTES-RISKY-ITEMS.md`](docs/AGENT-NOTES-RISKY-ITEMS.md) — 6 item berisiko      |

**Kalau bertentangan:** PRD menang untuk perilaku · BACKLOG menang untuk angka ·
CLAUDE.md menang untuk konvensi kode.

---

## 2. Jalan dari nol — target 10 menit

Prasyarat: **Node 22+**, **pnpm 9+**, **Python 3.12**, **Docker**.

```bash
# 1 · Kloning & pasang dependensi                            (~2 menit)
git clone https://github.com/Jabar-Creative/Strive.git strive-academy
cd strive-academy
pnpm i

# 2 · Siapkan environment                                    (~1 menit)
cp .env.example .env
#    Nilai bawaan sudah aman untuk dev lokal. Kunci vendor (Midtrans, Copyleaks,
#    OpenAI, Resend) boleh dikosongkan sampai fitur yang memakainya dikerjakan.

# 3 · Hidupkan PostgreSQL 16, Redis 7, MinIO                  (~3 menit, sekali unduh)
docker compose up -d
docker compose ps          # ketiganya harus (healthy)

# 4 · Migrasi & seed                                         (BELUM ADA — item F-04)
pnpm db:migrate            # sekarang hanya mencetak pesan
pnpm db:types
pnpm seed

# 5 · Jalankan web + api + ai bersamaan                      (~2 menit, venv sekali)
pnpm dev
```

Lalu buka:

|       | URL                            | Isi                                 |
| ----- | ------------------------------ | ----------------------------------- |
| Web   | <http://localhost:3000>        | peta 12 rute stub                   |
| API   | <http://localhost:3001/health> | `{"status":"ok","service":"api",…}` |
| AI    | <http://localhost:8000/health> | `{"status":"ok","service":"ai",…}`  |
| MinIO | <http://localhost:59001>       | `strive` / `strive_dev_only`        |

**Port sudah dipakai?** Ketiganya bisa ditimpa lewat `.env`:
`WEB_PORT`, `API_PORT`, `AI_SERVICE_PORT`. PostgreSQL/Redis/MinIO sengaja
dipetakan ke `55432` / `56379` / `59000` supaya tidak bentrok dengan layanan
lain di mesinmu.

### Perintah lain

```bash
pnpm dev:web      pnpm dev:api      pnpm dev:worker      pnpm dev:ai
pnpm lint         pnpm typecheck    pnpm test            pnpm build
pnpm test:e2e                                # item R-01
pnpm seed:content <file>                     # item F-11

cd services/ai && ./.venv/bin/python -m pytest   # test AI service
```

**Sebelum membuka PR, keempatnya wajib hijau:**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

---

## 3. Cara kerja agentic

Proyek ini dikerjakan lewat sesi agent. Setiap sesi mengerjakan **tepat satu
item** dan berhenti. Itu bukan pembatasan gaya — item yang dikerjakan
paruh-paruh tidak pernah selesai dan tidak bisa direview.

**Satu sesi:**

1. Baca [`AGENTS.md`](AGENTS.md) — protokol sembilan langkah.
2. Tempel prompt pembuka (ada di bagian akhir `AGENTS.md`):

   ```
   Kamu agent untuk Dev A di repo Strive Academy.

   Jalankan protokol AGENTS.md dari langkah 1 sampai 9.
   Kerjakan SATU item berikutnya dari antrean docs/TASKS-DEV-A.md.

   Jangan lewati langkah 2 (verifikasi silang) — papan status tidak boleh
   dipercaya begitu saja.
   ```

3. Untuk enam item berisiko — `C-01`, `L-03`, `S-01`, `P-03`, `K-02`,
   `Q-02`/`Q-03` — tempelkan blok tambahan dari
   [`docs/AGENT-NOTES-RISKY-ITEMS.md`](docs/AGENT-NOTES-RISKY-ITEMS.md)
   **di atas** prompt itu.

**Dua hal yang paling sering dilewati, dan keduanya mahal:**

- **Langkah 2 — verifikasi silang.** Papan status adalah _klaim_, bukan bukti.
  Sesi sebelumnya bisa terputus di tengah atau menandai `done` tanpa
  menyelesaikan. Cek `git log` dan isi repo dulu.
- **Langkah 7 — buktikan, jangan klaim.** Setiap acceptance criteria butuh
  **output perintah yang benar-benar dijalankan**. "Sudah sesuai" bukan bukti.

Papan status di `docs/BACKLOG.md` adalah satu-satunya tempat status dicatat.
Agent menulis ke sana; manusia mengoreksi. **ID, estimasi, dan urutan minggu
tidak boleh diubah agent** — itu keputusan perencanaan.

---

## 4. Dua developer, batas yang tegas

Dibagi per **alur vertikal**, bukan per lapisan, supaya tidak ada yang menunggu
API orang lain selesai.

|                   | Dev A — core transaksional & integrasi                                                                                               | Dev B — antarmuka, AI service & fitur mandiri                                                                |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| **Beban**         | 37,25 dev-hari                                                                                                                       | 35,25 dev-hari                                                                                               |
| **Milik sendiri** | `db/migrations/`<br>`apps/api/src/modules/wallet/`<br>`apps/api/src/modules/learning/attempts.service.ts`<br>`apps/api/src/workers/` | `packages/ui/`<br>`packages/contracts/`<br>`apps/web/`<br>`services/ai/`                                     |
| **Isi**           | Migrasi, auth, coin ledger, `POST /attempts`, streak, squad/ZSET/outbox, payment, scan, WS, load test, audit keamanan                | Design system, seluruh layar, FastAPI (ekstraksi → LLM → skor → render), store, notifikasi, rollup liga, E2E |

**Aturan lintas batas:**

- Butuh perubahan skema tapi kamu Dev B? **Buka isu**
  ([template](.github/ISSUE_TEMPLATE/schema-change.md)), jangan tulis migrasi
  tandingan. Dua orang menulis migrasi paralel adalah konflik yang baru ketahuan
  saat deploy.
- Butuh komponen UI tapi kamu Dev A? **Minta ke Dev B.** Jangan bikin varian
  sendiri.
- Perubahan breaking di `packages/contracts` → **PR terpisah**, supaya terlihat
  di review dan tidak terselip dalam PR fitur.
- Dua developer tidak boleh mengerjakan file yang sama di minggu yang sama.

Batas modul NestJS ditegakkan **lint**, bukan kesepakatan: impor dari modul lain
hanya boleh lewat barrel file (`../wallet`), tidak pernah menembus ke file di
dalamnya (`../wallet/coin-ledger.service`).

---

## 5. Dua hal yang akan merusak produksi kalau dilanggar

Sepuluh aturan lengkap ada di [`CLAUDE.md`](CLAUDE.md). Dua ini yang paling
sering dilanggar tanpa disadari, dan keduanya **tidak bisa diperbaiki tanpa
migrasi data**.

### ⚠ JANGAN menulis `coin_ledger` di luar `CoinLedgerService`

```ts
// JANGAN PERNAH
await trx.insertInto('coin_ledger').values(...).execute();
await trx.updateTable('users').set({ coin_balance: newBalance }).execute();

// SELALU
await coins.write(trx, {
  userId, entryType: 'spend_scan', amount: -2400,
  refType: 'scan', refId: scan.id, idempotencyKey,
});
```

`coin_ledger` bersifat **append-only** — trigger database menolak `UPDATE` dan
`DELETE`. Koreksi ditulis sebagai entri `adjust` baru.
`users.coin_balance` hanyalah **cache**; kebenarannya `SUM(coin_ledger.amount)`.
Menulis saldo tanpa menulis ledger di transaksi yang sama **adalah bug**, meski
angkanya kebetulan benar hari itu.

### ⚠ JANGAN pakai `::date` tanpa `AT TIME ZONE`

```sql
-- JANGAN PERNAH: streak pengguna WIB putus pukul 07.00 pagi tanpa sebab
completed_at::date

-- SELALU: "hari ini" adalah hari LOKAL pengguna, dihitung di Postgres
(now() AT TIME ZONE users.timezone)::date
```

Berlaku untuk **streak, quest harian, dan seluruh kuota harian**. Dihitung di
Postgres, bukan di Node — supaya tidak bergantung pada TZ proses. **Bug ini
tidak muncul di test yang berjalan di UTC**, jadi test wajib melintasi tiga zona
waktu.

**Tiga lagi yang sekelas:** setiap efek samping berbayar memakai
**hold → settle | release** (tidak pernah debit-lalu-refund manual) · tidak ada
penulisan Redis di dalam transaksi Postgres (pakai `outbox_events`) ·
`queue.add()` tidak pernah di dalam `db.transaction()`.

---

## 6. Struktur

```
strive-academy/
├─ AGENTS.md            protokol 9 langkah untuk agent
├─ CLAUDE.md            10 aturan keras, konvensi, kepemilikan file
├─ docs/                PRD · BACKLOG · DELIVERY-PLAN · TASKS-DEV-A/B · catatan risiko
├─ apps/web/            Next.js 15 App Router — (auth) (student) (console)
├─ apps/api/            NestJS — MODE=api | worker, satu proses REST + WS
├─ services/ai/         Python 3.12 FastAPI — ekstraksi, LLM, skor ATS, render
├─ packages/contracts/  skema zod + tipe TS, dipakai web DAN api
├─ packages/ui/         token design system + primitif Shadcn
├─ db/migrations/       SQL murni, forward-only — hanya Dev A
├─ db/seeds/            pricing_config, track contoh, item store
├─ infra/               docker-compose, Dockerfile web/api/ai
└─ .github/             CI, template PR & isu
```

Yang dibeli, **bukan dibangun** — kalau muncul dorongan membangun salah satunya
dari nol, **berhenti**: auth (Better-Auth) · halaman checkout (Midtrans Snap
hosted) · panel admin (Retool di atas view SQL read-only) · komponen UI dasar
(Shadcn blocks) · pengiriman email (Resend).
