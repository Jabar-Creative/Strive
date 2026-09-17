-- 004_better_auth.sql
--
-- `A-01`: skema disesuaikan dengan Better-Auth 1.7.5, sesuai keputusan isu #18
-- (jalan 1 — skema mengikuti Better-Auth, bukan sebaliknya).
--
-- Bentuk tabel di bawah TIDAK dikarang: diturunkan dari `getAuthTables()` yang
-- dijalankan terhadap better-auth@1.7.5 sungguhan, dengan seluruh field
-- dipetakan ke snake_case supaya konsisten dengan sisa skema.
--
-- Jumlah tabel domain: 31 -> 33. Pemeriksaan CI ikut dinaikkan.

-- ── users ──────────────────────────────────────────────────────────────────

-- Better-Auth menyimpan password di `auth_accounts.password` dengan
-- provider_id 'credential', BUKAN di users. Kolom ini berhenti dipakai tapi
-- belum dibuang: forward-only, expand sekarang, contract di migrasi terpisah
-- setelah A-01 stabil. Yang penting sekarang ia tidak lagi NOT NULL — kalau
-- terlewat, INSERT pengguna baru dari Better-Auth GAGAL.
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

-- Keputusan isu #35 opsi 1: `emailVerified` milik Better-Auth bertipe BOOLEAN
-- dan tipenya TIDAK bisa diubah lewat pemetaan field — pemetaan hanya
-- mengganti nama kolom. Dibuktikan dengan menjalankan getAuthTables():
-- `emailVerified -> kolom 'email_verified_at' tipe boolean`, lalu PostgreSQL
-- menolaknya ("is of type timestamp with time zone but expression is of type
-- boolean").
--
-- `email_verified_at` dipertahankan dulu dan di-backfill, dibuang di migrasi
-- contract terpisah. Sampai saat itu, YANG DIBACA HANYA `email_verified`.
ALTER TABLE users ADD COLUMN email_verified boolean NOT NULL DEFAULT false;
UPDATE users SET email_verified = (email_verified_at IS NOT NULL);

COMMENT ON COLUMN users.email_verified IS
  'AU-8: false memblokir top-up. Ditulis Better-Auth. Menggantikan email_verified_at (isu #35 opsi 1) yang dibuang di migrasi contract.';
COMMENT ON COLUMN users.password_hash IS
  'USANG sejak 004. Password ada di auth_accounts.password. Dibuang di migrasi contract.';

-- ── sessions ───────────────────────────────────────────────────────────────

-- Token sesi buram milik Better-Auth. Inilah yang menggantikan pasangan
-- access/refresh token di AU-4 versi lama.
ALTER TABLE sessions ADD COLUMN token text;
UPDATE sessions SET token = gen_random_uuid()::text WHERE token IS NULL;
ALTER TABLE sessions ALTER COLUMN token SET NOT NULL;
ALTER TABLE sessions ADD CONSTRAINT sessions_token_unique UNIQUE (token);

ALTER TABLE sessions ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

-- `ip` DILEBARKAN dari inet ke text, dan ini bukan kemalasan.
--
-- Better-Auth mengisi `ipAddress` dari header request apa adanya, dan yang
-- biasa ada di situ adalah X-Forwarded-For — yang boleh berisi rantai:
--   SELECT '1.2.3.4, 5.6.7.8'::inet
--   ERROR: invalid input syntax for type inet
--
-- Dengan `inet`, pengguna di belakang proxy berantai GAGAL LOGIN, dan
-- pesannya menunjuk ke tipe kolom, bukan ke sebabnya. Setiap nilai inet yang
-- sah tetap sah sebagai text, jadi pelebaran ini tidak kehilangan apa pun.
ALTER TABLE sessions ALTER COLUMN ip TYPE text USING ip::text;

COMMENT ON COLUMN sessions.ip IS
  'text, bukan inet: Better-Auth meneruskan X-Forwarded-For apa adanya dan rantai proxy bukan inet yang sah.';

-- ── auth_accounts ──────────────────────────────────────────────────────────
--
-- Nama tabelnya BUKAN `account` (default Better-Auth) karena dua alasan:
-- konvensi repo memakai jamak, dan `accounts` polos akan terbaca seperti tabel
-- keuangan di sebelah `orders`, `payments`, dan `coin_ledger`. Prefiks `auth_`
-- membuat pemiliknya jelas sejak nama.
CREATE TABLE auth_accounts (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id                text NOT NULL,
  provider_id               text NOT NULL,
  user_id                   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  access_token              text,
  refresh_token             text,
  id_token                  text,
  access_token_expires_at   timestamptz,
  refresh_token_expires_at  timestamptz,
  scope                     text,
  -- DI SINILAH password sungguhan tinggal. Argon2id (AU-3).
  password                  text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auth_accounts_provider_account_unique UNIQUE (provider_id, account_id)
);

CREATE INDEX auth_accounts_user_idx ON auth_accounts (user_id);

COMMENT ON TABLE auth_accounts IS
  'Better-Auth: kredensial & tautan penyedia. provider_id=''credential'' memuat password Argon2id. Isu #18.';

-- ── auth_verifications ─────────────────────────────────────────────────────

CREATE TABLE auth_verifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier  text NOT NULL,
  value       text NOT NULL,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX auth_verifications_identifier_idx ON auth_verifications (identifier);
CREATE INDEX auth_verifications_expires_idx ON auth_verifications (expires_at);

COMMENT ON TABLE auth_verifications IS
  'Better-Auth: token verifikasi email & reset password. Isu #18.';

-- ── refresh_tokens ─────────────────────────────────────────────────────────
--
-- TIDAK dibuang di sini. Ia berhenti dipakai karena AU-4 berubah jadi sesi
-- server (isu #18), tapi membuang tabel di deploy yang sama dengan kode yang
-- berhenti memakainya melanggar aturan expand/contract di CLAUDE.md.
COMMENT ON TABLE refresh_tokens IS
  'USANG sejak 004. AU-4 berubah jadi sesi Better-Auth (isu #18). Dibuang di migrasi contract, bukan di sini.';
