# Runbook — Redis mati

PRD §17.3 skenario 1.

**Gejala.** Papan liga kosong atau basi; event realtime berhenti; rate limit berhenti
membatasi (ia **sengaja** membiarkan lewat saat Redis mati — `R-03`); job AI berhenti
diproses.

**Yang TIDAK terjadi.** Tidak ada data yang hilang. Redis adalah **turunan** (aturan
keras 7): seluruh isinya bisa dibangun ulang dari Postgres. **Tidak perlu maintenance
mode.**

## 1 · Pastikan Postgres sehat DULU

Kalau Postgres juga sakit, ini bukan insiden Redis dan langkah di bawah akan menutupi
penyebab sebenarnya.

```bash
psql "$DATABASE_URL" -c "select now(), count(*) from users;"
```

## 2 · Restart Redis

```bash
docker compose restart redis          # lokal
redis-cli -u "$REDIS_URL" ping        # harus PONG
```

## 3 · Bangun ulang papan liga

Papan squad (`lb:sq:<season>:<squad>`) hilang bersama Redis. `rebuildAllSquads()`
menyusunnya ulang dari `squad_members.weekly_points` di Postgres.

> Belum ada penjadwal, jadi ini dipanggil manual. Lihat
> `LeaderboardService.rebuildAllSquads` di `apps/api/src/modules/league/`.

## 4 · Verifikasi papan

Bandingkan satu squad antara Redis dan Postgres. Keduanya **harus** sama; kalau tidak,
rebuild-nya belum jalan atau musimnya salah.

```bash
redis-cli -u "$REDIS_URL" zrange "lb:sq:<season_id>:<squad_id>" 0 -1 WITHSCORES
psql "$DATABASE_URL" -c "
  SELECT user_id, weekly_points FROM squad_members
  WHERE squad_id = '<squad_id>' AND left_at IS NULL ORDER BY weekly_points DESC;"
```

## 5 · Periksa job AI yang tertinggal

Ini bagian yang paling mudah terlewat. Hitungan percobaan ulang `ai_jobs` disimpan
**BullMQ, yaitu di Redis** (`AI-06`). Job yang sedang menunggu jadwal percobaan
berikutnya saat Redis mati **lenyap**, dan barisnya tertinggal `running` selamanya —
tidak muncul sebagai gagal maupun antre.

```sql
SELECT id, user_id, kind, created_at FROM ai_jobs
WHERE status = 'running' AND created_at < now() - interval '1 hour';
```

Baris yang muncul di sini setelah insiden Redis **tidak akan pulih sendiri**. Tandai
`failed` dengan sebab yang jelas, atau antrekan ulang — keputusan itu ada di
[isu #131](https://github.com/Jabar-Creative/Strive/issues/131), dan sampai diputuskan,
catat id-nya dan beri tahu penggunanya.

## 6 · Rekonsiliasi koin

Lihat [README](README.md). Harus nol baris.
