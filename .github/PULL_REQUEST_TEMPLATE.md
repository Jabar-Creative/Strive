<!--
Judul PR WAJIB berbentuk:  <ID> — <judul item>
Contoh:                    C-01 — CoinLedgerService: write, hold, settle, release

PR tanpa ID item tidak bisa ditelusuri ke papan status. Jangan dihapus.
-->

## Item

- **ID:** <!-- C-01 -->
- **Dev:** <!-- A | B -->
- **Minggu:** <!-- W2 -->
- **Dependensi:** <!-- ID (done ✓ commit abc1234) — atau: tidak ada -->

## Acceptance criteria

<!--
Salin PERSIS dari "Selesai berarti" di docs/BACKLOG.md, satu baris per kalimat.
Centang hanya yang sudah TERBUKTI dijalankan, bukan yang diasumsikan.
-->

- [ ]
- [ ]

## Bukti test dijalankan

<!--
Tempel OUTPUT NYATA perintah yang dijalankan, satu blok per acceptance criteria.
"Sudah sesuai" bukan bukti — AGENTS.md langkah 7.
-->

```
$ pnpm test <file> -t "<nama test>"
  ✓ ...
```

- [ ] `pnpm lint` hijau
- [ ] `pnpm typecheck` hijau
- [ ] `pnpm test` hijau
- [ ] `pnpm build` hijau
- [ ] Tidak menambah peringatan TypeScript atau lint baru

## Apa yang bisa rusak

<!--
WAJIB diisi. Kalau benar-benar tidak ada, tulis "tidak ada" dan jelaskan kenapa.
Kalau PR ini menyentuh UANG atau SKEMA, tulis satu paragraf utuh —
lihat CLAUDE.md §Definition of Done.
-->

## Checklist aturan keras (CLAUDE.md)

Centang hanya yang **relevan** dengan PR ini.

- [ ] Tidak ada `UPDATE`/`DELETE` pada `coin_ledger` — koreksi lewat entri `adjust`
- [ ] Tidak ada `UPDATE users.coin_balance` di luar `CoinLedgerService`
- [ ] Efek samping berbayar memakai **hold → settle | release**, bukan debit-lalu-refund
- [ ] Tanggal harian memakai `AT TIME ZONE users.timezone`, bukan `::date` atas UTC
- [ ] Tidak ada penulisan Redis di dalam transaksi Postgres — pakai `outbox_events`
- [ ] Setiap kunci Redis baru punya fungsi rebuild dari Postgres
- [ ] Node tidak memanggil LLM langsung — lewat `ai_jobs` + AI service
- [ ] Penilaian di server; kunci jawaban dibuang di serializer
- [ ] `queue.add()` di luar `db.transaction()`
- [ ] Guard memeriksa peran; **kepemilikan** dicek di service

## Reviewer

- [ ] Di-review orang satunya — **setiap PR punya reviewer, tanpa pengecualian**
