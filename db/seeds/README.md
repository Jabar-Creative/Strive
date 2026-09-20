# db/seeds

Dua jalur berbeda, jangan tertukar:

| Perintah                   | Isi                                                       | Item   |
| -------------------------- | --------------------------------------------------------- | ------ |
| `pnpm seed`                | `pricing_config` versi awal, 1 track contoh, 8 item store | `F-13` |
| `pnpm seed:content <file>` | Impor kartu belajar dari CSV/JSON                         | `F-11` |

> **Dulu ada ketidakkonsistenan di sini, sekarang tidak lagi.** Sampai 20 September 2026
> berkas ini mengatribusikan `pnpm seed` ke `F-04`, padahal acceptance criteria resmi `F-04`
> tidak pernah menyebutnya dan `F-04` sudah `done`. Perintahnya jadi yatim: ada di
> dokumentasi, tidak ada di backlog. Sekarang ia item sungguhan — **`F-13`** (isu #69),
> diimplementasikan di [`seed-dev.mjs`](./seed-dev.mjs).

`pnpm seed:content` (`F-11`, Dev B) diimplementasikan di
[`seed-content.mjs`](./seed-content.mjs). `pnpm seed` (`F-13`, Dev A) di
[`seed-dev.mjs`](./seed-dev.mjs). Keduanya idempoten dan tidak pernah saling
menyentuh: yang satu data dev, yang satu konten belajar.

## Batas yang perlu diketahui: konten yang sudah dikerjakan orang

Strategi hapus-lalu-sisip-ulang untuk `modules`/`lessons`/`lesson_cards`
bekerja **selama belum ada pengguna yang mengerjakan lesson-nya.**

Foreign key `lesson_attempts.lesson_id → lessons` bersifat **`ON DELETE NO
ACTION`** (diverifikasi langsung di skema), berbeda dari tiga FK konten lain
yang `CASCADE`. Jadi begitu satu attempt ada, `DELETE` lesson-nya **ditolak
database**, dan karena seluruh impor dibungkus satu transaksi, **DELETE-nya
ikut di-rollback** — tidak ada kerusakan sebagian.

Itu perilaku yang benar, bukan bug: riwayat belajar orang tidak boleh lenyap
karena seseorang menjalankan ulang skrip seed. Tapi artinya **"impor ulang
idempoten" hanya berlaku sebelum konten itu dipakai.** Di staging dan produksi,
koreksi konten yang sudah dikerjakan orang butuh migrasi konten tersendiri,
bukan `pnpm seed:content`.

Ditemukan saat review Dev A atas PR #41.

## Aturan

- **Impor ulang wajib idempoten.** Menjalankan `pnpm seed:content` dua kali
  untuk file yang sama tidak boleh menggandakan kartu.
- **Konten masuk lewat pipeline, bukan diketik manual ke DB** (`F-11`).
- Angka di `pricing_config` mengikuti `docs/PRD.md` §6 dan **delapan keputusan
  produk di §5**. **§5 berstatus TERKUNCI sejak 14 September 2026**, jadi angka
  seed boleh ditulis final — 1 koin = Rp 25, scan 2.400, cache hit 240,
  CV 400, wawancara 300, statement 500, prompt run 20, kredit freeze 200.
- Yang **belum** final: biaya vendor Copyleaks di `PRD.md` §6.4 masih ilustrasi.
  Itu tidak mengubah harga seed (harga ke pengguna terkunci), tapi mengubah
  perhitungan margin. Lihat "Dua kewajiban yang TIDAK ikut terkunci" di §5.

## Format file `seed:content`

Satu file = **satu track lengkap** (track -> modules -> lessons -> lesson_cards).
Dua format didukung, dipilih otomatis dari ekstensi file:

| Format  | Cocok untuk                                                                | Contoh                          |
| ------- | -------------------------------------------------------------------------- | ------------------------------- |
| `.json` | Fixture yang ditulis developer, hierarki asli, gampang divalidasi          | `content/contoh-track.json`     |
| `.csv`  | Tim konten non-developer (spreadsheet), lihat "Peringatan jadwal" di bawah | `content/contoh-track-mini.csv` |

Kedua format diparsing ke struktur normal yang sama lalu divalidasi dengan
satu fungsi (`validateContent` di `seed-content.mjs`) sebelum satu baris SQL
pun dijalankan — jadi tidak ada dua implementasi aturan bisnis yang bisa
berbeda-beda.

### Format JSON

```json
{
  "track": {
    "slug": "content-writing-dasar", // wajib, unik, huruf kecil/angka/tanda hubung
    "title": "Content Writing Dasar", // wajib
    "description": "...", // opsional
    "category": "Content", // opsional
    "isPublished": true, // opsional, default false
    "sortOrder": 1 // opsional, default 0
  },
  "modules": [
    {
      "title": "Riset & Ide", // wajib
      "sortOrder": 1, // opsional, default = index
      "lessons": [
        {
          "title": "...", // wajib
          "estSeconds": 150, // opsional, default 150 (target 120-180, LE-1)
          "basePoints": 10, // opsional, default 10
          "baseCoins": 20, // opsional, default 20
          "sortOrder": 1, // opsional, default = index
          "cards": [
            {
              "kind": "multiple_choice", // atau: swipe_binary, order_steps, reveal
              "prompt": "...", // wajib
              "sortOrder": 1, // opsional, default = index
              "options": [
                // minimal 2, minimal 1 correct=true
                { "id": "a", "text": "...", "correct": true, "why": "..." },
                { "id": "b", "text": "...", "correct": false, "why": "..." }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

`content` jsonb di `lesson_cards` selalu berbentuk `{ options: [...] }` —
sama untuk semua `kind`, mengikuti komentar skema di
`db/migrations/001_init.sql`. `kind: order_steps`/`reveal` boleh diimpor
(ada di enum `card_kind`) tapi diberi peringatan non-fatal karena belum
dirender UI v0.1 (docs/PRD.md §14).

### Format CSV

Satu baris = **satu kartu**. Kolom track/module/lesson diulang tiap baris
(gaya ekspor spreadsheet) — isi ulang hanya wajib di baris PERTAMA tempat
track/module/lesson itu muncul, baris berikutnya boleh dikosongkan asal
`track_slug`, `module_title`, `lesson_title` tetap diisi konsisten (dipakai
sebagai kunci pengelompokan).

Header wajib (urutan bebas, kolom `option_2..4_*` dan kolom opsional lain
boleh dikosongkan per sel, tapi HEADER-nya harus tetap ada):

```
track_slug, track_title, track_description, track_category, track_is_published, track_sort_order,
module_title, module_sort_order,
lesson_title, lesson_est_seconds, lesson_base_points, lesson_base_coins, lesson_sort_order,
card_kind, card_prompt, card_sort_order,
option_1_id, option_1_text, option_1_correct, option_1_why,
option_2_id, option_2_text, option_2_correct, option_2_why,
option_3_id, option_3_text, option_3_correct, option_3_why,
option_4_id, option_4_text, option_4_correct, option_4_why
```

Lihat `content/contoh-track-mini.csv` untuk contoh nyata (termasuk field
yang mengandung koma, dikutip dengan tanda kutip ganda).

**Batasan yang disengaja (bukan bug tersembunyi):**

- Satu file CSV = satu track. Baris dengan `track_slug` berbeda = error.
- Maksimal **4 opsi** per kartu (`option_1`..`option_4`). Butuh lebih → pakai JSON.
- Boolean (`*_is_published`, `option_N_correct`) hanya menerima
  `true`/`false`/`1`/`0` (case-insensitive). Nilai lain = error, bukan ditebak.
- Field CSV **tidak boleh berisi newline literal di dalam sel** — parser di
  sini sengaja sederhana (bukan RFC4180 penuh) supaya tidak ada dependency
  baru. Prompt/opsi multi-baris → pakai JSON.
- Judul module dan lesson **harus unik dalam satu track**, karena
  pengelompokan baris memakai judul sebagai kunci (bukan posisi baris) —
  ini yang membuat baris boleh dikosongkan/tidak berurutan sempurna.

### Idempotensi

- `tracks.slug` sudah `UNIQUE` di skema (`db/migrations/001_init.sql`) →
  dipakai sebagai kunci alami lewat `INSERT ... ON CONFLICT (slug) DO UPDATE`.
  **UPSERT, bukan `DO NOTHING`** — sengaja, supaya re-run dengan konten yang
  sudah diperbaiki (typo, opsi salah) benar-benar memperbarui baris, bukan
  cuma "tidak menggandakan tapi juga tidak mengoreksi".
- `modules` / `lessons` / `lesson_cards` **tidak punya unique constraint
  alami** di skema saat ini (bukan kolom yang boleh ditambah dari `F-11` —
  `db/migrations/` milik Dev A). Strategi: `DELETE FROM modules WHERE
track_id = $1` (CASCADE otomatis membawa lessons + lesson_cards ikut
  terhapus lewat FK), lalu insert ulang seluruhnya dari file — semua di
  **satu transaksi**, jadi kegagalan di tengah insert me-rollback DELETE-nya
  juga (tidak pernah ada track yang "ada tapi kosong").
- Dibuktikan dengan menjalankan `pnpm seed:content` dua kali ke DB yang sama
  dan membandingkan `COUNT(*)` sebelum/sesudah run kedua — lihat laporan
  verifikasi F-11.

## Peringatan jadwal

±90 kartu konten **bukan pekerjaan developer** dan tidak ada di 72,5 dev-hari.
Ini penyumbat yang paling sering menjatuhkan rencana seperti ini —
`docs/DELIVERY-PLAN.md` §6 dan §10.
