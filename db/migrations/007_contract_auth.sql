-- 007_contract_auth.sql
--
-- Sisi CONTRACT dari `004_better_auth.sql` — isu #47.
--
-- `CLAUDE.md` melarang `DROP` di deploy yang sama dengan kode yang berhenti
-- memakainya (expand/contract). 004 mengerjakan expand-nya dan menandai tiga
-- hal sebagai USANG lewat `COMMENT`, dengan janji eksplisit: *"dibuang di
-- migrasi contract"*. Berkas ini menepatinya.
--
-- ── Kenapa ini bukan sekadar kerapian ──
--
-- Skema yang memuat tiga hal usang **terbaca seperti skema yang memakai
-- ketiganya**. `COMMENT` memang sudah dipasang sebagai penjaga, tapi komentar
-- tidak muncul di `\d users` — dan `\d users` yang dibuka orang saat menelusuri
-- masalah, bukan berkas migrasi.
--
-- Bukti bahwa bahayanya nyata, bukan teoretis: **`A-05` (`GET /me`, ter-merge
-- kemarin) membaca `email_verified_at`**, kolom yang di-backfill SEKALI di 004
-- dan sejak itu tidak pernah ditulis siapa pun. Better-Auth menulis
-- `email_verified`. Akibatnya pengguna yang memverifikasi emailnya hari ini
-- tetap terbaca BELUM terverifikasi oleh `/me` — dan `AU-8` memblokir top-up
-- berdasarkan itu. Kolom usang yang masih bisa di-SELECT akan di-SELECT.
--
-- ── Kenapa aman dijalankan sekarang ──
--
-- Prasyarat di isu #47 tertulis "A-01 sudah berjalan di staging cukup lama".
-- Staging ditunda tanpa batas (isu #29), jadi prasyarat itu tidak akan pernah
-- terpenuhi. Yang menggantikannya bukti yang lebih kuat daripada waktu:
-- seluruh `apps/`, `packages/`, `db/`, dan `scripts/` disisir, dan setelah
-- perbaikan `A-05` di PR ini **nol kode produksi** membaca ketiganya. Sisanya
-- hanya berkas test yang menyisipkan `password_hash: 'x'` karena dulu kolomnya
-- `NOT NULL` — dan ikut dibersihkan di PR yang sama.
--
-- Produksi belum ada. Tidak ada pengguna sungguhan yang barisnya hilang.

-- ── users.password_hash ────────────────────────────────────────────────────
--
-- Password ada di `auth_accounts.password` (Argon2id, AU-3) sejak 004.
-- Kolom ini sudah nullable sejak itu dan tidak pernah diisi lagi.
ALTER TABLE users DROP COLUMN password_hash;

-- ── users.email_verified_at ────────────────────────────────────────────────
--
-- Digantikan `users.email_verified` (boolean) — keputusan isu #35 opsi 1,
-- karena `emailVerified` milik Better-Auth bertipe boolean dan pemetaan field
-- hanya mengganti NAMA kolom, tidak pernah tipenya.
ALTER TABLE users DROP COLUMN email_verified_at;

-- ── refresh_tokens ─────────────────────────────────────────────────────────
--
-- `AU-4` berubah jadi sesi server Better-Auth (isu #18); pasangan
-- access/refresh token tidak pernah diterbitkan lagi.
--
-- Ini yang paling mendesak dari ketiganya: selama tabelnya ada, ia punya FK ke
-- `users`, ikut dalam `TRUNCATE … CASCADE`, ikut terhitung di pemeriksaan
-- jumlah tabel CI, dan **ikut muncul di hasil `pnpm db:types`** — jadi kode
-- baru bisa mengimpornya tanpa satu pun peringatan.
DROP TABLE refresh_tokens;

-- Jumlah tabel domain turun 33 → 32. Assert di CI dan `kysely.spec.ts`
-- diperbarui di PR yang sama; angka yang ditulis tangan di dua tempat akan
-- menyimpang kalau hanya satu yang diubah.

-- Komentar `email_verified` masih berbunyi "dibuang di migrasi contract" —
-- janji yang baru saja ditepati berkas ini. Komentar yang menjanjikan masa
-- depan yang sudah lewat membuat orang mencari migrasi yang tidak akan datang.
COMMENT ON COLUMN users.email_verified IS
  'AU-8: false memblokir top-up. Ditulis Better-Auth. SATU-SATUNYA sumber status verifikasi sejak 007 membuang email_verified_at (isu #35 opsi 1, #47).';
