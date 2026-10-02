-- 009_ai_jobs_error_code.sql
--
-- `ai_jobs.error_code` — isu #190.
--
-- ── Kolom ini ada karena `code` yang dikirim layanan AI tidak pernah dibaca ──
--
-- `services/ai/app/core/errors.py` mengirim bentuk §10.1 (`{error:{code,message}}`)
-- dan docstring-nya menuliskan alasannya harfiah: "supaya sisi Node mencabang
-- pada `code`, bukan mem-parsing pesan". Sisi Node tidak pernah melakukannya —
-- `ai-service.client.ts` membaca `res.status` lalu menjejalkan seluruh badan
-- respons ke dalam STRING pesan, dan `ai_jobs` cuma punya `error_message text`
-- untuk menampungnya.
--
-- Akibatnya satu-satunya cara mengetahui galat apa yang terjadi adalah
-- mem-parsing teks — hal yang dilarang eksplisit CLAUDE.md ("Kode error adalah
-- KONTRAK. Pesan bukan."). Janji di komentar yang tidak ditegakkan apa pun,
-- dan ia akan tetap terbaca benar selama tidak ada yang mencobanya.
--
-- ── Kenapa kolom, bukan sekadar mem-parse di Node ──
--
-- Isu #184: token yang tidak cocok antara service `api` dan `ai` membuat SETIAP
-- `ai_job` ditandai gagal, dan satu-satunya jejaknya `error_message` yang
-- menyebut 401 di tengah kalimat. Membedakan "kredensial salah" dari "dokumen
-- ditolak" lewat `LIKE '%401%'` adalah pencarian yang akan salah pada hari
-- pesannya diterjemahkan. `SA-03` (kesehatan integrasi) membaca tabel ini, dan
-- ia pantas bisa menghitung per kode.
--
-- ── Nullable, dan itu bukan kompromi ──
--
-- Job yang `done` tidak punya kode galat; job `failed` dari sebelum migrasi ini
-- juga tidak. `NOT NULL DEFAULT ''` akan membuat "tidak ada kode" dan "kodenya
-- string kosong" tidak bisa dibedakan — kelas yang sama dengan `APP_URL=`
-- kosong yang dibaca `??`. Expand/contract: nol baris perlu di-backfill, dan
-- tidak ada kode yang berhenti memakai kolom lain.
--
-- `text`, bukan enum: kodenya datang dari layanan LAIN. Enum berarti setiap kode
-- baru di sisi Python butuh migrasi di sisi Node sebelum galatnya bisa dicatat —
-- dan galat yang tidak bisa dicatat adalah galat yang hilang. Daftar TERTUTUP
-- §10.2 ditegakkan di batas KLIEN, bukan di kolom diagnosis.

ALTER TABLE ai_jobs ADD COLUMN error_code text;

COMMENT ON COLUMN ai_jobs.error_code IS
  'Kode galat dari layanan AI (bentuk §10.1), apa adanya — isu #190. NULL = tidak ada kode (job sukses, atau kegagalan jaringan yang tidak punya badan respons). BUKAN daftar tertutup §10.2: ini kolom diagnosis, dan penyaringan ke kode kontrak terjadi saat disajikan ke klien.';
