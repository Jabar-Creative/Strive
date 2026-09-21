-- 008_squad_season_required.sql
--
-- `squads.season_id` jadi `NOT NULL` — isu #84.
--
-- ── Apa yang dijanjikan kolom ini, dan apa yang benar-benar dijaganya ──
--
-- Migrasi 001 menulisnya `season_id uuid REFERENCES league_seasons(id)` — tanpa
-- `NOT NULL`. FK menjamin musim yang DITUNJUK itu ada; ia tidak pernah menjamin
-- ada musim yang ditunjuk sama sekali.
--
-- Squad tanpa musim bukan squad dengan papan kosong. Kunci ZSET papan peringkat
-- dibentuk dari musimnya (`lb:sq:<season_id>:<squad_id>`), jadi papannya
-- **tidak bisa dibentuk**. `league_standings` berkunci `(season_id, squad_id)`,
-- jadi ia juga tidak bisa punya baris. Dan `GET /squads/me` — yang
-- `INNER JOIN league_seasons` — akan menjawab `null`, yang terbaca "kamu belum
-- punya squad" kepada orang yang punya.
--
-- ── Kenapa sekarang, padahal nol baris melanggar ──
--
-- `Q-01` (`formSquads`) selalu mengisinya, dan hari ini itu satu-satunya jalur
-- kode yang membuat squad. Tapi "satu-satunya jalur kode" adalah jaminan yang
-- persis sama dengan yang runtuh di isu #26: kapasitas squad dijaga
-- `SquadService.join()` saja, sampai dijadikan trigger. Retool, skrip perbaikan
-- data, dan `psql` manual tidak lewat `Q-01`.
--
-- ── Yang dikunci keputusan ini ──
--
-- **Squad SELALU milik satu musim.** Tidak ada squad lintas-musim, tidak ada
-- squad "sandbox" tanpa liga. PRD §7 E5 menggambarkan squad selalu dalam
-- konteks musim, dan tidak ada satu pun aturan yang menyebut sebaliknya.
-- Kalau nanti keputusan itu berubah, ia butuh migrasi baru DAN baris di PRD —
-- bukan kolom nullable yang menunggu-nunggu.

-- Gagal berisik kalau ada baris yang melanggar, dengan JUMLAHNYA.
--
-- `SET NOT NULL` sendirian sudah akan gagal, tapi pesannya hanya menyebut
-- kolomnya. Orang yang menjalankan migrasi ini pada database yang tidak bersih
-- butuh tahu SEBERAPA banyak yang harus diperbaiki sebelum mencoba lagi.
DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM squads WHERE season_id IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION
      '% squad tidak punya season_id. Tetapkan musimnya dulu (lihat isu #84); migrasi ini tidak menebak musim untuk siapa pun.', n;
  END IF;
END $$;

ALTER TABLE squads ALTER COLUMN season_id SET NOT NULL;

COMMENT ON COLUMN squads.season_id IS
  'WAJIB sejak 008 (isu #84). Kunci ZSET papan (lb:sq:<season_id>:<squad_id>) dan PK league_standings dibentuk darinya — squad tanpa musim tidak bisa punya papan, bukan punya papan kosong.';
