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
- **Staging Railway MATI sekitar 26 Okt 2026, dan runbook ini kehilangan
  sasarannya.** `api` dan `ai` menjawab `404 Application not found` dari edge
  Railway — service-nya sudah tidak ada (kredit trial habis, #151). Web di
  Vercel masih 200, tanpa backend. Pemicu otomatis
  `.github/workflows/deploy-staging.yml` **dimatikan** 28 Okt;
  `workflow_dispatch` sengaja dipertahankan supaya pipeline masih bisa diuji
  begitu infrastrukturnya ada.

  **Dua belas dari tiga belas V tetap terbukti** dan tidak dibatalkan oleh
  kematian ini: V1–V6, V9, V10, V12 (25 Sep), V7 (27 Sep, setelah #152), V11
  (28 Sep, setelah job semai #168), V8 (30 Sep, setelah `AI-01` #183).
  Baris ini sebelumnya masih menulis V11 "terblokir" — basi sejak 28 Sep, dan
  dikoreksi 28 Okt.

  **V13 (rollback < 5 menit) satu-satunya yang tersisa, dan ia sekarang
  MUSTAHIL dibuktikan** di instance ini: rollback hanya bisa diukur terhadap
  deployment yang hidup. Itu justru baris yang paling dibutuhkan runbook ini.
  `F-05` diubah `review` → `blocked` di papan. Lihat
  `docs/reports/F-05/README.md`. Pelonggaran baris DoD "ter-deploy ke staging"
  di `CLAUDE.md` **tetap**, dan sekarang tanpa pilihan lain.
- **Login ke `/mentor` dan `/admin` di staging** memulangkan siapa pun ke
  `/login`, juga pengguna yang sesinya sah. Kalau kamu sedang menangani insiden
  dan tidak bisa masuk konsol, itu sebabnya — bukan sesimu. Sebabnya **#176**,
  bukan lagi #154: cookie sesi dipasang di domain API, dan middleware berjalan
  di domain web yang tidak pernah melihatnya. Selama itu, pakai `Authorization:
  Bearer` langsung ke API — jalur itu tidak lewat middleware sama sekali.
  Runbook insiden di bawah ini masih ditulis untuk produksi dan lokal.
