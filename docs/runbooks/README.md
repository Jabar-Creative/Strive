# Runbook insiden

Tiga skenario yang wajib punya runbook sebelum rilis — `docs/PRD.md` §17.3, item `R-04`.

Runbook ditulis untuk dibaca **saat panik**, bukan saat santai. Karena itu bentuknya
langkah bernomor, bukan penjelasan; dan setiap langkah menyebut **cara memastikannya
berhasil**, bukan hanya cara menjalankannya. Langkah yang tidak bisa diverifikasi adalah
langkah yang membuat orang mengulanginya terus karena tidak tahu apakah sudah beres.

| Skenario | Berkas |
|---|---|
| Redis mati | [`redis-mati.md`](redis-mati.md) |
| Vendor scan down | [`vendor-scan-down.md`](vendor-scan-down.md) |
| Biaya LLM melonjak | [`biaya-llm-melonjak.md`](biaya-llm-melonjak.md) |
| Rollback staging | [`rollback-staging.md`](rollback-staging.md) |

## Yang berlaku untuk ketiganya

**Jangan mulai dari perbaikan.** Mulai dari satu perintah yang memberi tahu seberapa
luas kerusakannya. Perbaikan yang dijalankan tanpa itu sering memperbaiki gejala yang
salah.

**Rekonsiliasi koin adalah pemeriksaan terakhir, selalu.** Aturan keras 2:
`users.coin_balance` cuma cache, kebenarannya `SUM(coin_ledger)`. Insiden apa pun yang
menyentuh koin harus diakhiri dengan selisih nol.

```bash
# Selisih rekonsiliasi — harus NOL baris.
psql "$DATABASE_URL" -c "
  SELECT u.id, u.coin_balance, COALESCE(SUM(l.amount), 0) AS ledger
  FROM users u LEFT JOIN coin_ledger l ON l.user_id = u.id
  GROUP BY u.id, u.coin_balance
  HAVING u.coin_balance <> COALESCE(SUM(l.amount), 0);"
```

**Jangan menambal angka.** Kalau selisihnya tidak nol, yang dicari **penyebabnya** —
ada kode yang menulis saldo di luar `CoinLedgerService`. Koreksi ditulis sebagai entri
`adjust` baru, tidak pernah sebagai `UPDATE` (trigger database menolaknya).

## Yang BELUM ada, dan jangan dikira ada

- **Penjadwal.** Tidak ada job yang berjalan sendiri — `ReconcileBalanceService`,
  `LeagueRollupService`, `PartitionService`, `releaseStale()`, dan `MetricsService`
  semuanya dipanggil manual. Runbook di bawah menyebutkan cara memanggilnya.
- **Agregator log.** `error_rate_5xx` dan `p95_latency_hub` (§17.2) belum bisa dihitung;
  sumbernya sudah ada di log per-request, yang mengagregasinya bagian `F-05`.
- **Staging hidup.** Lingkungan sudah disiapkan (Railway `strive-staging` +
  Vercel `strive-staging-web`) dan prosedur rollback ada di
  [`rollback-staging.md`](rollback-staging.md). Deploy otomatis dari `main`
  menyusul begitu workflow-nya ada di branch default. Belum ada bukti V1–V13
  — jangan anggap staging sudah melayani trafik. Isu #29 ditutup 2026-09-16;
  pelonggaran baris DoD "ter-deploy ke staging" di `CLAUDE.md` **tetap**,
  sampai Dev A mengumumkan staging siap. Runbook insiden di bawah ini masih
  ditulis untuk produksi dan lokal.
