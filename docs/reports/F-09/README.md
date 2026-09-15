# F-09 — bukti verifikasi wireframe page stub

**Item ini tidak menambah satu baris kode pun**, dan itu memang hasil yang benar.
Stub-nya sudah berdiri sejak kerangka awal repo. Yang belum pernah dilakukan adalah
**membuktikan** bahwa acceptance criteria-nya terpenuhi, dan itu isi item ini.

## Acceptance criteria

> Dua belas rute ada dan bisa dinavigasi, isinya placeholder.
> Tidak ada layar yang masih diperdebatkan saat implementasi dimulai.

Kalimat itu punya dua bagian, dan bagian keduanya yang lebih mudah dianggap remeh.

## Bagian 1 — dua belas rute ada dan bisa dinavigasi

Diuji terhadap server yang benar-benar berjalan, bukan dari keberadaan berkas.

| Rute | HTTP |
|---|---|
| `/login` `/register` `/reset` `/verify` | 200 · 200 · 200 · 200 |
| `/hub` `/learn` `/squad` `/clinic` | 200 · 200 · 200 · 200 |
| `/career` `/mastery` `/store` `/wallet` | 200 · 200 · 200 · 200 |

**12 dari 12 menjawab 200.** Dua konsol (`/mentor`, `/admin`) dan peta rute (`/`) juga 200,
tapi ketiganya di luar hitungan dua belas layar inti.

"Bisa dinavigasi" diuji dengan benar-benar mengklik, bukan hanya membuka URL langsung:
dari peta rute, tautan `/hub` diklik dan halaman berpindah ke `/hub` dengan judul `Hub`.
Peta rute memuat **keempat belas** tautan (12 inti + 2 konsol), nol tautan hilang.

Tampilan di 375px: tanpa scroll horizontal, navigasi membungkus (`flex-wrap: wrap`).

## Bagian 2 — tidak ada layar yang masih diperdebatkan

Ini yang sebenarnya diuji, dan caranya bukan dengan melihat layarnya.

Tiap stub **mendeklarasikan sendiri** siapa pemiliknya, item mana yang akan mengisinya,
dan bagian PRD mana yang mengatur perilakunya. Layar yang masih diperdebatkan akan
kelihatan sebagai referensi yang menggantung: item yang tidak ada di backlog, atau
bagian PRD yang tidak pernah ditulis.

Keempat belas stub diperiksa secara otomatis terhadap `docs/BACKLOG.md` dan `docs/PRD.md`:

| Rute | Layar | Item | Dev | PRD |
|---|---|---|:---:|---|
| `/login` `/register` `/reset` `/verify` | Auth | `A-03` | B | ada |
| `/hub` | Hub | `S-03` | B | ada (2 bagian) |
| `/learn` | Belajar | `L-05` | B | ada |
| `/squad` | Squad & liga | `Q-05` | B | ada |
| `/clinic` | Klinik plagiarisme | `K-04` | B | ada |
| `/career` | Karir — ATS CV & Prompt Lab | `AI-07` | B | ada |
| `/mastery` | Mastery Track | `MT-04` | B | ada |
| `/store` | Strive Store | `ST-02` | B | ada |
| `/wallet` | Dompet | `C-03` | B | ada (2 bagian) |
| `/mentor` | Konsol mentor | `PR-04` | B | ada |
| `/admin` | Konsol superadmin | `SA-04` | B | ada |

**Referensi bermasalah: 0.** Setiap layar punya pemilik, punya item backlog yang nyata,
dan punya bagian PRD yang benar-benar ada. Tidak ada layar yatim, dan tidak ada item
backlog layar yang tidak punya tempat mendarat.

## Catatan

- **404 `/favicon.ico` masih muncul di konsol pada branch ini.** Itu bukan cacat F-09.
  Perbaikannya (`apps/web/app/icon.svg`) ada di PR #12 milik `F-06` yang belum ter-merge.
- Stub sengaja belum memakai token warna Strive maupun komponen `packages/ui`.
  Komentar di `page-stub.tsx` menyatakan itu eksplisit: yang dibuktikan stub ini hanya
  satu hal, rutenya ada dan bisa dinavigasi. Pengisian visualnya `F-06` dan `F-07`.
