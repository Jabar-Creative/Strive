# db/migrations

Tiga migrasi, forward-only:

| Berkas                            | Isi                                                                     |
| --------------------------------- | ----------------------------------------------------------------------- |
| `001_init.sql`                    | 31 tabel domain (`F-04`)                                                |
| `002_squad_capacity_trigger.sql`  | Kapasitas squad ditegakkan database, bukan cuma service (isu #26)       |
| `003_peer_reviews_attempt_fk.sql` | `peer_reviews.attempt_date` + FK majemuk ke `lesson_attempts` (isu #15) |

## Kepemilikan

**Hanya Dev A yang menulis file di folder ini.**

Kalau Dev B butuh perubahan skema, **buka isu** dengan template
`.github/ISSUE_TEMPLATE/schema-change.md` — bukan migrasi tandingan. Dua orang
menulis migrasi paralel adalah konflik yang baru ketahuan saat deploy
(`docs/DELIVERY-PLAN.md` §4).

## Aturan

| Aturan                                                                                  | Kenapa                                                         |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| **SQL murni**                                                                           | Bukan DSL migrasi. Yang dibaca saat insiden adalah SQL-nya.    |
| **Berurut**                                                                             | `001_init.sql`, `002_….sql`. Nomor tidak pernah dipakai ulang. |
| **Forward-only**                                                                        | Tidak ada `down`. Koreksi ditulis sebagai migrasi baru.        |
| **Expand/contract**                                                                     | Aman dijalankan saat versi lama masih berjalan.                |
| **Tidak ada `DROP COLUMN`** dalam deploy yang sama dengan kode yang berhenti memakainya | Pisahkan ke deploy berikutnya — `docs/PRD.md` §19.4.           |

## `001_init.sql` — item `F-04`

**1,5 hari · Dev A · W1 · Butuh `F-02`**

Selesai berarti: **31 tabel** berdiri (`docs/PRD.md` §9), `pnpm db:types`
menghasilkan tipe Kysely yang dipakai API, dan **trigger immutable
`coin_ledger` aktif dan terbukti menolak `UPDATE`**.

Tiga hal yang paling mudah salah di migrasi pertama:

1. **Trigger append-only `coin_ledger`.** `BEFORE UPDATE OR DELETE` yang
   `RAISE EXCEPTION`. Tanpa ini tidak ada jejak audit.
2. **Kunci partisi `lesson_attempts` = `attempt_date` (tanggal LOKAL).**
   PostgreSQL mewajibkan unique index di tabel terpartisi memuat seluruh kolom
   partisi; index harian kita butuh tanggal lokal. Dipartisi per UTC, satu hari
   lokal bisa terbelah ke dua partisi.
3. **PK surrogate di `squad_members`** + partial unique index
   `(user_id) WHERE left_at IS NULL` — bukan PK `(squad_id, user_id)`, agar
   pengguna yang keluar bisa bergabung lagi.

Jangan menambah tabel atau kolom yang tidak ada di `docs/PRD.md` §9 —
berhenti dan tanya (`AGENTS.md` aturan keras 4).
