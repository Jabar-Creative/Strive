# F-06 — bukti verifikasi token design system

Berbeda dengan `F-02`, item ini **tidak punya laporan HTML terpisah**, dan itu disengaja.
Artefak buktinya adalah halaman `/_specimen` itu sendiri: ia menghitung rasio kontras
saat dibuka, jadi ia tidak bisa basi seperti angka yang disalin ke dokumen.

Jalankan `pnpm dev` lalu buka <http://localhost:3000/_specimen>.

## Yang diverifikasi di browser sungguhan

| Yang diperiksa | Hasil |
|---|---|
| `/_specimen` dapat diakses | HTTP 200 |
| Konsol browser | nol error |
| Token terbaca di runtime | `--color-indigo-600` `#4f3de8`, `--color-paper` `#fbfafe` |
| Profil Student (`/hub`) | `--r-card` 18px, `--r-ctl` 999px, `--t-base` 320ms `cubic-bezier(.34,1.56,.64,1)`, `--t-cel` 640ms |
| Profil Console (`/mentor`) | `--r-card` 8px, `--r-ctl` 6px, `--t-base` 160ms `ease-out` |
| Mode gelap | token benar-benar berganti nilai, `--color-paper` jadi `#0d0b1a` |
| Lebar 375px | tanpa scroll horizontal halaman; tabel lebar punya pembungkus `overflow-x-auto` sendiri |
| `pnpm lint / typecheck / test / build` | keempatnya exit 0, 20 halaman ter-generate |

## Rasio kontras, dihitung ulang independen

Angka di bawah dihitung terpisah dari kode halaman, memakai rumus WCAG, lalu
dicocokkan dengan yang ditampilkan `/_specimen`. Keduanya sama.

| Pasangan | Terang | Gelap |
|---|---|---|
| `ink-900` di atas `paper` | 17,55:1 ✅ | 16,91:1 ✅ |
| `ink-900` di atas `surface` | 18,24:1 ✅ | 15,68:1 ✅ |
| `indigo-600` di atas `paper` | 6,38:1 ✅ | 5,62:1 ✅ |
| **`ink-500` di atas `paper`** | **4,14:1 ❌** | 5,49:1 ✅ |
| **`ink-500` di atas `surface`** | **4,30:1 ❌** | 5,09:1 ✅ |

**Acceptance criteria terpenuhi.** AC menuntut kontras **teks utama** >= 4,5:1 di kedua
mode, dan `ink-900` sebagai teks utama lolos dengan margin sangat besar.

**Tapi ada temuan yang perlu keputusan tim desain.** `ink-500` adalah teks sekunder
(caption 13px, label), dan di mode terang nilainya di bawah ambang WCAG AA untuk teks
normal. Nilai heksanya disalin persis dari `docs/PRD.md` §14.1 dan **tidak diubah** di
item ini, karena mengubah token merek bukan keputusan yang boleh diambil sendiri.
Pilihannya: gelapkan nilai terang `ink-500`, atau batasi pemakaiannya ke teks besar saja.
