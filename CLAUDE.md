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
│        ├─ common/            guards (SessionGuard · RolesGuard · ACCESS_MATRIX),
│        │                     interceptor idempotency, filter, zod pipe
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
│  │                           001 = 31 tabel · 002 = trigger kapasitas squad
│  │                           003 = peer_reviews FK · 004 = Better-Auth (33)
│  │                           005 = trigger AU-6
│  │                           006 = view admin_* + role strive_readonly
│  │                           007 = contract auth (buang password_hash,
│  │                                 email_verified_at, refresh_tokens)
│  │                           008 = squads.season_id NOT NULL
│  └─ seeds/                   seed-dev.mjs (F-13) · seed-content.mjs (F-11)
│                              + content/ contoh
├─ scripts/                    perkakas lintas-OS, Node murni, nol dependensi
│                              dev-web · dev-api · dev-ai · db-migrate · db-types
│                              resolve-bin · not-implemented (placeholder exit 0)
│                              load-test (R-02, open-loop — lihat docs/reports/R-02)
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
pnpm seed                 # data dev: harga, 1 track lengkap, 8 item store. Idempoten
pnpm seed:content <file>  # ADA (F-11, #41). Impor kartu dari CSV/JSON, idempoten

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

> **`pnpm seed` dan `pnpm seed:content` adalah dua hal yang BERBEDA — jangan tertukar.**
> `pnpm seed` (`F-13`) membuat data dev supaya stack bisa dipakai: satu `pricing_config`
> aktif dengan angka `docs/PRD.md` §6 yang TERKUNCI, satu track lengkap sampai kartu, dan
> 8 `store_items`. `pnpm seed:content <file>` (`F-11`) mengimpor konten belajar dari
> CSV/JSON. Keduanya idempoten dan **tidak pernah UPDATE atau DELETE** — hanya
> `INSERT … ON CONFLICT DO NOTHING`, yang membuat "data pengguna tidak pernah ditimpa"
> benar secara konstruksi, bukan karena hati-hati.
>
> Pengguna jangkar yang dibuat `pnpm seed` **tidak bisa login** dan itu disengaja: repo ini
> publik. Untuk superadmin yang bisa dipakai, daftar lewat aplikasi lalu
> `UPDATE users SET role='superadmin' WHERE email='…'`.

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

> **DILONGGARKAN SEMENTARA — 2026-09-15.** Baris "ter-deploy ke staging" **dinonaktifkan**
> atas keputusan Dev A (isu #29). `F-05` ditunda sampai Dev A mengumumkan staging siap;
> sampai saat itu, tidak ada staging untuk di-deploy, dan DoD yang mensyaratkannya membuat
> **nol item bisa `done`** — termasuk item yang sudah ter-merge dan ter-review.
>
> **Saat Dev A bilang "staging ready": kembalikan baris pertama menjadi**
> `Ter-merge ke `main` **dan ter-deploy ke staging**`, hapus blok catatan ini, lalu
> periksa ulang item yang sudah `done` — sebagian mungkin belum pernah menyentuh staging.

- [ ] Ter-merge ke `main` ~~dan ter-deploy ke staging~~ *(staging ditunda — lihat catatan di atas)*
- [ ] **PR dari Dev B** di-review Dev A. **PR dari Dev A tidak butuh reviewer** — Dev A pemilik kode dan pemutus (keputusan Dev A, 2026-09-16, isu #34)
- [ ] Acceptance criteria di `docs/BACKLOG.md` **terbukti**, bukan diasumsikan
- [ ] Ada test untuk jalur yang bisa gagal: uang, idempotensi, otorisasi, batas tanggal
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` hijau
- [ ] Tidak menambah peringatan TypeScript atau lint baru
- [ ] Kalau menyentuh uang atau skema: ada catatan di PR tentang apa yang bisa rusak

> **Kenapa reviewnya satu arah, dan apa yang hilang karenanya.**
>
> Proyek ini dua orang. Aturan "setiap PR punya reviewer" berarti satu orang yang tidak
> sempat review menghentikan seluruh pekerjaan berikutnya — bukan memperlambat,
> **menghentikan**: delapan PR menumpuk dan nomor migrasi mengunci setiap item skema
> di belakangnya. Dev A memutuskan arus lebih penting daripada simetri.
>
> **Yang hilang nyata:** PR Dev A tidak lagi punya mata kedua, termasuk yang menyentuh
> `coin_ledger` dan migrasi. Gantinya cuma tiga: CI yang menolak lebih dulu, test
> integrasi terhadap database sungguhan, dan kebiasaan membaca ulang PR sendiri secara
> bermusuhan sebelum merge. Ketiganya lebih lemah daripada manusia kedua. Itu harga
> yang sudah diketahui, bukan yang terlewat.
>
> **PR bertumpuk tidak perlu approval berlapis.** Approval di puncak stack berlaku untuk
> seluruh isinya; jangan mengulang approval tiap lapis dibongkar.

### Branch protection `main` — keadaan sebenarnya

Setelan ini **tidak terlihat dari isi repo**, jadi ditulis di sini. Terakhir diubah 2026-09-16.

| Setelan | Nilai | Artinya |
|---|---|---|
| Approval dibutuhkan | **1** | Hanya menggigit PR Dev B — Dev A admin dan `enforce_admins: false` |
| `enforce_admins` | **false** | Dev A bisa merge tanpa approval. Itu yang membuat aturan keras 13 mungkin |
| `dismiss_stale_reviews` | **false** | Diubah dari `true`. Approval **tidak lagi gugur** saat ada push baru |
| `strict` status checks | **true** | Branch wajib mutakhir terhadap `main` sebelum merge |
| Status check wajib | **3** | `lint · typecheck · test · build` · `ai service · test` · `migrasi kering` |
| Force push & penghapusan `main` | **dilarang** | — |
| `required_conversation_resolution` | **true** | Komentar review wajib diselesaikan |

**Kenapa `dismiss_stale_reviews` dimatikan, dan apa yang hilang karenanya.**

Dengan `true`, approval gugur setiap kali ada commit baru — termasuk ketika yang mendorong
adalah **reviewer-nya sendiri** dan yang didorong **bukan kode**. Itu benar-benar terjadi:
rekonsiliasi papan di PR #36 hanya menyentuh `docs/BACKLOG.md`, dan approval-nya tetap gugur.

**Yang hilang nyata:** approval sekarang **bertahan melewati perubahan kode**. Seseorang
bisa mendapat approval, lalu mendorong kode yang sama sekali berbeda, dan approval lama
tetap berlaku. Di repo dua orang dengan satu arah review, itu berarti **PR Dev B bisa
berubah isi setelah disetujui**.

Yang menahannya tinggal dua: `strict` status checks (CI wajib hijau pada commit terakhir)
dan kebiasaan melihat ulang diff sebelum merge. **Periksa `git log` PR Dev B sejak approval
sebelum me-merge-nya** — tidak ada lagi yang melakukannya untukmu.

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

Yang di bawah ini bukan analisis rancangan — semuanya **sudah terjadi di repo ini** dan
memakan waktu nyata. Jangan diulang.

> Daftarnya bertambah, jadi **jangan menulis jumlahnya di sini** — angka yang ditulis tangan
> akan meleset diam-diam, dan daftar jebakan yang isinya sendiri sudah salah adalah lelucon
> yang buruk.

| Jebakan | Akibat | Pencegahan |
|---|---|---|
| Sintaks shell POSIX di script `package.json` (`MODE=api ...`, `${PORT:-3000}`) | **Repo tidak bisa dipakai di Windows sama sekali** — ketiga layanan gagal. pnpm di Windows menjalankan script lewat `cmd.exe` | Pembungkus Node di `scripts/*.mjs`. Jangan pernah menaruh sintaks shell di `package.json` |
| Tidak ada `.gitattributes` | Script ter-checkout CRLF di Windows, gagal dengan pesan menyesatkan `\r: command not found` | `* text=auto eol=lf` |
| Vitest memakai transform esbuild | esbuild **tidak mengemisi `design:paramtypes`**, jadi modul yang kabel DI-nya salah tetap lulus test dan baru meledak saat dijalankan | `apps/api` memakai `unplugin-swc`. Jangan dikembalikan ke esbuild |
| `incremental: true` di `apps/api/tsconfig.json` | `tsc --noEmit` (typecheck) menulis `.tsbuildinfo`, lalu `nest build` melapor **sukses tanpa menghasilkan `dist/` apa pun** | Sengaja tidak dipakai. Build API < 2 detik |
| Menguji trigger `FOR EACH ROW` pada tabel **kosong** | `UPDATE` menyentuh nol baris, trigger tidak menyala, perintah keluar 0 — **test lulus karena salah** | Sisipkan baris sungguhan dulu, verifikasi jumlahnya, baru coba UPDATE/DELETE |
| `pull_request: branches: [main]` di CI | PR bertumpuk **tidak mendapat status check sama sekali** — bukan merah, tapi kosong, dan tetap terlihat bisa di-merge | `pull_request:` tanpa filter |
| Port compose ditulis `'55432:5432'` | Bind ke `0.0.0.0` — siapa pun satu Wi-Fi bisa menyambung ke DB dev, dan passwordnya ada di repo publik | Selalu `'127.0.0.1:55432:5432'` |
| `date - $1` di SQL dengan parameter bind | PostgreSQL punya `date - int → date` DAN `date - date → int`; parameter tanpa tipe membuatnya memilih **yang kedua**, lalu menolak hasilnya dengan `column is of type date but expression is of type integer` | Selalu cast eksplisit: `- ${sql.lit(n)}::int` |
| `advanced.database.generateId: false` di Better-Auth | Terasa seperti "biar database yang bikin lewat DEFAULT gen_random_uuid()". Resolvernya mengembalikan `false`, tapi pemanggilnya menulis `generateId(...) \|\| generateId()` — jadi ia **jatuh kembali ke id base62 32 karakter** tanpa error, dan itu tidak muat di kolom `uuid` | Hanya `'uuid'` yang benar-benar memanggil `crypto.randomUUID()` |
| Mengandaikan Better-Auth memakai Argon2id | Bawaannya **scrypt**. AU-3 mewajibkan Argon2id, dan yang membuktikannya bentuk hash tersimpan, bukan konfigurasinya | `emailAndPassword.password.hash/verify` ditimpa `@node-rs/argon2`. Diuji dengan mencocokkan `^\$argon2id\$` di kolomnya |
| Mengandalkan hook `after` Better-Auth untuk AU-6 | Hook berjalan SETELAH transaksinya commit, jadi tidak bisa memenuhi "dalam transaksi yang sama". Registrasi berhasil, `streaks` nol baris | Trigger `users_registration_rows` (migrasi 005). Berlaku untuk siapa pun yang meng-INSERT, bukan cuma satu jalur kode |
| Kolom `inet` untuk alamat dari header request | `X-Forwarded-For` boleh berisi rantai: `'1.2.3.4, 5.6.7.8'::inet` ditolak. Pengguna di belakang proxy berantai **gagal login**, dan pesannya menunjuk ke tipe kolom | `sessions.ip` dilebarkan ke `text` (004). `audit_log.ip` tetap `inet`, jadi alamat dari request masuk ke `after` jsonb |
| Berkas test integrasi yang mengandaikan database kosong | `formSquads` memang membaca SELURUH pengguna aktif tanpa squad — itu perilakunya sebagai job mingguan. Sisa pengguna dari tiga berkas test lain ikut terbentuk jadi squad, dan hitungannya meleset tepat +9 | Berkas yang menguji operasi berlingkup-global **wajib** `TRUNCATE` di `beforeEach`. Aman karena `fileParallelism: false` |
| Menembak N operasi sekaligus lalu menyebutnya "test konkurensi" | Tiap koneksi baru berdiri pada waktu berbeda, jadi transaksinya praktis **berurutan** — test AC-2 squad lulus bahkan setelah `SELECT … FOR UPDATE` dicabut dari service | Paksa tumpang tindihnya: transaksi lain menahan kunci barisnya, para penantang menumpuk, baru dilepas bersamaan. Lalu **cabut penjaganya dan pastikan test merah** |
| Nilai contoh yang bisa dipakai di `.env.example` | `AUTH_SECRET` contoh lolos ambang 32 byte, jadi pengecekan panjang naif meloloskannya | Kunci dan token **dikosongkan**, bukan diisi contoh |
| `apps/api` mengimpor NILAI (bukan `import type`) dari `packages/contracts` | `packages/contracts` mengirim `.ts` mentah sebagai `main`/`exports` — `nest build` **sukses**, tapi `node dist/main.js` (produksi sungguhan, perintah yang sama di `infra/Dockerfile.api`) **crash saat boot** dengan `ERR_UNSUPPORTED_DIR_IMPORT`, karena Node tidak bisa mem-parsing `.ts` mentah. Pola "build hijau tapi rusak" yang sama seperti `tsc --incremental` di atas. Baru ketahuan begitu ada modul yang mengimpor skema zod sebagai nilai (mis. untuk `.safeParse()`) — sebelumnya seluruh impor dari paket itu ke `apps/api` kebetulan `import type`, jadi terhapus total saat kompilasi dan lubangnya tidak pernah tersentuh | Sampai `packages/contracts` benar-benar dikompilasi ke JS (bukan `tsc --noEmit`) atau `apps/api` pindah ke builder webpack Nest yang tidak meng-eksternalisasi dependency workspace — keduanya perubahan config bersama, belum diputuskan tim — `apps/api` HANYA boleh `import type` dari `@strive/contracts`, tidak pernah nilai (skema, konstanta, fungsi) |
| `@Global()` dikira "terdaftar otomatis" | Ia berarti **"sekali diimpor, terlihat di mana-mana"** — bukan terdaftar sendiri. `AppModule` mengimpor `KyselyModule`, jadi `MODE=api` sehat; `WorkerModule` tidak, dan **`MODE=worker` gagal boot TOTAL** dengan `Nest can't resolve dependencies of the WalletService (?)`. Pipeline penuh tetap hijau berminggu-minggu: `app.module.spec.ts` menguji AppModule, dan tidak ada apa pun yang pernah membangun `WorkerModule` — separuh deployment (PRD §8.1 "satu image, dua peran") tidak pernah diperiksa. Pola "build hijau tapi rusak saat dijalankan" yang KETIGA di repo ini | Setiap modul akar yang bisa di-boot sendiri WAJIB punya test yang membangunnya dan MENGAMBIL satu provider — `app.module.spec.ts` dan `worker.module.spec.ts`. Mengambil provider, bukan cuma `compile()`: kompilasi bisa lolos sementara resolusi baru gagal saat provider dipakai (isu #86) |
| Memakai `Intl.supportedValuesOf('timeZone')` sebagai daftar izin zona waktu apa adanya | Daftar itu **TIDAK memuat `'UTC'`** — 418 nama kanonik, dan zona waktu paling umum di dunia bukan salah satunya. Validasi yang memakainya polos akan menolak `UTC` dengan pesan "zona waktu tidak dikenal", untuk nilai yang jelas-jelas dikenal PostgreSQL | Daftar izin = nama kanonik ICU **+ `'UTC'`**. Diverifikasi terhadap `pg_timezone_names` (599 nama) di PostgreSQL 16 repo ini: dari 419 nama itu, **nol** yang ditolak `AT TIME ZONE`. Lihat `apps/api/src/modules/auth/timezone.ts` |
| Mengandaikan token Better-Auth ada di query string | Tautan reset password berbentuk `/api/v1/auth/reset-password/<token>?callbackURL=…` — tokennya **segmen path**, `callbackURL` yang jadi query. Tautan di email juga menunjuk **API**, bukan web: ia mengalihkan ke `${APP_URL}/reset/finish?token=…`. Kode yang mencari `?token=` di tautan email mendapat `null`, dan gejalanya baru terlihat oleh pengguna sungguhan yang lupa password | Baca tokennya dari segmen path terakhir, atau ikuti alihannya dulu. Diuji end-to-end di `apps/api/test/auth-email-timezone.integration.spec.ts` |
| Mengandaikan `additionalFields` Better-Auth opsional untuk field yang sudah ada kolomnya | Better-Auth **membuang field yang tidak terdaftar** di `user.additionalFields` — diam-diam, tanpa error. `users.timezone` punya kolom, punya DEFAULT, dan punya trigger yang menyalinnya ke `streaks` — tapi selama field-nya tak terdaftar, SEMUA pendaftar jatuh ke default apa pun yang mereka kirim. Bukan validasi yang menolak: nilainya tidak pernah sampai | Setiap field registrasi di luar `email`/`password`/`name`/`image` WAJIB terdaftar di `additionalFields` dengan `input: true` |
| Membaca kolom yang ditandai USANG karena ia masih bisa di-`SELECT` | `A-05` (`GET /me`) membaca `users.email_verified_at`, kolom yang di-backfill **sekali** di migrasi 004 lalu tidak pernah ditulis siapa pun — Better-Auth menulis `email_verified`. Migrasi 004 bahkan menuliskannya harfiah (*"Sampai saat itu, YANG DIBACA HANYA `email_verified`"*), dan komentar kolomnya juga. Tidak satu pun terbaca, karena yang dibuka saat menulis query adalah **`\d users`** — dan `COMMENT` tidak muncul di sana. Akibatnya pengguna yang memverifikasi emailnya tetap terbaca BELUM terverifikasi selamanya, dan AU-8 memblokir top-upnya | Kolom usang yang masih bisa di-`SELECT` **akan** di-`SELECT`. Expand/contract bukan opsional: sisi contract-nya wajib punya item sejak sisi expand-nya di-merge. Diselesaikan migrasi 007 (isu #47) |
| `betterAuth({…}) as SomeType` | Objek literalnya menghasilkan tipe generik yang jauh lebih sempit daripada `Auth<BetterAuthOptions>`, jadi cast-nya berhenti bisa dikompilasi begitu ada opsi baru. Godaannya menambah `as unknown as` — yang menutup gejalanya **sekaligus mematikan pengecekan tipe atas seluruh objek konfigurasi**, termasuk salah ketik nama opsi yang lalu diabaikan diam-diam | Anotasi variabelnya `BetterAuthOptions` lalu `return betterAuth(opsi)` tanpa cast sama sekali. Dibuktikan menangkap salah ketik dengan `TS2353` |

---

## Perkakas yang sudah berdiri

Jangan bangun ulang; baca dulu.

| Perkakas | Di mana | Aturan yang dijaganya |
|---|---|---|
| Runner migrasi | `scripts/db-migrate.mjs` | Forward-only, satu transaksi per file. **Checksum diperiksa** — mengubah migrasi yang sudah jalan ditolak |
| Codegen tipe | `scripts/db-types.mjs` | Tipe diturunkan dari skema sungguhan, lalu diformat prettier. **SQL sumber kebenaran, TypeScript turunannya.** Satu cacat diketahui: kolom `date` — lihat poin 4 di bawah |
| Test integrasi | `pnpm --filter @strive/api test:integration` | Berjalan terhadap **PostgreSQL sungguhan** lewat `vitest.integration.config.mts`, `fileParallelism: false`. Dipanggil job CI `migrasi kering`, BUKAN job `node` — job itu tidak punya database |
| Pembungkus dev | `scripts/dev-{web,api,ai}.mjs` | Lintas-OS, `spawn` tanpa `shell: true`, port divalidasi angka |
| Impor konten | `db/seeds/seed-content.mjs` | `F-11`. Idempoten — batasnya saat lesson sudah dikerjakan orang ada di `db/seeds/README.md`, baca sebelum mengimpor ulang |
| Job partisi | `apps/api/src/workers/partition.service.ts` | `F-12`. Idempoten. Lihat poin 3 di bawah — job bulanan yang gagal saat dijalankan dua kali membuat orang ragu menjalankannya ulang setelah insiden |
| View admin + role read-only | `db/migrations/006_admin_views.sql` | `SA-01`. `admin_transactions` merangkai order→user→payment→ledger dalam satu baris; `admin_audit` membawa email pelaku. Role `strive_readonly` **tidak bisa menulis apa pun** dan **tidak bisa membaca tabel mentah** |

**Empat hal yang mudah salah dipahami soal skema:**

1. **`public` memuat tepat 32 tabel domain.** Ledger migrasi tinggal di skema
   `strive_meta`, dan `pnpm db:types` mengecualikannya. CI menolak kalau jumlahnya bukan 32.
   **33 → 32 sejak migrasi 007** membuang `refresh_tokens` (isu #47). Angka ini ditulis
   tangan di TIGA tempat — `.github/workflows/ci.yml`, `admin-views.integration.spec.ts`,
   dan baris ini. Mengubah satu tanpa dua lainnya akan menyimpang diam-diam.
2. **`apps/api/src/infra/kysely/database.d.ts` ikut di-commit** dan **tidak boleh diedit tangan**.
   Job CI `node` tidak punya PostgreSQL, jadi typecheck butuh berkas itu ada di repo.
   CI menjalankan ulang codegen lalu `git diff --exit-code` — ubah skema tanpa
   `pnpm db:types` = PR merah.
3. **Partisi `lesson_attempts` habis 2027-03-01.** Insert di luar rentang **gagal**, bukan
   jatuh ke partisi default. Job bulanan pembuatnya **sudah ada**: `PartitionService`
   (`apps/api/src/workers/partition.service.ts`, `F-12` lewat #62). Ia menjamin bulan
   berjalan + `MONTHS_AHEAD` bulan ke depan dan menyalakan alarm di bawah `WARN_DAYS`.
   Dua hal yang jangan diubah tanpa membaca kodenya: batas bulan dihitung **Postgres**
   (`date_trunc`), karena aritmetika bulan JavaScript salah di akhir bulan; dan batas
   partisi dibaca dari **ekspresi partisinya** (`pg_get_expr(relpartbound)`), bukan ditebak
   dari namanya — partisi yang namanya benar tapi batasnya salah tetap menolak insert.
   Diverifikasi bahwa FK baru di `peer_reviews` **tidak** menghalangi `CREATE TABLE … PARTITION OF`
   maupun `DETACH PARTITION`.
4. **Kolom `date` bertipe `string`, bukan `Date`** — dan itu memang disengaja.
   `database.ts` memasang `setTypeParser(1082)` supaya tanggal kalender tidak berubah
   jadi `Date` pada tengah malam zona waktu proses Node, dan `scripts/db-types.mjs`
   meneruskan `--date-parser string` supaya tipenya ikut tahu (keduanya dari `S-01`).
   Kalau salah satu dilepas, yang lain jadi berbohong: tipe bilang `Date`, runtime
   memberi `'YYYY-MM-DD'`, dan `attempt_date.getFullYear()` lolos `tsc` lalu meledak
   saat dijalankan. **Jangan cabut salah satunya sendirian.**

**Retool membaca lewat role, bukan lewat kepercayaan.** Dua hal yang mudah salah soal
migrasi 006:

- **View bukan tabel.** Assert CI "tepat 33 tabel" menghitung `BASE TABLE` saja, jadi
  menambah view tidak membuatnya merah. Menambah **tabel** tetap merah — itu memang
  pembedaan yang diinginkan.
- **View yang dibuat SETELAH migrasi 006 tidak otomatis terbaca Retool.** Ada
  `ALTER DEFAULT PRIVILEGES … REVOKE ALL ON TABLES FROM strive_readonly`, jadi setiap
  view baru butuh `GRANT SELECT` eksplisit. Itu disengaja: menambah view ke Retool
  adalah tindakan yang pantas terasa. Kalau Retool tiba-tiba "tidak melihat" view baru,
  ini sebabnya — bukan bug koneksi.

**Dua batas yang ditegakkan di tingkat berbeda — jangan disamakan.**

| Batas | Ditegakkan oleh | Artinya |
|---|---|---|
| Satu squad aktif per pengguna | Partial unique index `squad_members_one_active` | Aman dari **jalur mana pun** — Retool, psql manual, skrip perbaikan data |
| Setiap squad punya musim | `squads.season_id NOT NULL` (migrasi 008) | Aman dari jalur mana pun **sejak isu #84**. Sebelumnya hanya dijaga `Q-01` (`formSquads`), dan `Q-06` menahan gejalanya dengan galat eksplisit |
| Anggota squad <= `max_members` | Trigger `squad_members_capacity` (migrasi 002) | Aman dari jalur mana pun **sejak isu #26**. Sebelumnya hanya dijaga `SquadService.join()` |

`squads_max_members_range` **tidak** menjaga apa yang namanya janjikan: ia membatasi
**nilai kolom** `max_members` ke 8–12, bukan jumlah anggota sungguhan. PostgreSQL tidak
bisa menyatakan "jumlah baris terkait <= nilai kolom" sebagai CHECK. Constraint itu
dipertahankan karena tetap berguna untuk apa yang memang dijaganya — bukan karena ia
menjaga kapasitas.

**`peer_reviews` sekarang punya FK ke `lesson_attempts`** — `(attempt_id, attempt_date)`,
`ON DELETE CASCADE` (isu #15, migrasi 003). FK pada `attempt_id` saja mustahil: PK-nya
`(id, attempt_date)` karena terpartisi, dan PostgreSQL mewajibkan FK menunjuk seluruh PK.

`attempt_date` **WAJIB diambil dari baris `lesson_attempts` itu sendiri**, tidak pernah
dibentuk di Node — itu tanggal LOKAL pengguna (aturan 5), dan `Date` milik proses Node
akan meleset satu hari untuk sebagian pengguna. FK-nya akan menolak dengan pesan yang
tidak menunjuk ke penyebab sebenarnya.
