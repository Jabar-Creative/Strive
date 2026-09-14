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
  produk di §5**. **§5 berstatus TERKUNCI sejak 14 September 2026**, jadi angka
  seed boleh ditulis final — 1 koin = Rp 25, scan 2.400, cache hit 240,
  CV 400, wawancara 300, statement 500, prompt run 20, kredit freeze 200.
- Yang **belum** final: biaya vendor Copyleaks di `PRD.md` §6.4 masih ilustrasi.
  Itu tidak mengubah harga seed (harga ke pengguna terkunci), tapi mengubah
  perhitungan margin. Lihat "Dua kewajiban yang TIDAK ikut terkunci" di §5.

## Peringatan jadwal

±90 kartu konten **bukan pekerjaan developer** dan tidak ada di 72,5 dev-hari.
Ini penyumbat yang paling sering menjatuhkan rencana seperti ini —
`docs/DELIVERY-PLAN.md` §6 dan §10.
