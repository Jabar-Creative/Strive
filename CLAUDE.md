# CLAUDE.md — Strive Academy

Repo knowledge. Dibaca otomatis oleh Claude Code di setiap sesi.

> **Sumber kebenaran:** `docs/PRD.md` (perilaku) · `docs/BACKLOG.md` (estimasi & ID) · `docs/DELIVERY-PLAN.md` (jadwal) · file ini (konvensi kode).
> Kalau ada pertentangan, PRD menang untuk perilaku, file ini menang untuk cara menulis kode.

---

## Apa ini

Platform belajar-karir B2C untuk mahasiswa Indonesia. Dua mesin: **retensi** (streak, kartu bite-sized, squad, liga, koin) dan **monetisasi** (klinik plagiarisme, ATS CV, Mastery Track, store). Keduanya terhubung lewat Strive Coins.

**Bukan** produk B2B. Tidak ada multi-tenancy, blockchain, atau hardware. Jangan pernah menyarankannya.

---

## Sepuluh aturan yang tidak boleh dilanggar

Kalau sebuah perubahan melanggar salah satu ini, **hentikan dan tanya** — jangan cari jalan pintas.

### 1. `coin_ledger` append-only

Tidak pernah `UPDATE`, tidak pernah `DELETE`. Trigger database menolaknya. Koreksi ditulis sebagai entri `adjust` baru.

### 2. `users.coin_balance` adalah cache, bukan kebenaran

Kebenarannya `SUM(coin_ledger.amount)`. Kalau menulis saldo tanpa menulis ledger di transaksi yang sama, itu bug.

### 3. Semua perpindahan koin lewat `CoinLedgerService`

Tidak ada kode lain yang boleh `INSERT INTO coin_ledger` atau `UPDATE users.coin_balance`. Store, scan, payment, attempt — semuanya memanggil service.

### 4. Setiap efek samping berbayar memakai hold → settle | release

Tidak pernah "debit lalu refund manual". Refund manual berarti ada manusia yang harus tahu bahwa refund dibutuhkan, dan itu tidak terjadi.

### 5. "Hari ini" selalu zona waktu pengguna

```sql
(now() AT TIME ZONE users.timezone)::date
```

Jangan pernah `::date` atas timestamptz UTC untuk urusan streak, quest, atau kuota harian. Dihitung di Postgres, bukan di Node — agar tidak bergantung pada TZ proses.

### 6. Tidak ada penulisan Redis di dalam transaksi Postgres

Cache yang berisi nilai dari transaksi yang di-rollback lebih berbahaya daripada cache kosong. Pakai `outbox_events`.

### 7. Redis adalah turunan, selalu bisa dibangun ulang

Setiap struktur di Redis harus punya fungsi rebuild dari Postgres. Kalau menambah kunci Redis baru tanpa fungsi rebuild-nya, itu belum selesai.

### 8. Node tidak pernah memanggil LLM langsung

Selalu lewat `ai_jobs` + AI service. Batas ini yang membuat biaya bisa diaudit di satu tempat.

### 9. Penilaian selalu di server

Skor lesson, skor ATS, poin — client tidak pernah dipercaya. Kunci jawaban dibuang di serializer sebelum dikirim.

### 10. Enqueue setelah commit

`queue.add()` tidak pernah di dalam `db.transaction()`. Job yang berjalan sebelum commit akan membaca data yang belum ada.

---

## Struktur repo

```
strive-academy/
├─ apps/
│  ├─ web/                     Next.js 15 · App Router · Tailwind · Shadcn · Framer Motion
│  │  ├─ app/
│  │  │  ├─ (auth)/            login, register, reset, verify
│  │  │  ├─ (student)/
│  │  │  │  ├─ hub/            streak, quest harian, ringkasan squad
│  │  │  │  ├─ learn/          track, modul, kartu bite-sized
│  │  │  │  ├─ squad/          anggota, leaderboard, antrean review
│  │  │  │  ├─ clinic/         unggah & riwayat scan
│  │  │  │  ├─ career/         ATS CV builder, prompt lab
│  │  │  │  ├─ mastery/        wawancara, personal statement
│  │  │  │  ├─ store/          etalase penukaran koin
│  │  │  │  └─ wallet/         saldo, ledger, top-up
│  │  │  └─ (console)/         mentor + superadmin, layout padat
│  │  ├─ components/           komposisi; primitif ada di packages/ui
│  │  ├─ lib/                  api client (typed), ws client, hooks
│  │  └─ public/
│  │
│  └─ api/                     NestJS · REST + WebSocket · MODE=api|worker
│     └─ src/
│        ├─ main.ts
│        ├─ common/            guards, interceptor idempotency, filter, zod pipe
│        ├─ infra/             kysely, redis, bullmq, storage, http clients
│        ├─ modules/
│        │  ├─ auth/ users/ learning/ streak/ squad/ league/
│        │  ├─ wallet/ payment/ store/ scan/
│        │  ├─ career/ mastery/       (proxy tipis ke AI service)
│        │  └─ mentor/ admin/ notification/
│        ├─ realtime/          ws gateway + redis pub/sub adapter
│        └─ workers/           outbox · scan · ai-dispatch · notify
│                              league-rollup · reconcile-balance · reaper
├─ services/ai/                Python 3.12 · FastAPI
│  └─ app/
│     ├─ main.py
│     ├─ routers/              cv.py · prompt.py · interview.py · statement.py
│     ├─ pipelines/            extract.py · ats_score.py · llm.py · render.py
│     ├─ prompts/              template berversi, diuji terpisah
│     └─ core/                 config, auth service-to-service, cache
├─ packages/
│  ├─ contracts/               skema zod + tipe TS, dipakai web & api
│  └─ ui/                      token design system + primitif Shadcn
├─ db/
│  ├─ migrations/              SQL murni, berurut, forward-only
│  │                           001_init.sql = 31 tabel (F-04, selesai)
│  └─ seeds/                   KOSONG — item F-11
├─ scripts/                    perkakas lintas-OS, Node murni, nol dependensi
│                              dev-web · dev-api · dev-ai · db-migrate · db-types
├─ docs/                       PRD.md · BACKLOG.md · DELIVERY-PLAN.md
└─ infra/                      docker-compose dev, Dockerfile, CI
```

### Kepemilikan file

| Path | Pemilik | Aturan |
|---|---|---|
| `db/migrations/` | **Dev A saja** | Dev B mengajukan kebutuhan skema sebagai isu, bukan migrasi tandingan |
| `packages/ui/` | **Dev B saja** | Dev A memakai apa adanya; kalau kurang, minta |
| `packages/contracts/` | Dev B menulis, Dev A memakai | Perubahan breaking = PR terpisah |
| `apps/api/src/modules/learning/attempts.service.ts` | **Dev A saja** | Satu transaksi, satu pemilik |
| `db/migrations/001_init.sql` | **tidak ada pemilik** | Sudah diterapkan. Forward-only: koreksi = migrasi baru, bukan edit |
| `apps/api/src/infra/kysely/database.d.ts` | **hasil generate** | Jangan diedit tangan. `pnpm db:types`, lalu commit |
| `scripts/` | Dev A | Perkakas lintas-OS. Dev B memakai; kalau kurang, minta |

---

## Perintah

```bash
pnpm i                    # pasang seluruh workspace
docker compose up -d      # PostgreSQL, Redis, MinIO (port 55432/56379/59000)
cp .env.example .env      # opsional: stack jalan tanpa .env, semua punya default

pnpm db:migrate           # forward-only, satu transaksi per file, checksum diperiksa
pnpm db:types             # generate tipe Kysely DARI SKEMA SUNGGUHAN, lalu prettier
pnpm seed                 # BELUM ADA — masih mencetak pesan
pnpm seed:content <file>  # BELUM ADA — item F-11

pnpm dev                  # web + api + ai bersamaan
pnpm dev:web              # hanya Next.js
pnpm dev:api              # hanya NestJS (MODE=api)
pnpm dev:worker           # NestJS mode worker
pnpm dev:ai               # FastAPI

pnpm lint                 # ESLint seluruh workspace
pnpm typecheck            # tsc --noEmit seluruh workspace
pnpm test                 # Vitest unit + integrasi
pnpm test:e2e             # BELUM ADA — item R-01
pnpm build                # workspace TypeScript. services/ai lewat pytest

cd services/ai && ./.venv/bin/python -m pytest        # macOS / Linux
cd services/ai && ./.venv/Scripts/python -m pytest    # Windows
```

Sebelum membuka PR: `pnpm lint && pnpm typecheck && pnpm test && pnpm build` harus hijau.

**Port bisa ditimpa** lewat `.env`: `WEB_PORT`, `API_PORT`, `AI_SERVICE_PORT`.
Port PostgreSQL/Redis/MinIO sengaja digeser dan **terikat ke `127.0.0.1`** — repo ini
publik dan password dev-nya ada di dalamnya.

---

## Stack & versi

| Lapisan | Teknologi |
|---|---|
| Frontend | Next.js 15 (App Router), React, TypeScript strict |
| Styling | Tailwind 3.4, Shadcn/UI, Framer Motion |
| Backend | Node 22, NestJS 10, TypeScript strict |
| Query | **Kysely** (bukan ORM penuh) |
| AI | Python 3.12, FastAPI, Pydantic v2 |
| DB | PostgreSQL 16 |
| Cache/queue | Redis 7, BullMQ |
| Auth | **Better-Auth** — jangan tulis logika auth sendiri |
| Payment | **Midtrans Snap hosted** — jangan buat halaman checkout sendiri |
| Admin | **Retool** — jangan buat UI admin React sendiri |
| Email | Resend |
| Test | Vitest, Playwright, pytest |

### Yang dibeli, bukan dibangun

Kalau muncul dorongan membangun salah satu ini dari nol, **berhenti** — sudah diputuskan untuk dibeli, dan penghematannya sudah masuk jadwal:

- Auth → Better-Auth
- Halaman checkout → Midtrans Snap hosted
- Panel admin → Retool di atas view SQL read-only
- Komponen UI dasar → Shadcn blocks apa adanya
- Pengiriman email → Resend

---

## Pola wajib

### Transaksi penyelesaian micro-task

Satu transaksi menulis **enam** hal. Jangan pernah memecahnya.

```ts
await db.transaction().execute(async (trx) => {
  const attemptDate = await localDate(trx, userId);      // tanggal LOKAL pengguna
  const attempt = await insertAttempt(trx, { ..., attemptDate });
  const streak  = await streaks.recordActivity(trx, userId);
  const wallet  = await coins.write(trx, { entryType: 'earn_lesson', ... });
  const quest   = await bumpDailyQuest(trx, userId);
  await bumpSquadPoints(trx, userId, points);
  await trx.insertInto('outbox_events').values({ topic: 'points.awarded', ... }).execute();
});
// queue.add() DI SINI, setelah commit — tidak pernah di dalam transaksi
```

### Menulis koin

```ts
// SELALU begini
await coins.write(trx, {
  userId, entryType: 'spend_scan', amount: -2400,
  refType: 'scan', refId: scan.id, idempotencyKey,
});

// JANGAN PERNAH begini
await trx.updateTable('users').set({ coin_balance: newBalance })...
await trx.insertInto('coin_ledger').values(...)...
```

### Hold → settle | release

```ts
const hold = await coins.hold(trx, { userId, amount: 2400, refType: 'scan', refId });
// ... pekerjaan berjalan ...
await coins.settle(trx, { userId, refType: 'scan', refId });   // berhasil
await coins.release(trx, { userId, refType: 'scan', refId, reason }); // gagal
// Reaper melepas hold menggantung > 30 menit
```

### Outbox, bukan penulisan langsung

```ts
// DI DALAM transaksi
await trx.insertInto('outbox_events').values({ topic: 'points.awarded', payload }).execute();

// Worker terpisah, SETELAH commit
await redis.zincrby(key, points, userId);
rt.toSquad(squadId, 'score.updated', payload);
```

### Idempotensi

Setiap `POST` yang mengubah saldo atau memberi hadiah wajib `Idempotency-Key`. Dua lapis perlindungan:

1. `coin_ledger.idempotency_key UNIQUE`
2. Partial unique index `(ref_type, ref_id, entry_type)`

### Serializer membuang kunci jawaban

```ts
// lesson_cards.content memuat { options: [{ id, text, correct, why }] }
// Serializer WAJIB membuang `correct` dan `why` sebelum respons.
// Diuji dengan snapshot test atas respons mentah.
```

### Guard vs kepemilikan

```ts
@Roles('mentor')            // guard: "peran ini boleh masuk rute ini?"
async getSquad(@Param('id') id: string, @User() actor) {
  const squad = await this.squads.byId(id);
  owns.mentorOfSquad(actor, squad.mentor_id);   // service: "ini milik siapa?"
}
```

Guard **tidak** menjawab kepemilikan. Superadmin **tidak** otomatis lolos rute student.

---

## Konvensi kode

### Umum

- TypeScript `strict: true`. Tidak ada `any` tanpa komentar yang menjelaskan kenapa.
- Tidak ada `console.log` di kode produksi — pakai logger terstruktur.
- Komentar menjelaskan **kenapa**, bukan **apa**. Kode yang butuh komentar "apa" biasanya perlu nama yang lebih baik.
- Nama dalam bahasa Inggris; komentar boleh bahasa Indonesia.
- Uang dan koin selalu **integer**, tidak pernah float.

### Penamaan

| Hal | Gaya | Contoh |
|---|---|---|
| Tabel & kolom | `snake_case` | `lesson_attempts`, `attempt_date` |
| Tipe TS & class | `PascalCase` | `CoinLedgerService`, `StructuredCV` |
| Fungsi & variabel | `camelCase` | `recordActivity`, `attemptDate` |
| Konstanta | `SCREAMING_SNAKE` | `MILESTONES`, `PROMPT_VERSION` |
| File TS | `kebab-case.role.ts` | `coin-ledger.service.ts` |
| File Python | `snake_case.py` | `ats_score.py` |
| Kode error API | `SCREAMING_SNAKE` | `INSUFFICIENT_COINS` |

### Error

```ts
// Kode error adalah KONTRAK. Pesan bukan.
throw new BadRequestException({
  code: 'INSUFFICIENT_COINS',
  message: 'Saldo koin tidak cukup',
  details: { balance: 1000, required: 2400 },
});
```

Jangan pernah parsing `message` di client. Selalu cabang pada `code`.

### Migrasi

- SQL murni, berurut, **forward-only**
- Aman dijalankan saat versi lama masih berjalan (expand/contract)
- **Tidak ada `DROP COLUMN`** dalam deploy yang sama dengan kode yang berhenti memakainya

### Test

- Setiap formula punya unit test
- Setiap jalur uang punya test integrasi dengan database nyata
- Perhitungan streak diuji di **tiga zona waktu** dan lintas tengah malam
- Matriks akses RBAC diuji untuk setiap peran salah di setiap rute

---

## Definition of Done

Item belum selesai sampai **semua** baris ini benar:

- [ ] Ter-merge ke `main` dan ter-deploy ke staging
- [ ] Di-review orang satunya — setiap PR punya reviewer, tanpa pengecualian
- [ ] Acceptance criteria di `docs/BACKLOG.md` **terbukti**, bukan diasumsikan
- [ ] Ada test untuk jalur yang bisa gagal: uang, idempotensi, otorisasi, batas tanggal
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` hijau
- [ ] Tidak menambah peringatan TypeScript atau lint baru
- [ ] Kalau menyentuh uang atau skema: ada catatan di PR tentang apa yang bisa rusak

---

## Git

```
Branch:  <id-lowercase>-<slug>        c-01-coin-ledger-service
Commit:  <ID>: <perubahan>            C-01: tambah trigger immutable pada coin_ledger
PR:      <ID> — <judul item>          C-01 — CoinLedgerService: write, hold, settle, release
```

Deskripsi PR memuat acceptance criteria sebagai checklist, dan — kalau menyentuh uang atau skema — satu paragraf tentang apa yang bisa rusak.

---

## Kapan harus berhenti dan bertanya

Jangan menebak. Lima situasi ini wajib dikonfirmasi ke manusia:

1. **Perubahan menyentuh `coin_ledger`, `streaks`, atau transaksi `POST /attempts`** dengan cara yang tidak dijelaskan PRD
2. **Perlu menambah tabel atau kolom** yang tidak ada di `docs/PRD.md` §9
3. **Perlu memanggil vendor baru** yang tidak ada di `docs/PRD.md` §12
4. **Acceptance criteria di backlog terasa bertentangan** dengan PRD
5. **Muncul dorongan membangun sesuatu yang sudah diputuskan untuk dibeli** (auth, checkout, panel admin)

Kalau sebuah kebutuhan tidak tercakup PRD, **tulis pertanyaannya**, jangan diam-diam memutuskan sendiri.

---

## Yang sering salah di proyek ini

Daftar ini dikumpulkan dari analisis rancangan. Semuanya sudah pernah hampir terjadi.

| Jebakan | Akibat | Pencegahan |
|---|---|---|
| `completed_at::date` untuk streak | Streak pengguna WIB putus pukul 07.00 pagi | Selalu `AT TIME ZONE users.timezone` |
| Unique index harian di tabel terpartisi tanpa kolom partisi | Migrasi ditolak PostgreSQL | Kunci partisi = `attempt_date` (tanggal lokal) |
| `UPDATE users.coin_balance` langsung | Saldo menyimpang tanpa jejak | Selalu lewat `CoinLedgerService` |
| ZINCRBY di dalam transaksi | Poin dari transaksi yang di-rollback | Pakai outbox |
| `queue.add()` sebelum commit | Worker membaca baris yang belum ada | Enqueue setelah commit |
| PK `(squad_id, user_id)` di `squad_members` | Pengguna tidak bisa bergabung ulang | PK surrogate + partial unique index |
| Menambah koin dari redirect client | Koin gratis untuk siapa pun yang tahu URL-nya | Hanya dari webhook bertanda tangan |
| Skor ATS dari LLM | Skor berubah-ubah untuk dokumen yang sama | Penilaian deterministik, tanpa LLM |
| Superadmin lolos semua rute | Panel admin jadi lubang keamanan | Guard memeriksa peran yang tepat, bukan "minimal" |
| Reviewer bisa melihat penulis | Kolusi antar-teman | Identitas dibuang di serializer |

### Yang benar-benar terjadi, W1 2026

Delapan di bawah ini bukan analisis rancangan — semuanya **sudah terjadi di repo ini**
dan memakan waktu nyata. Jangan diulang.

| Jebakan | Akibat | Pencegahan |
|---|---|---|
| Sintaks shell POSIX di script `package.json` (`MODE=api ...`, `${PORT:-3000}`) | **Repo tidak bisa dipakai di Windows sama sekali** — ketiga layanan gagal. pnpm di Windows menjalankan script lewat `cmd.exe` | Pembungkus Node di `scripts/*.mjs`. Jangan pernah menaruh sintaks shell di `package.json` |
| Tidak ada `.gitattributes` | Script ter-checkout CRLF di Windows, gagal dengan pesan menyesatkan `\r: command not found` | `* text=auto eol=lf` |
| Vitest memakai transform esbuild | esbuild **tidak mengemisi `design:paramtypes`**, jadi modul yang kabel DI-nya salah tetap lulus test dan baru meledak saat dijalankan | `apps/api` memakai `unplugin-swc`. Jangan dikembalikan ke esbuild |
| `incremental: true` di `apps/api/tsconfig.json` | `tsc --noEmit` (typecheck) menulis `.tsbuildinfo`, lalu `nest build` melapor **sukses tanpa menghasilkan `dist/` apa pun** | Sengaja tidak dipakai. Build API < 2 detik |
| Menguji trigger `FOR EACH ROW` pada tabel **kosong** | `UPDATE` menyentuh nol baris, trigger tidak menyala, perintah keluar 0 — **test lulus karena salah** | Sisipkan baris sungguhan dulu, verifikasi jumlahnya, baru coba UPDATE/DELETE |
| `pull_request: branches: [main]` di CI | PR bertumpuk **tidak mendapat status check sama sekali** — bukan merah, tapi kosong, dan tetap terlihat bisa di-merge | `pull_request:` tanpa filter |
| Port compose ditulis `'55432:5432'` | Bind ke `0.0.0.0` — siapa pun satu Wi-Fi bisa menyambung ke DB dev, dan passwordnya ada di repo publik | Selalu `'127.0.0.1:55432:5432'` |
| Nilai contoh yang bisa dipakai di `.env.example` | `AUTH_SECRET` contoh lolos ambang 32 byte, jadi pengecekan panjang naif meloloskannya | Kunci dan token **dikosongkan**, bukan diisi contoh |

---

## Perkakas yang sudah berdiri

Jangan bangun ulang; baca dulu.

| Perkakas | Di mana | Aturan yang dijaganya |
|---|---|---|
| Runner migrasi | `scripts/db-migrate.mjs` | Forward-only, satu transaksi per file. **Checksum diperiksa** — mengubah migrasi yang sudah jalan ditolak |
| Codegen tipe | `scripts/db-types.mjs` | Tipe diturunkan dari skema sungguhan, lalu diformat prettier. **SQL sumber kebenaran, TypeScript turunannya** |
| Pembungkus dev | `scripts/dev-{web,api,ai}.mjs` | Lintas-OS, `spawn` tanpa `shell: true`, port divalidasi angka |

**Tiga hal yang mudah salah dipahami soal skema:**

1. **`public` memuat tepat 31 tabel domain.** Ledger migrasi tinggal di skema
   `strive_meta`, dan `pnpm db:types` mengecualikannya. CI menolak kalau jumlahnya bukan 31.
2. **`apps/api/src/infra/kysely/database.d.ts` ikut di-commit** dan **tidak boleh diedit tangan**.
   Job CI `node` tidak punya PostgreSQL, jadi typecheck butuh berkas itu ada di repo.
   CI menjalankan ulang codegen lalu `git diff --exit-code` — ubah skema tanpa
   `pnpm db:types` = PR merah.
3. **Partisi `lesson_attempts` habis 2027-03-01.** Insert di luar rentang **gagal**, bukan
   jatuh ke partisi default. Job bulanan pembuat partisi belum punya item di backlog.

**Satu penyimpangan dari PRD §9 yang menunggu keputusan manusia:** `peer_reviews` tidak
punya foreign key ke `lesson_attempts`. PostgreSQL mewajibkan FK menunjuk seluruh primary
key, dan PK-nya `(id, attempt_date)` karena terpartisi. Menambah kolom `attempt_date`
berarti menambah kolom di luar PRD §9. Integritasnya ditegakkan di service sampai
diputuskan.
