-- 001_init.sql — skema awal Strive Academy
--
-- Sumber kebenaran: docs/PRD.md §9. 31 tabel domain, nol kolom tenant.
-- Forward-only: tidak ada bagian `down`. Koreksi ditulis sebagai migrasi baru.
--
-- Catatan pembaca: tiga hal di file ini terlihat aneh kalau tidak tahu
-- alasannya, dan ketiganya disengaja. Masing-masing diberi komentar di
-- tempatnya: trigger append-only coin_ledger, kunci partisi lesson_attempts
-- yang memakai tanggal LOKAL, dan PK surrogate di squad_members.

BEGIN;

-- ════════════════════════════════════════════════════════════════════════
--  Ekstensi
-- ════════════════════════════════════════════════════════════════════════

-- citext: users.email case-insensitive unique (docs/PRD.md §7 E1 AU-1).
-- "A@B.com" dan "a@b.com" harus dianggap orang yang sama.
CREATE EXTENSION IF NOT EXISTS citext;

-- ════════════════════════════════════════════════════════════════════════
--  Skema metadata migrasi
--
--  DI LUAR 31 tabel domain, dan sengaja ditaruh di skema sendiri supaya
--  tidak pernah tercampur saat menghitung tabel. `public` memuat tepat 31
--  tabel; ledger migrasi tinggal di `strive_meta`.
-- ════════════════════════════════════════════════════════════════════════

CREATE SCHEMA IF NOT EXISTS strive_meta;

CREATE TABLE IF NOT EXISTS strive_meta.schema_migrations (
  filename    text PRIMARY KEY,
  checksum    text        NOT NULL,
  applied_at  timestamptz NOT NULL DEFAULT now()
);

-- ════════════════════════════════════════════════════════════════════════
--  ENUM — docs/PRD.md §9.2
-- ════════════════════════════════════════════════════════════════════════

CREATE TYPE user_role   AS ENUM ('student', 'mentor', 'superadmin');
CREATE TYPE card_kind   AS ENUM ('multiple_choice', 'swipe_binary', 'order_steps', 'reveal');
CREATE TYPE league_tier AS ENUM ('bronze', 'silver', 'gold');
CREATE TYPE ai_job_kind AS ENUM ('ats_cv', 'prompt_run', 'interview_feedback', 'statement_review');
CREATE TYPE coin_entry  AS ENUM (
  'earn_lesson', 'earn_streak', 'earn_review', 'purchase',
  'hold', 'settle', 'release', 'spend_store', 'spend_scan', 'spend_ai', 'adjust'
);

-- ════════════════════════════════════════════════════════════════════════
--  IDENTITAS — 4 tabel
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE users (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email             citext UNIQUE NOT NULL,
  password_hash     text NOT NULL,                       -- Argon2id, tidak pernah di log
  display_name      text NOT NULL,
  avatar_url        text,
  role              user_role NOT NULL DEFAULT 'student',
  timezone          text NOT NULL DEFAULT 'Asia/Jakarta',-- IANA; menentukan batas hari
  -- CACHE, bukan kebenaran. Kebenarannya SUM(coin_ledger.amount).
  -- Hanya CoinLedgerService yang boleh menulis kolom ini (CLAUDE.md aturan 2-3).
  coin_balance      integer NOT NULL DEFAULT 0,
  status            text NOT NULL DEFAULT 'active',
  email_verified_at timestamptz,                         -- NULL memblokir top-up (AU-8)
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_coin_balance_non_negative CHECK (coin_balance >= 0),
  CONSTRAINT users_status_valid CHECK (status IN ('active', 'suspended', 'deleted'))
);

CREATE INDEX users_role_active_idx ON users (role) WHERE status = 'active';

-- Dikelola Better-Auth (docs/PRD.md §7 E1). Bentuknya minimal di sini;
-- kolom tambahan milik adapter ditambahkan lewat migrasi berikutnya kalau perlu.
CREATE TABLE sessions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  ip         inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE refresh_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- HASH, bukan plaintext (docs/PRD.md §16.1).
  token_hash  text UNIQUE NOT NULL,
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  -- Rantai rotasi. Token yang sudah punya penerus lalu dipakai lagi = pencurian
  -- token; seluruh rantai turunannya dicabut (AU-5).
  replaced_by uuid REFERENCES refresh_tokens(id),
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX refresh_tokens_user_idx ON refresh_tokens (user_id) WHERE revoked_at IS NULL;

-- Web Push ditunda ke pasca-rilis (docs/PRD.md §22), tabelnya tetap berdiri
-- sejak awal supaya fiturnya bisa diaktifkan tanpa migrasi.
CREATE TABLE push_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint   text NOT NULL,
  p256dh     text NOT NULL,
  auth       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT push_tokens_user_endpoint_uniq UNIQUE (user_id, endpoint)
);

-- ════════════════════════════════════════════════════════════════════════
--  PEMBELAJARAN — 5 tabel
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE tracks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         text UNIQUE NOT NULL,
  title        text NOT NULL,
  description  text,
  category     text,
  is_published boolean NOT NULL DEFAULT false,
  sort_order   integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE modules (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  track_id   uuid NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  title      text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX modules_track_idx ON modules (track_id, sort_order);

CREATE TABLE lessons (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id   uuid NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  title       text NOT NULL,
  est_seconds integer NOT NULL DEFAULT 150,   -- target 120-180 detik (LE-1)
  base_points integer NOT NULL DEFAULT 10,
  base_coins  integer NOT NULL DEFAULT 20,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX lessons_module_idx ON lessons (module_id, sort_order);

CREATE TABLE lesson_cards (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id  uuid NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  kind       card_kind NOT NULL,
  prompt     text NOT NULL,
  -- Memuat kunci jawaban: { options: [{ id, text, correct, why }] }.
  -- `correct` dan `why` WAJIB dibuang di serializer sebelum dikirim ke client
  -- (LE-3). Diuji dengan snapshot test atas respons mentah.
  content    jsonb NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX lesson_cards_lesson_idx ON lesson_cards (lesson_id, sort_order);

-- Dipartisi per RANGE(attempt_date) — TANGGAL LOKAL pengguna, bukan UTC.
--
-- Dua alasan yang saling menguatkan (docs/PRD.md §9.3):
--   1. PostgreSQL mewajibkan unique index di tabel terpartisi memuat SELURUH
--      kolom partisi. Index harian kita butuh tanggal lokal, jadi tanggal lokal
--      itulah yang harus jadi kunci partisi.
--   2. Dipartisi per UTC, satu hari lokal bisa terbelah ke dua partisi di
--      pergantian bulan — dan keunikan hariannya bocor persis di situ.
CREATE TABLE lesson_attempts (
  id           uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id),
  lesson_id    uuid NOT NULL REFERENCES lessons(id),
  attempt_date date NOT NULL,           -- (now() AT TIME ZONE users.timezone)::date
  card_results jsonb NOT NULL,          -- [{card_id, answer, correct, ms}]
  score        smallint NOT NULL CHECK (score BETWEEN 0 AND 100),
  points       integer NOT NULL,
  coins        integer NOT NULL,
  duration_ms  integer NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, attempt_date)
) PARTITION BY RANGE (attempt_date);

-- Satu lesson berhadiah sekali per hari per pengguna (LE-4).
CREATE UNIQUE INDEX lesson_attempts_daily_uniq
  ON lesson_attempts (user_id, lesson_id, attempt_date);
CREATE INDEX lesson_attempts_user_idx ON lesson_attempts (user_id, completed_at DESC);

-- Partisi bulanan. Job bulanan membuat bulan berjalan + satu bulan ke depan;
-- yang di bawah ini menutup rentang beta supaya tidak ada insert yang jatuh ke
-- luar partisi sebelum job itu ada.
CREATE TABLE lesson_attempts_2026_09 PARTITION OF lesson_attempts
  FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE lesson_attempts_2026_10 PARTITION OF lesson_attempts
  FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE lesson_attempts_2026_11 PARTITION OF lesson_attempts
  FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE lesson_attempts_2026_12 PARTITION OF lesson_attempts
  FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');
CREATE TABLE lesson_attempts_2027_01 PARTITION OF lesson_attempts
  FOR VALUES FROM ('2027-01-01') TO ('2027-02-01');
CREATE TABLE lesson_attempts_2027_02 PARTITION OF lesson_attempts
  FOR VALUES FROM ('2027-02-01') TO ('2027-03-01');

-- ════════════════════════════════════════════════════════════════════════
--  GAMIFIKASI — 6 tabel
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE streaks (
  user_id                uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  current_streak         integer NOT NULL DEFAULT 0,
  longest_streak         integer NOT NULL DEFAULT 0,   -- tidak pernah turun (SK-5)
  -- TANGGAL LOKAL pengguna. Jangan pernah diisi dari ::date atas timestamptz UTC.
  last_activity_date     date,
  timezone               text NOT NULL DEFAULT 'Asia/Jakarta',
  freeze_credits         smallint NOT NULL DEFAULT 1,
  freeze_used_date       date,
  freeze_purchased_month char(7),                      -- 'YYYY-MM', batas 1 beli/bulan (Q3)
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT streaks_freeze_credits_range CHECK (freeze_credits BETWEEN 0 AND 2),
  CONSTRAINT streaks_longest_gte_current  CHECK (longest_streak >= current_streak)
);

CREATE TABLE daily_quests (
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quest_date   date NOT NULL,                          -- tanggal LOKAL pengguna
  target_tasks smallint NOT NULL DEFAULT 3,
  done_tasks   smallint NOT NULL DEFAULT 0,
  completed_at timestamptz,
  PRIMARY KEY (user_id, quest_date)
);

CREATE TABLE league_seasons (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code      text UNIQUE NOT NULL,                      -- minggu ISO, '2026-W37' (SQ-3)
  starts_at timestamptz NOT NULL,
  ends_at   timestamptz NOT NULL,
  closed_at timestamptz,
  CONSTRAINT league_seasons_range CHECK (ends_at > starts_at)
);

CREATE TABLE squads (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  league_tier league_tier NOT NULL DEFAULT 'bronze',
  -- Satu mentor boleh membina banyak squad; relasinya satu-ke-banyak, jadi
  -- cukup kolom ini — tidak perlu tabel penugasan terpisah (§5 Q6).
  mentor_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  season_id   uuid REFERENCES league_seasons(id),
  max_members smallint NOT NULL DEFAULT 12,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT squads_max_members_range CHECK (max_members BETWEEN 8 AND 12)
);

CREATE INDEX squads_mentor_idx ON squads (mentor_id) WHERE mentor_id IS NOT NULL;
CREATE INDEX squads_season_idx ON squads (season_id);

-- PK surrogate, BUKAN (squad_id, user_id).
-- Pengguna yang keluar lalu bergabung lagi ke squad yang SAMA harus bisa punya
-- baris kedua; PK komposit membuatnya mustahil dan baru ketahuan saat ada
-- pengguna yang tidak bisa kembali.
CREATE TABLE squad_members (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  squad_id      uuid NOT NULL REFERENCES squads(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  weekly_points integer NOT NULL DEFAULT 0,
  joined_at     timestamptz NOT NULL DEFAULT now(),
  left_at       timestamptz
);

-- Satu pengguna hanya boleh aktif di satu squad (SQ-2).
CREATE UNIQUE INDEX squad_members_one_active ON squad_members (user_id) WHERE left_at IS NULL;
CREATE INDEX squad_members_squad_idx ON squad_members (squad_id) WHERE left_at IS NULL;

CREATE TABLE league_standings (
  season_id uuid NOT NULL REFERENCES league_seasons(id) ON DELETE CASCADE,
  squad_id  uuid NOT NULL REFERENCES squads(id) ON DELETE CASCADE,
  tier      league_tier NOT NULL,
  points    integer NOT NULL DEFAULT 0,
  rank      integer,
  outcome   text,                                      -- promoted | relegated | stayed
  closed_at timestamptz,
  PRIMARY KEY (season_id, squad_id),
  CONSTRAINT league_standings_outcome_valid
    CHECK (outcome IS NULL OR outcome IN ('promoted', 'relegated', 'stayed'))
);

-- ════════════════════════════════════════════════════════════════════════
--  EKONOMI — 6 tabel
-- ════════════════════════════════════════════════════════════════════════

-- APPEND-ONLY. Trigger di bawah menolak UPDATE dan DELETE.
-- Koreksi ditulis sebagai entri 'adjust' BARU, tidak pernah dengan mengubah
-- entri lama (CO-1, CO-2).
CREATE TABLE coin_ledger (
  id              bigserial PRIMARY KEY,
  user_id         uuid NOT NULL REFERENCES users(id),
  entry_type      coin_entry NOT NULL,
  amount          integer NOT NULL,                    -- signed: + masuk, - keluar
  balance_after   integer NOT NULL,                    -- snapshot, ditulis di transaksi yang sama
  ref_type        text,                                -- attempt|order|scan|purchase|streak|ai_job|review
  ref_id          uuid,
  idempotency_key text UNIQUE,
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT coin_ledger_amount_nonzero CHECK (amount <> 0)
);

-- Idempotensi lapis kedua: satu referensi hanya boleh punya satu entri per
-- jenis. Lapis pertama adalah idempotency_key UNIQUE di atas (CO-5).
CREATE UNIQUE INDEX coin_ledger_ref_uniq
  ON coin_ledger (ref_type, ref_id, entry_type) WHERE ref_id IS NOT NULL;
CREATE INDEX coin_ledger_user_time_idx ON coin_ledger (user_id, created_at DESC);

CREATE OR REPLACE FUNCTION coin_ledger_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'coin_ledger bersifat append-only: gunakan entri adjust';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER coin_ledger_no_mutate
  BEFORE UPDATE OR DELETE ON coin_ledger
  FOR EACH ROW EXECUTE FUNCTION coin_ledger_immutable();

-- Perubahan harga MENERBITKAN versi baru, tidak pernah menimpa (SA-3).
-- Angkanya mengikuti docs/PRD.md §5 yang berstatus TERKUNCI dan §6.
CREATE TABLE pricing_config (
  version                 integer PRIMARY KEY,
  coin_price_idr          integer NOT NULL,            -- §5 Q1: 25
  scan_cost_coins         integer NOT NULL,            -- 2400
  scan_cached_cost_coins  integer NOT NULL,            -- 240
  lesson_reward_coins     integer NOT NULL,            -- 20
  cv_cost_coins           integer NOT NULL,            -- 400
  interview_cost_coins    integer NOT NULL,            -- 300
  statement_cost_coins    integer NOT NULL,            -- 500
  prompt_run_cost_coins   integer NOT NULL,            -- 20
  freeze_cost_coins       integer NOT NULL,            -- 200
  packages                jsonb NOT NULL,              -- 3 paket top-up (§6.3)
  created_by              uuid REFERENCES users(id),
  active_from             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE orders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id),
  -- Versi harga disimpan per order supaya order lama tetap terbaca harganya
  -- setelah harga berubah (PA-4).
  pricing_version integer NOT NULL REFERENCES pricing_config(version),
  coins           integer NOT NULL,
  amount_idr      integer NOT NULL,
  status          text NOT NULL DEFAULT 'pending',
  provider        text NOT NULL DEFAULT 'midtrans',
  provider_ref    text,
  idempotency_key text UNIQUE NOT NULL,
  paid_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT orders_status_valid CHECK (status IN ('pending', 'paid', 'failed', 'expired'))
);

CREATE INDEX orders_user_idx ON orders (user_id, created_at DESC);
CREATE INDEX orders_pending_idx ON orders (created_at) WHERE status = 'pending';

-- Setiap webhook dicatat, termasuk yang ditolak — jejaknya yang dipakai saat
-- menelusuri pembayaran ganda (AC-PA-1).
CREATE TABLE payments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     uuid NOT NULL REFERENCES orders(id),
  provider     text NOT NULL,
  event_type   text NOT NULL,
  raw_payload  jsonb NOT NULL,
  signature_ok boolean NOT NULL,
  received_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX payments_order_idx ON payments (order_id, received_at DESC);

CREATE TABLE store_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text UNIQUE NOT NULL,
  title       text NOT NULL,
  kind        text NOT NULL,                           -- prompt_library|template|asset
  price_coins integer NOT NULL,
  asset_key   text NOT NULL,                           -- object storage, signed URL 15 menit
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT store_items_price_positive CHECK (price_coins > 0)
);

CREATE TABLE store_purchases (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id     uuid NOT NULL REFERENCES store_items(id),
  price_coins integer NOT NULL,
  ledger_id   bigint REFERENCES coin_ledger(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- Satu item dibeli sekali per pengguna (SR-2).
  CONSTRAINT store_purchases_once UNIQUE (user_id, item_id)
);

-- ════════════════════════════════════════════════════════════════════════
--  AKADEMIK — 3 tabel
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE plagiarism_scans (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users(id),
  document_sha256  char(64) NOT NULL,                  -- kunci dedup (KL-2, KL-3)
  document_key     text NOT NULL,
  filename         text NOT NULL,
  word_count       integer,
  provider         text NOT NULL DEFAULT 'copyleaks',
  provider_scan_id text,
  similarity_score numeric(5,2),
  report_key       text,
  status           text NOT NULL DEFAULT 'queued',
  cost_coins       integer NOT NULL,
  hold_ledger_id   bigint REFERENCES coin_ledger(id),
  cached_from      uuid REFERENCES plagiarism_scans(id),
  error_message    text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  completed_at     timestamptz,
  CONSTRAINT plagiarism_scans_status_valid
    CHECK (status IN ('queued', 'running', 'done', 'failed', 'released')),
  CONSTRAINT plagiarism_scans_score_range
    CHECK (similarity_score IS NULL OR similarity_score BETWEEN 0 AND 100)
);

CREATE INDEX scan_dedup_idx ON plagiarism_scans (document_sha256, provider) WHERE status = 'done';
CREATE INDEX scan_stuck_idx ON plagiarism_scans (created_at) WHERE status IN ('queued', 'running');
CREATE INDEX scan_user_idx  ON plagiarism_scans (user_id, created_at DESC);

CREATE TABLE peer_reviews (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- TIDAK ada foreign key ke lesson_attempts, dan itu bukan kelalaian:
  -- lesson_attempts terpartisi dengan PK (id, attempt_date), sedangkan
  -- PostgreSQL mewajibkan FK menunjuk ke SELURUH primary key. Menambah kolom
  -- attempt_date di sini berarti menambah kolom yang tidak ada di
  -- docs/PRD.md §9 — itu keputusan manusia, bukan keputusan migrasi.
  -- Integritasnya ditegakkan di service sampai keputusan itu diambil.
  attempt_id     uuid NOT NULL,
  reviewer_id    uuid NOT NULL REFERENCES users(id),
  author_id      uuid NOT NULL REFERENCES users(id),
  rubric_scores  jsonb NOT NULL,
  comment        text,
  weighted_points integer NOT NULL DEFAULT 0,
  mentor_checked boolean NOT NULL DEFAULT false,
  mentor_delta   integer,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT peer_reviews_one_per_reviewer UNIQUE (attempt_id, reviewer_id),
  -- Lapis kedua di bawah cek service: menilai karya sendiri ditolak database
  -- juga, kalau ada jalur yang menembus (PR-3, AC-PR-2).
  CONSTRAINT no_self_review CHECK (reviewer_id <> author_id)
);

CREATE INDEX peer_reviews_reviewer_idx ON peer_reviews (reviewer_id, created_at DESC);
CREATE INDEX peer_reviews_author_idx   ON peer_reviews (author_id, created_at DESC);

-- Diisi 1,00 di v0.1; kalibrasi otomatis ditunda (PR-8). Tabelnya tetap ada
-- sejak awal supaya kalibrasi bisa diaktifkan tanpa migrasi.
CREATE TABLE reviewer_weights (
  user_id       uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  weight        numeric(3,2) NOT NULL DEFAULT 1.00,
  samples       integer NOT NULL DEFAULT 0,
  avg_deviation numeric(5,2),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reviewer_weights_range CHECK (weight BETWEEN 0.50 AND 1.50)
);

-- ════════════════════════════════════════════════════════════════════════
--  KARIR & AI — 4 tabel
-- ════════════════════════════════════════════════════════════════════════

-- Node TIDAK PERNAH memanggil LLM langsung. Setiap panggilan lewat baris di
-- sini, supaya biayanya bisa diaudit di satu tempat (CLAUDE.md aturan 8).
CREATE TABLE ai_jobs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id),
  kind           ai_job_kind NOT NULL,
  status         text NOT NULL DEFAULT 'queued',
  input          jsonb NOT NULL,
  output         jsonb,
  model          text,
  prompt_version text,                                 -- contoh 'ats-cv/2026-09-01'
  input_tokens   integer,
  output_tokens  integer,
  cost_usd       numeric(10,6),
  error_message  text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  completed_at   timestamptz,
  CONSTRAINT ai_jobs_status_valid CHECK (status IN ('queued', 'running', 'done', 'failed'))
);

CREATE INDEX ai_jobs_user_idx   ON ai_jobs (user_id, created_at DESC);
CREATE INDEX ai_jobs_status_idx ON ai_jobs (status) WHERE status IN ('queued', 'running');
CREATE INDEX ai_jobs_cost_idx   ON ai_jobs (created_at) WHERE cost_usd IS NOT NULL;

CREATE TABLE cv_documents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id       uuid REFERENCES ai_jobs(id),
  structured   jsonb NOT NULL,
  ats_score    smallint,                               -- DETERMINISTIK, tanpa LLM (CV-6)
  ats_findings jsonb,
  pdf_key      text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cv_documents_score_range CHECK (ats_score IS NULL OR ats_score BETWEEN 0 AND 100)
);

CREATE INDEX cv_documents_user_idx ON cv_documents (user_id, created_at DESC);

CREATE TABLE prompt_runs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id      uuid REFERENCES ai_jobs(id),
  structure   jsonb NOT NULL,                          -- role/context/task/format/constraints
  output      text,
  self_rating smallint,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prompt_runs_rating_range CHECK (self_rating IS NULL OR self_rating BETWEEN 1 AND 5)
);

CREATE INDEX prompt_runs_user_idx ON prompt_runs (user_id, created_at DESC);

CREATE TABLE mastery_sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        text NOT NULL,                           -- interview | statement
  target      text,                                    -- chevening | lpdp | fulbright
  turns       jsonb NOT NULL DEFAULT '[]'::jsonb,
  feedback    jsonb,
  mentor_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  mentor_note text,
  status      text NOT NULL DEFAULT 'draft',
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mastery_sessions_kind_valid   CHECK (kind IN ('interview', 'statement')),
  CONSTRAINT mastery_sessions_status_valid CHECK (status IN ('draft', 'submitted', 'ai_reviewed', 'failed'))
);

CREATE INDEX mastery_sessions_user_idx ON mastery_sessions (user_id, created_at DESC);

-- ════════════════════════════════════════════════════════════════════════
--  INFRASTRUKTUR — 3 tabel
-- ════════════════════════════════════════════════════════════════════════

-- Jembatan Postgres -> Redis/WebSocket. Event ikut ter-commit bersama datanya;
-- pengantaran at-least-once, jadi SETIAP konsumen wajib idempoten
-- (docs/PRD.md §8.3 aturan 3).
CREATE TABLE outbox_events (
  id           bigserial PRIMARY KEY,
  topic        text NOT NULL,    -- points.awarded | streak.updated | wallet.updated | job.completed
  payload      jsonb NOT NULL,
  attempts     smallint NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

-- Partial index: hanya baris pending yang diindeks, jadi tetap kecil selamanya
-- meski tabelnya tumbuh terus.
CREATE INDEX outbox_pending_idx ON outbox_events (id) WHERE processed_at IS NULL;

CREATE TABLE notifications (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind    text NOT NULL,   -- streak_warning | league_change | job_done | review_validated
  title   text NOT NULL,
  body    text NOT NULL,
  data    jsonb,
  read_at timestamptz,
  -- NULL setelah 3x retry gagal = tidak hilang diam-diam (NO-4).
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX notifications_user_unread_idx ON notifications (user_id, created_at DESC)
  WHERE read_at IS NULL;

CREATE TABLE audit_log (
  id           bigserial PRIMARY KEY,
  actor_id     uuid REFERENCES users(id),
  action       text NOT NULL,
  subject_type text,
  subject_id   text,
  before       jsonb,
  after        jsonb,
  ip           inet,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_log_actor_idx  ON audit_log (actor_id, created_at DESC);
CREATE INDEX audit_log_action_idx ON audit_log (action, created_at DESC);

COMMIT;
