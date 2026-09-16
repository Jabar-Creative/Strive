-- 003_peer_reviews_attempt_fk.sql
--
-- Isu #15: `peer_reviews` mendapat foreign key ke `lesson_attempts`.
--
-- Kenapa FK-nya tidak ada sejak 001_init.sql: `lesson_attempts` terpartisi,
-- jadi primary key-nya `(id, attempt_date)`. PostgreSQL MEWAJIBKAN foreign key
-- menunjuk seluruh primary key, sehingga FK pada `attempt_id` saja mustahil
-- secara teknis. Itu bukan kelalaian — itu batas PostgreSQL.
--
-- Kenapa sekarang diperbaiki: `PR-02` menghitung poin liga berbobot dari tabel
-- ini. Review yang menunjuk attempt fantom = POIN FANTOM, dan poin fantom
-- adalah manipulasi skor yang tidak meninggalkan jejak. Integritas jalur skor
-- tidak pantas bergantung pada disiplin kode saja.
--
-- Tenggat aslinya sebelum `PR-01` (W5) — setelah ada data peer review,
-- perubahan ini jadi migrasi data, bukan sekadar ALTER TABLE.

-- Tabel masih kosong (belum ada item yang menulisinya), jadi NOT NULL bisa
-- ditetapkan langsung tanpa backfill. Kalau migrasi ini terlambat sampai ada
-- data, urutannya harus: tambah nullable -> backfill dari lesson_attempts ->
-- SET NOT NULL.
ALTER TABLE peer_reviews ADD COLUMN attempt_date date NOT NULL;

-- ON DELETE CASCADE disengaja: menghapus attempt harus menghapus review-nya.
-- Tanpa itu, review yatim tetap terhitung di rebuild leaderboard, dan
-- rebuild-nya justru yang diandalkan sebagai sumber kebenaran Redis.
ALTER TABLE peer_reviews
  ADD CONSTRAINT peer_reviews_attempt_fk
  FOREIGN KEY (attempt_id, attempt_date)
  REFERENCES lesson_attempts (id, attempt_date)
  ON DELETE CASCADE;

-- Sisi perujuk butuh index-nya sendiri: tanpa ini, setiap DELETE di
-- lesson_attempts memindai seluruh peer_reviews untuk mencari baris turunan.
CREATE INDEX peer_reviews_attempt_idx ON peer_reviews (attempt_id, attempt_date);

COMMENT ON COLUMN peer_reviews.attempt_date IS
  'Isu #15. Bagian dari FK majemuk ke lesson_attempts (id, attempt_date). WAJIB diambil dari baris lesson_attempts itu sendiri, TIDAK PERNAH dibentuk di Node: ini tanggal LOKAL pengguna, dan Date milik proses Node akan meleset satu hari untuk sebagian pengguna.';
