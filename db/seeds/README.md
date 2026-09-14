# db/seeds

**Kosong. Ini disengaja.**

Dua jalur berbeda, jangan tertukar:

| Perintah                   | Isi                                                       | Item   |
| -------------------------- | --------------------------------------------------------- | ------ |
| `pnpm seed`                | `pricing_config` versi awal, 1 track contoh, 8 item store | `F-04` |
| `pnpm seed:content <file>` | Impor kartu belajar dari CSV/JSON                         | `F-11` |

## Aturan

- **Impor ulang wajib idempoten.** Menjalankan `pnpm seed:content` dua kali
  untuk file yang sama tidak boleh menggandakan kartu.
- **Konten masuk lewat pipeline, bukan diketik manual ke DB** (`F-11`).
- Angka di `pricing_config` mengikuti `docs/PRD.md` §6 dan **delapan keputusan
  produk di §5**. Kalau §5 belum berstatus TERKUNCI, seed harga belum boleh
  dianggap final.

## Peringatan jadwal

±90 kartu konten **bukan pekerjaan developer** dan tidak ada di 72,5 dev-hari.
Ini penyumbat yang paling sering menjatuhkan rencana seperti ini —
`docs/DELIVERY-PLAN.md` §6 dan §10.
