# Runbook — vendor scan (Copyleaks) down

PRD §17.3 skenario 2.

**Gejala.** Scan menggantung di `queued`/`running`; pengguna melapor koinnya "hilang"
(sebenarnya **ditahan**, bukan hilang); `GET /admin/integrations/health` melaporkan
`copyleaks` sebagai `down` atau `degraded`.

**Yang TIDAK terjadi.** Koin tidak pernah hilang. Pola `hold → settle | release`
(aturan keras 4) berarti biayanya **ditahan**, dan reaper melepasnya otomatis setelah
30 menit. Tidak ada refund manual yang perlu diingat siapa pun — itu seluruh alasan
pola itu dipilih.

## 1 · Pastikan memang vendornya

```bash
curl -s -H "Authorization: Bearer <sesi superadmin>" \
  "$API_URL/api/v1/admin/integrations/health" | jq '.integrations[] | select(.vendor=="copyleaks")'
```

- `not_configured` → bukan insiden, `COPYLEAKS_API_KEY` kosong.
- `unknown` → tidak ada scan sama sekali dalam 60 menit; belum tentu vendor sakit.
- `degraded`/`down` → lanjut.

Angkanya datang dari `plagiarism_scans` kita sendiri, bukan dari ping ke Copyleaks —
jadi ia menjawab "pengguna kita sedang gagal", bukan "server mereka hidup".

## 2 · Matikan tombol scan lewat feature flag

Supaya pengguna berikutnya tidak menambah antrean hold yang akan dilepas lagi 30 menit
kemudian. PRD §19.3.

> **Catatan jujur:** infrastruktur feature flag belum ada (§19.3 belum punya item).
> Sampai ada, cara tercepat adalah mengosongkan `COPYLEAKS_API_KEY` di environment dan
> me-restart API — `ScanService` gagal cepat, dan `/admin/integrations/health` akan
> melaporkan `not_configured`, yang membedakan "kami matikan" dari "vendor mati".

## 3 · Biarkan reaper melepas hold

`ScanService.releaseStale()` melepas hold yang menggantung > 30 menit dan mengembalikan
koin **penuh** (`KL-7`/`KL-8`). Belum dijadwalkan, jadi panggil manual.

Periksa yang tertahan:

```sql
SELECT id, user_id, status, cost_coins, created_at FROM plagiarism_scans
WHERE status IN ('queued','running') AND created_at < now() - interval '30 minutes'
ORDER BY created_at;
```

## 4 · Umumkan ke pengguna yang punya scan tertahan

Daftarnya dari query di atas. Yang perlu disampaikan: **koinnya sudah kembali**, dan
dokumennya tidak perlu diunggah ulang (dedup SHA-256 akan mengenalinya).

## 5 · Saat vendor pulih

Nyalakan kembali, lalu perhatikan satu hal yang sudah pernah menggigit: hasil yang tiba
**setelah** reaper melepas hold tidak boleh menagih ulang koinnya. Itu sudah ditangani
(`K-02`, dicatat sebagai anomali, status tetap `released`) — yang perlu dilakukan cuma
memastikan tidak ada yang "memperbaiki"-nya dengan menagih ulang.

## 6 · Rekonsiliasi koin

Lihat [README](README.md). Harus nol baris — ini yang membuktikan hold benar-benar
dilepas, bukan hanya statusnya yang berubah.
