-- 002_squad_capacity_trigger.sql
--
-- Isu #26: batas anggota squad dinaikkan dari lapisan service ke database.
--
-- `squads_max_members_range` di 001_init.sql hanya membatasi NILAI KOLOM
-- `max_members` ke 8-12. Ia TIDAK membatasi jumlah anggota sungguhan —
-- PostgreSQL tidak bisa menyatakan "jumlah baris terkait <= nilai kolom"
-- sebagai CHECK, karena CHECK hanya boleh melihat baris itu sendiri.
--
-- Akibatnya batas 12 anggota hanya dijaga `SquadService.join()`. Kode apa pun
-- yang menulis `squad_members` langsung — Retool, skrip perbaikan data, psql
-- manual — membocorkannya TANPA SUARA: tidak ada error, tidak ada log, squad
-- ke-13 hanya ada di sana.
--
-- Bandingkan dengan batas satunya di tabel yang sama: "satu squad aktif per
-- pengguna" dijaga partial unique index `squad_members_one_active`, jadi aman
-- dari jalur mana pun. Migrasi ini menyamakan tingkat penjagaan keduanya.

CREATE OR REPLACE FUNCTION squad_members_capacity() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  max_m integer;
  cur   integer;
BEGIN
  -- Baris yang sudah keluar tidak memakan kursi.
  IF NEW.left_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- UPDATE yang tidak mengubah keanggotaan aktif: kursinya sudah ditempati,
  -- menghitung ulang di sini akan salah menolak baris yang sudah sah.
  IF TG_OP = 'UPDATE' AND OLD.left_at IS NULL AND OLD.squad_id = NEW.squad_id THEN
    RETURN NEW;
  END IF;

  -- Kunci baris squad DULU. Ini titik serialisasi per squad, dan satu-satunya
  -- alasan kursi terakhir tidak bisa diisi dua transaksi sekaligus. Tanpa
  -- kunci ini, sepuluh insert bersamaan sama-sama membaca "7 anggota".
  SELECT s.max_members INTO max_m FROM squads s WHERE s.id = NEW.squad_id FOR UPDATE;

  -- Squad tidak ada: biarkan foreign key yang menolak, dengan pesannya sendiri.
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- `m.id <> NEW.id` membuat fungsi ini benar untuk INSERT maupun UPDATE:
  -- default kolom sudah terisi sebelum trigger BEFORE berjalan, jadi baris
  -- yang sedang ditulis tidak pernah menghitung dirinya sendiri.
  SELECT count(*) INTO cur
    FROM squad_members m
   WHERE m.squad_id = NEW.squad_id
     AND m.left_at IS NULL
     AND m.id <> NEW.id;

  IF cur >= max_m THEN
    RAISE EXCEPTION 'squad_members_capacity: squad % sudah penuh (% dari %)',
      NEW.squad_id, cur, max_m
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END $$;

-- BEFORE INSERT OR UPDATE, bukan INSERT saja: bergabung ulang setelah keluar
-- bisa ditulis sebagai UPDATE `left_at = NULL`, dan jalur itu harus dijaga
-- juga. `squad_members_one_active` menahan sebagian kasusnya, tapi bukan
-- kasus "squad penuh".
DROP TRIGGER IF EXISTS squad_members_capacity ON squad_members;
CREATE TRIGGER squad_members_capacity
  BEFORE INSERT OR UPDATE OF squad_id, left_at ON squad_members
  FOR EACH ROW EXECUTE FUNCTION squad_members_capacity();

COMMENT ON FUNCTION squad_members_capacity() IS
  'Isu #26. Menegakkan jumlah anggota aktif <= squads.max_members, yang tidak bisa dinyatakan sebagai CHECK. Mengunci baris squads untuk serialisasi.';
