-- 010_idempotensi_per_pengguna.sql
--
-- Dua index idempotensi `coin_ledger` jadi PER PENGGUNA — isu #200,
-- keputusan Dev A 5 Okt.
--
-- ── Lapis 1: `idempotency_key` ──────────────────────────────────────────────
--
-- Kuncinya DIKIRIM KLIEN, tapi ruang namanya satu untuk seluruh sistem. Di
-- setiap API HTTP, `Idempotency-Key` adalah ruang nama PER PEMANGGIL; yang
-- global justru anomali.
--
-- Isu #143 menutup kebocorannya di sisi kode (`findExisting` memeriksa
-- kepemilikan), tapi tidak menutup ini: dua pengguna tetap tidak boleh memakai
-- kunci yang sama, tanpa satu pun alasan bisnis. Akibat praktisnya satu klien
-- yang mengirim kunci konstan membuat pengguna PERTAMA menang dan semua
-- sesudahnya ditolak.
--
-- ── Lapis 2: `coin_ledger_ref_uniq`, dan ini yang punya tenggat ─────────────
--
-- `(ref_type, ref_id, entry_type)` tanpa `user_id`. Untuk `attempt`, `scan`,
-- dan `order` itu tidak berakibat apa pun — `ref_id` entitas milik satu orang.
--
-- `earn_review` memecahkannya. `PR-01` mengalokasikan DUA reviewer lintas squad
-- per attempt. Begitu imbalan review ditulis dengan `refType: 'attempt'`,
-- `refId: <attempt>`, `entryType: 'earn_review'`:
--
--   reviewer pertama  -> entri ditulis
--   reviewer kedua    -> DITOLAK index, ketiga kolomnya identik
--
-- Dan bentuk kegagalannya yang terburuk: `findExisting` lewat `byRef` akan
-- memulangkan entri reviewer pertama, jadi reviewer kedua diberi tahu ia
-- dibayar, nol baris ditulis, saldonya tidak bergerak.
--
-- Biaya memutuskannya SEKARANG nol: `earn_review` ada di enum `coin_entry` dan
-- nol kode menulisnya (`review.service.ts` memberi POIN, bukan koin). Setelah
-- `PR-02` membayar koin, ini jadi migrasi atas tabel append-only berisi uang.
--
-- ── Arahnya aman untuk deploy bergulir ─────────────────────────────────────
--
-- Kedua index baru LEBIH PERMISIF daripada yang digantikannya. Jadi versi lama
-- yang masih berjalan tidak bisa gagal karenanya — yang bisa gagal adalah
-- sebaliknya, dan itu tidak terjadi di sini. Nol `DROP COLUMN`, nol backfill.
--
-- Satu hal yang HILANG dan memang dimaksudkan: `IdempotencyKeyTakenError`
-- (dibuat #143) tidak punya keadaan yang memicunya lagi — kunci orang lain
-- sekarang sekadar kunci yang berbeda. Dibuang di PR yang sama.

-- Lapis 1. `UNIQUE` tingkat kolom di migrasi 001 menghasilkan CONSTRAINT,
-- bukan index lepas, jadi ia dibuang sebagai constraint.
ALTER TABLE coin_ledger DROP CONSTRAINT coin_ledger_idempotency_key_key;

-- `WHERE idempotency_key IS NOT NULL`: kolomnya nullable, dan entri tanpa
-- kunci (mis. `adjust` dari Retool) tidak boleh saling bertabrakan lewat NULL.
-- Postgres memperlakukan NULL sebagai berbeda di unique index, jadi partial
-- index ini sebenarnya setara — ditulis eksplisit supaya niatnya terbaca.
CREATE UNIQUE INDEX coin_ledger_user_idem_uniq
  ON coin_ledger (user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Lapis 2.
DROP INDEX coin_ledger_ref_uniq;

CREATE UNIQUE INDEX coin_ledger_ref_uniq
  ON coin_ledger (user_id, ref_type, ref_id, entry_type)
  WHERE ref_id IS NOT NULL;

COMMENT ON INDEX coin_ledger_user_idem_uniq IS
  'Idempotensi lapis 1, PER PENGGUNA sejak 010 (isu #200). Sebelumnya UNIQUE global atas idempotency_key, padahal kuncinya dikirim klien.';

COMMENT ON INDEX coin_ledger_ref_uniq IS
  'Idempotensi lapis 2, PER PENGGUNA sejak 010 (isu #200). Tanpa user_id, dua reviewer per attempt (PR-01) menabrak index ini dan yang kedua tidak dibayar dalam diam.';
