-- 005_registration_rows.sql
--
-- `A-01` / AU-6: registrasi membuat baris `streaks` dan `reviewer_weights`
-- **dalam transaksi yang sama**.
--
-- Kenapa trigger, bukan kode aplikasi.
--
-- Better-Auth memiliki transaksi pembuatan penggunanya sendiri dan tidak tahu
-- apa-apa soal `streaks` maupun `reviewer_weights`. Dibuktikan dengan
-- menjalankannya sungguhan terhadap database ini: registrasi berhasil,
-- `users` terisi, dan kedua tabel itu **nol baris**.
--
-- Hook `after` milik Better-Auth berjalan SETELAH transaksinya commit, jadi ia
-- tidak bisa memenuhi kata "dalam transaksi yang sama" di AU-6. Kalau hook itu
-- gagal, penggunanya tetap ada tanpa streak — dan gejalanya baru muncul
-- berhari-hari kemudian sebagai "streak saya tidak jalan".
--
-- Trigger `BEFORE`/`AFTER INSERT` berjalan di dalam transaksi yang sama dengan
-- INSERT-nya, apa pun yang melakukan INSERT itu: Better-Auth, Retool, skrip
-- seed, psql manual. AU-6 jadi sifat tabelnya, bukan janji satu jalur kode.

CREATE OR REPLACE FUNCTION users_registration_rows() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- `timezone` disalin dari pengguna, bukan memakai default kolomnya sendiri.
  -- Dua sumber untuk satu fakta akan menyimpang, dan yang menyimpang di sini
  -- akan memutus streak pengguna pada jam yang salah (CLAUDE.md aturan 5).
  INSERT INTO streaks (user_id, timezone)
  VALUES (NEW.id, NEW.timezone)
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO reviewer_weights (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NULL;   -- AFTER trigger: nilai baliknya diabaikan
END $$;

-- AFTER, bukan BEFORE: baris `users` harus sudah ada sebelum foreign key
-- `streaks.user_id` bisa menunjuknya.
--
-- ON CONFLICT DO NOTHING membuatnya aman kalau suatu saat ada kode yang juga
-- menulis baris itu — idempoten, bukan berbenturan.
DROP TRIGGER IF EXISTS users_registration_rows ON users;
CREATE TRIGGER users_registration_rows
  AFTER INSERT ON users
  FOR EACH ROW EXECUTE FUNCTION users_registration_rows();

-- Backfill: pengguna yang sudah ada sebelum trigger ini berdiri.
INSERT INTO streaks (user_id, timezone)
SELECT u.id, u.timezone FROM users u
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO reviewer_weights (user_id)
SELECT u.id FROM users u
ON CONFLICT (user_id) DO NOTHING;

COMMENT ON FUNCTION users_registration_rows() IS
  'AU-6: streaks + reviewer_weights dibuat dalam transaksi yang sama dengan INSERT users. Trigger, bukan kode aplikasi, karena Better-Auth memiliki transaksinya sendiri.';
