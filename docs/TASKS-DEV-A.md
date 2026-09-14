# TASKS — Dev A

> **Peran:** Core transaksional & integrasi  
> **Beban:** 37,25 dev-hari terhadap 34 tersedia  
> **Antrean kerja.** Kerjakan dari atas ke bawah. Jangan melompat kecuali dependensi memaksa.

Status ada di papan status `BACKLOG.md`, bukan di file ini. File ini adalah **urutan**, bukan **keadaan**.

## Milik kamu sendiri

- `db/migrations/` — hanya kamu yang boleh menulis migrasi
- `apps/api/src/modules/learning/attempts.service.ts` — satu transaksi, satu pemilik
- `apps/api/src/modules/wallet/` — CoinLedgerService
- `apps/api/src/workers/` — outbox, reaper, rollup, rekonsiliasi

**Jangan sentuh** file milik Dev B. Kalau butuh perubahan di sana, buka isu — jangan edit langsung.

## Minggu 1 — 5,25 hari  ⚠ **lewat batas 5 hari**

| # | ID | Item | Hari | Butuh |
|---:|---|---|---:|---|
| 1 | `F-01` | Monorepo pnpm, TypeScript strict, ESLint, Prettier, hook pre-commit | 1 | — |
| 2 | `F-03` | CI: lint, typecheck, unit test, build, migrasi kering | 1 | `F-01` |
| 3 | `F-04` | Migrasi 001_init.sql + codegen tipe Kysely | 1,5 | `F-02` _(Dev B)_, `F-10` |
| 4 | `F-05` | Deploy staging otomatis dari main (web, api, ai, PG, Redis, storage) | 1,5 | `F-03` |
| 5 | `F-10` | Kunci 8 keputusan produk (PRD §5) · **bersama** | 0,25 | — |

## Minggu 2 — 5 hari

| # | ID | Item | Hari | Butuh |
|---:|---|---|---:|---|
| 1 | `A-01` | Integrasi Better-Auth + adapter PostgreSQL + rotasi refresh token | 0,5 | `F-04` |
| 2 | `A-02` | JwtGuard + RolesGuard + decorator @Roles + matriks akses ter-test | 1 | `A-01` |
| 3 | `C-01` | CoinLedgerService: write, hold, settle, release + trigger immutable | 2 | `F-04` |
| 4 | `L-01` | API baca track/modul/lesson/kartu + serializer buang kunci jawaban | 1,5 | `F-04` |

## Minggu 3 — 5 hari

| # | ID | Item | Hari | Butuh |
|---:|---|---|---:|---|
| 1 | `C-02` | GET /wallet + GET /wallet/ledger (cursor-paginated) | 0,5 | `C-01` |
| 2 | `S-01` | StreakService timezone-aware + kredit freeze | 1,5 | `F-04` |
| 3 | `L-03` | POST /attempts: attempt + streak + koin + outbox dalam satu transaksi | 2 | `C-01`, `L-02` _(Dev B)_, `S-01` |
| 4 | `S-02` | GET /hub agregat: streak, quest, peringkat, saldo, kartu berikut | 1 | `S-01`, `C-01` |

## Minggu 4 — 4,5 hari

| # | ID | Item | Hari | Butuh |
|---:|---|---|---:|---|
| 1 | `C-04` | Job rekonsiliasi harian + alert selisih | 0,5 | `C-01` |
| 2 | `Q-01` | Pembentukan squad otomatis (8-12 anggota) + gabung/keluar | 0,5 | `F-04` |
| 3 | `Q-02` | LeaderboardService: ZSET, rotasi kunci musim, rebuild dari Postgres | 1,5 | `Q-01` |
| 4 | `Q-03` | Outbox worker: poll, FOR UPDATE SKIP LOCKED, ZINCRBY, retry, dead-letter | 1 | `L-03`, `Q-02` |
| 5 | `S-04` | Scheduler peringatan streak + notifikasi in-app & email | 1 | `S-01`, `N-01` _(Dev B)_ |

## Minggu 5 — 5 hari

| # | ID | Item | Hari | Butuh |
|---:|---|---|---:|---|
| 1 | `P-02` | POST /payments/checkout — Midtrans Snap, QRIS | 1 | `P-01` _(Dev B)_, `C-01` |
| 2 | `P-03` | Webhook: verifikasi signature, idempotensi, entri 'purchase' | 1,5 | `P-02` |
| 3 | `PR-01` | Alokasi 2 reviewer lintas squad, identitas disembunyikan | 1 | `Q-01` |
| 4 | `RT-01` | WS gateway + Redis pub/sub adapter, kanal squad:{id} | 1,5 | `Q-03` |

## Minggu 6 — 4 hari

| # | ID | Item | Hari | Butuh |
|---:|---|---|---:|---|
| 1 | `K-01` | Upload PDF/DOCX + SHA-256 + simpan ke object storage | 1 | `F-05` |
| 2 | `K-02` | ScanService: dedup, hold/settle/release, reaper 30 menit | 1,5 | `C-01`, `K-01` |
| 3 | `MT-01` | Skema mastery_sessions + API | 0,5 | `F-04` |
| 4 | `PR-02` | API submit review + poin berbobot + cap harian | 1 | `PR-01`, `C-01` |

## Minggu 7 — 3,5 hari

| # | ID | Item | Hari | Butuh |
|---:|---|---|---:|---|
| 1 | `AI-06` | Tabel ai_jobs + dispatcher di Node + pencatatan biaya | 1 | `AI-01` _(Dev B)_ |
| 2 | `K-03` | Worker Copyleaks + webhook hasil + laporan terunduh | 1,5 | `K-02` |
| 3 | `SA-01` | View SQL untuk transaksi & audit + koneksi Retool read-only | 0,5 | `F-04` |
| 4 | `SA-02` | PATCH /admin/pricing — terbit versi baru, bukan menimpa | 0,5 | `P-01` _(Dev B)_ |

## Minggu 8 — 5 hari

| # | ID | Item | Hari | Butuh |
|---:|---|---|---:|---|
| 1 | `R-02` | Load test /hub & leaderboard — target p95 <250 ms @ 500 rps | 1 | `S-02`, `Q-02` |
| 2 | `R-03` | Audit keamanan: auth, webhook, upload, rate limit, header | 1 | `A-02`, `P-03`, `K-01` |
| 3 | `R-04` | Observability: log terstruktur, error tracking, alert biaya & antrean | 1 | `C-04`, `Q-03`, `AI-06` |
| 4 | `R-05` | Cadangan perbaikan bug · **bersama** | 1 | — |
| 5 | `SA-03` | Endpoint /admin/integrations/health + biaya vendor harian | 0,5 | `AI-06` |
| 6 | `SA-04` | Dasbor Retool: transaksi, harga, audit, health | 0,5 | `SA-01` |

---

## Dependensi lintas developer

Item milik Dev A yang menunggu Dev B. **Cek status ini sebelum memulai minggu baru.**

| Item kamu | W | Menunggu | Milik | W |
|---|:---:|---|:---:|:---:|
| `F-04` | W1 | `F-02` | Dev B | W1 |
| `F-04` | W1 | `F-10` | **bersama** | W1 |
| `L-03` | W3 | `L-02` | Dev B | W2 |
| `S-04` | W4 | `N-01` | Dev B | W4 |
| `P-02` | W5 | `P-01` | Dev B | W4 |
| `AI-06` | W7 | `AI-01` | Dev B | W3 |
| `SA-02` | W7 | `P-01` | Dev B | W4 |
