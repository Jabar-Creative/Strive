---
name: Permintaan perubahan skema
about: Butuh tabel/kolom/index baru — WAJIB lewat isu, bukan migrasi tandingan
title: 'skema: '
labels: schema, needs-decision
---

> `db/migrations/` **hanya ditulis Dev A**. Dev B menyampaikan kebutuhan skema
> sebagai isu ini — dua orang menulis migrasi paralel adalah konflik yang baru
> ketahuan saat deploy (CLAUDE.md §Kepemilikan file).

## Yang dibutuhkan

<!-- Tabel / kolom / index / constraint. Sebutkan tipe dan nullability. -->

```sql

```

## Kenapa dibutuhkan

**Item yang memblokir:** <!-- misal AI-03 -->

## Apakah sudah ada di docs/PRD.md §9?

- [ ] **Ya** — sebutkan tabelnya: <!-- ... -->
- [ ] **Tidak** — ini butuh keputusan manusia sebelum ditulis

> Kalau **Tidak**: skema yang menyimpang dari PRD adalah utang yang tidak
> terlihat (`AGENTS.md` aturan keras 4). Isu ini memblokir sampai dijawab, dan
> jawabannya ditulis balik ke `docs/PRD.md` §9 **dan** §23 catatan perubahan.

## Alternatif tanpa perubahan skema

<!-- Sudah dicoba? Kenapa tidak cukup? -->

## Kompatibilitas (expand/contract)

- [ ] Aman dijalankan saat versi lama masih berjalan
- [ ] **Tidak ada `DROP COLUMN`** di deploy yang sama dengan kode yang berhenti memakainya
- [ ] Kalau menyentuh tabel terpartisi (`lesson_attempts`): unique index memuat kolom partisi `attempt_date`
