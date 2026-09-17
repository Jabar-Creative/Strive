-- 006_admin_views.sql
--
-- `SA-01`: view SQL untuk transaksi & audit + role PostgreSQL read-only
-- untuk koneksi Retool (PRD §7 E9 `SA-1`, `SA-2`).
--
-- Dua hal yang dikerjakan berkas ini, dan keduanya soal BATAS:
--
-- 1. View yang membuat satu transaksi bisa ditelusuri dari order sampai entri
--    ledger DALAM SATU QUERY (acceptance criteria harfiah). Tanpa itu, orang
--    yang menelusuri insiden pembayaran harus merangkai empat tabel sendiri —
--    saat sedang panik, di jam yang salah.
--
-- 2. Role `strive_readonly` yang TIDAK BISA menulis apa pun. `SA-2` mewajibkan
--    semua aksi tulis lewat endpoint resmi; role ini yang membuat aturan itu
--    ditegakkan database, bukan disiplin orang yang membuka Retool.

-- ── view: satu transaksi, satu query ───────────────────────────────────────

CREATE OR REPLACE VIEW admin_transactions AS
SELECT
  o.id                AS order_id,
  o.created_at        AS order_created_at,
  o.status            AS order_status,
  o.coins             AS coins_ordered,
  o.amount_idr,
  o.pricing_version,
  o.provider,
  o.provider_ref,
  o.paid_at,
  u.id                AS user_id,
  u.email,
  u.display_name,
  p.id                AS payment_id,
  p.event_type        AS payment_event_type,
  -- `signature_ok = false` berarti ada yang mengirim webhook palsu untuk
  -- order ini. Itu hal pertama yang dicari saat menelusuri koin yang muncul
  -- entah dari mana (PA-6).
  p.signature_ok      AS payment_signature_ok,
  p.raw_payload       AS payment_payload,
  p.received_at       AS payment_received_at,
  -- Entri ledger yang lahir DARI order ini. LEFT JOIN: order `pending` dan
  -- order gagal memang belum punya entri, dan mereka justru yang paling sering
  -- ditelusuri.
  l.id                AS ledger_id,
  l.entry_type        AS ledger_entry_type,
  l.amount            AS ledger_amount,
  l.balance_after     AS ledger_balance_after,
  l.created_at        AS ledger_created_at,
  -- Tanda bahaya yang bisa dilihat tanpa menghitung apa pun: order `paid`
  -- yang TIDAK punya entri ledger berarti uang masuk tanpa koin keluar.
  (o.status = 'paid' AND l.id IS NULL) AS paid_without_ledger
FROM orders o
JOIN users u ON u.id = o.user_id
LEFT JOIN payments p ON p.order_id = o.id
LEFT JOIN coin_ledger l ON l.ref_type = 'order' AND l.ref_id = o.id;

COMMENT ON VIEW admin_transactions IS
  'SA-01: satu transaksi dari order sampai entri ledger dalam satu query. paid_without_ledger = uang masuk tanpa koin keluar.';

-- ── view: audit yang bisa dibaca manusia ───────────────────────────────────

CREATE OR REPLACE VIEW admin_audit AS
SELECT
  a.id,
  a.created_at,
  a.action,
  a.subject_type,
  a.subject_id,
  a.before,
  a.after,
  a.ip,
  a.actor_id,
  -- Email pelaku ikut, bukan cuma uuid-nya. Audit yang isinya uuid saja
  -- memaksa satu query tambahan untuk tiap baris, dan itu cukup menyakitkan
  -- untuk membuat orang berhenti membacanya.
  actor.email        AS actor_email,
  actor.role         AS actor_role
FROM audit_log a
LEFT JOIN users actor ON actor.id = a.actor_id;

COMMENT ON VIEW admin_audit IS
  'SA-01: audit_log dengan identitas pelaku ikut, supaya bisa dibaca tanpa query tambahan per baris.';

-- ── role read-only untuk Retool ────────────────────────────────────────────
--
-- Role, BUKAN pengguna: password-nya diatur per-lingkungan di luar migrasi
-- ini. Repo ini publik, dan migrasi yang memuat password adalah password yang
-- bocor selamanya (CLAUDE.md — port dan kredensial dev).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'strive_readonly') THEN
    CREATE ROLE strive_readonly NOLOGIN;
  END IF;
END $$;

REVOKE ALL ON SCHEMA public FROM strive_readonly;
GRANT USAGE ON SCHEMA public TO strive_readonly;

-- SELECT saja, dan hanya pada view. Tabel mentah TIDAK diberikan: Retool yang
-- bisa membaca `users` langsung akan menampilkan password_hash di layar
-- seseorang, dan `coin_ledger` mentah mengundang orang menghitung saldo
-- sendiri alih-alih membaca yang sudah dijamin.
GRANT SELECT ON admin_transactions, admin_audit TO strive_readonly;

-- Eksplisit, meski NOLOGIN sudah menahan: penolakan yang tertulis lebih mudah
-- diperiksa daripada penolakan yang tersirat.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM strive_readonly;

-- View yang dibuat SETELAH migrasi ini tidak otomatis terbaca role ini —
-- itu disengaja. Menambah view ke Retool adalah tindakan yang pantas terasa.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM strive_readonly;

COMMENT ON ROLE strive_readonly IS
  'SA-1: koneksi Retool. SELECT hanya pada admin_* view. Tidak bisa menulis apa pun; semua aksi tulis lewat endpoint resmi (SA-2).';
