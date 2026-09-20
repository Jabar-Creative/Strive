# AGENTS.md — Protokol Agent Strive Academy

**Wajib dibaca di awal setiap sesi, sebelum apa pun.**

Dokumen ini mengatur bagaimana agent bekerja di repo ini. `CLAUDE.md` mengatur *bagaimana menulis kode*; file ini mengatur *bagaimana memilih, mengerjakan, dan melaporkan pekerjaan*.

---

## Identitas sesi

Setiap sesi harus tahu ia bekerja sebagai siapa. Kalau prompt tidak menyebutnya, **tanyakan sebelum melakukan apa pun**.

```
Aku adalah agent untuk: Dev A  |  Dev B
Antrean kerjaku:        docs/TASKS-DEV-A.md  |  docs/TASKS-DEV-B.md
```

Agent Dev A **tidak boleh** mengerjakan item milik Dev B, dan sebaliknya. Kalau item yang dibutuhkan milik developer lain dan belum selesai, itu **blocker**, bukan undangan untuk mengerjakannya.

---

## Protokol sembilan langkah

Jalankan **berurutan, setiap sesi, tanpa melompat**.

### 1 · Orientasi

Baca, dalam urutan ini:

| File | Untuk apa |
|---|---|
| `AGENTS.md` | File ini — protokol kerja |
| `CLAUDE.md` | Sepuluh aturan yang tidak boleh dilanggar, konvensi kode |
| `docs/BACKLOG.md` → **Papan status** | Keadaan pekerjaan saat ini |
| `docs/TASKS-DEV-<X>.md` | Antrean kerja developer ini |

Jangan membaca seluruh PRD di langkah ini. PRD dibaca **setelah** item dipilih, hanya bagian yang relevan.

### 2 · Verifikasi silang — **jangan percaya papan status**

Papan status adalah klaim, bukan bukti. Sesi sebelumnya bisa terputus di tengah, atau menandai `done` tanpa menyelesaikan.

Untuk **setiap** item yang papan bilang `done` atau `in_progress`, periksa:

```bash
git log --oneline --all | grep -i "^[a-f0-9]* <ID>:"   # ada commitnya?
git status --short                                      # ada kerja belum ter-commit?
```

Lalu periksa isinya:

- Apakah file yang dijanjikan item itu benar-benar ada?
- Apakah ada test untuk acceptance criteria-nya?
- Apakah `pnpm test` hijau untuk test itu?

**Kalau papan bilang `done` tapi bukti tidak ada:**

1. Ubah statusnya jadi `todo` atau `in_progress` sesuai kenyataan
2. Isi kolom Catatan: `koreksi otomatis <tanggal>: ditandai done tanpa bukti`
3. **Laporkan ke manusia di akhir sesi** — ini sinyal ada sesi yang gagal diam-diam

**Kalau ada kerja belum ter-commit dari sesi sebelumnya:** jangan hapus. Laporkan, tanyakan apakah dilanjutkan atau dibuang.

### 3 · Pilih satu item

Ambil item pertama yang memenuhi **semua** syarat:

- Milik developer ini (atau bertanda `AB`)
- Statusnya `todo`
- **Seluruh** dependensinya berstatus `done` — dan bukti langkah 2 mendukungnya
- Minggu paling rendah lebih dulu; kalau seri, urut ID

**Satu sesi = satu item.** Jangan mengambil dua, sebesar apa pun godaannya.

Kalau tidak ada item yang memenuhi syarat:

- Kalau ada item `blocked` menunggu developer lain → laporkan daftarnya dan **berhenti**
- Kalau seluruh item developer ini `done` → laporkan dan **berhenti**
- Jangan mengerjakan item developer lain. Jangan mengarang pekerjaan baru.

### 4 · Konfirmasi sebelum menulis kode

Tulis di awal respons, sebelum satu baris kode pun:

```
ITEM      : <ID> — <judul>
DEV       : A | B
MINGGU    : W<n>        ESTIMASI: <n> hari
DEPENDENSI: <ID> (done ✓ commit abc1234), <ID> (done ✓ commit def5678)
ATURAN CLAUDE.md YANG BERLAKU:
  - <nomor aturan> — <bagaimana aku mematuhinya>
BAGIAN PRD YANG KUBACA: §<x>, §<y>
ACCEPTANCE CRITERIA:
  1. <salin dari backlog>
  2. ...
RENCANA: <3-5 kalimat>
```

Kalau ada dependensi yang tidak `done`, **berhenti di sini** dan laporkan.

### 5 · Ubah status jadi `in_progress`

Sebelum mulai menulis, perbarui papan status di `docs/BACKLOG.md`:

```
| `C-01` | CoinLedgerService… | A | W2 | 2 | `in_progress` | — | 2026-09-15 | — |
```

Commit perubahan papan ini terpisah: `chore(backlog): C-01 → in_progress`.

Ini penting kalau sesi terputus — sesi berikutnya tahu ada yang sedang dikerjakan.

### 6 · Kerjakan — test dulu

1. Tulis test untuk setiap acceptance criteria **sebelum** implementasi
2. Pastikan test gagal dulu (merah) — test yang hijau sejak awal tidak menguji apa pun
3. Implementasikan sampai hijau
4. Jalankan: `pnpm lint && pnpm typecheck && pnpm test`

### 7 · Buktikan, jangan klaim

Untuk **setiap** acceptance criteria, tunjukkan **output perintah yang benar-benar dijalankan**. Bukan kalimat "sudah sesuai".

```
AC-1: UPDATE coin_ledger ditolak trigger
  $ pnpm test coin-ledger.integration -t "immutable"
  ✓ menolak UPDATE dengan exception 'coin_ledger bersifat append-only'  (124ms)

AC-2: dua request paralel debit 80 dari saldo 100
  $ pnpm test coin-ledger.integration -t "concurrent"
  ✓ satu berhasil, satu INSUFFICIENT_COINS, saldo akhir 20  (311ms)
```

**Acceptance criteria yang tidak bisa dibuktikan = item belum selesai.** Jangan ditandai `done`.

### 8 · Update papan status

Hanya setelah langkah 7 lengkap:

```
| `C-01` | CoinLedgerService… | A | W2 | 2 | `done` | `a1b2c3d` | 2026-09-15 | — |
```

Perbarui juga tabel **Ringkasan progres** di bawah papan.

#### Ringkasan progres **dihitung**, tidak ditulis tangan

`docs/BACKLOG.md` adalah satu file, jadi dua item yang dikerjakan di branch berbeda
pasti bertabrakan di tabel ini. **Bahayanya bukan konfliknya, tapi resolusinya:**
memilih salah satu sisi menghasilkan file yang ter-merge bersih, lulus CI, dan
angkanya salah — tanpa ada yang menyadarinya.

Sudah terjadi **dua kali** (PR #4 dan PR #19). Kedua kalinya, **tidak ada sisi yang benar**.

Selesaikan baris itemnya dulu, lalu hitung ulang seluruh ringkasan dari baris papan:

```bash
python3 - <<'EOF'
import pathlib, re, collections
p = pathlib.Path('docs/BACKLOG.md'); s = p.read_text()
assert '<<<<<<<' not in s, 'selesaikan dulu konflik baris itemnya'
n = collections.Counter(); hari = collections.Counter(); total = 0.0
for l in s.splitlines():
    if not re.match(r'^\| `[A-Z]+-\d+` \|', l): continue
    c = [x.strip() for x in l.split('|')[1:-1]]
    if len(c) != 9: continue
    st = c[5].strip('`'); d = float(c[4].replace(',', '.'))
    n[st] += 1; hari[st] += d; total += d
f = lambda x: f'{x:.1f}'.replace('.', ',')
blok = ['| | Jumlah | Dev-hari |', '|---|---:|---:|', f'| Total | {sum(n.values())} | {f(total)} |']
for st in ['done', 'review', 'in_progress', 'blocked', 'todo']:
    blok.append(f'| `{st}` | {n[st]} | {f(hari[st])} |')
awal = s.index('| | Jumlah | Dev-hari |'); akhir = s.index('\n\n', awal)
p.write_text(s[:awal] + '\n'.join(blok) + s[akhir:])
# INI yang menangkap baris item yang hilang saat resolusi konflik — bukan mata.
assert sum(n.values()) == 76, f'jumlah item {sum(n.values())}, harus 76'
# Hari juga. Baris item yang ANGKA HARINYA berubah tidak mengubah jumlah item,
# jadi assert di atas sendirian meloloskannya — dan itu benar-benar terjadi:
# header backlog menyimpang jadi 73,0 sementara barisnya berjumlah 74,5,
# diam-diam, selama seminggu.
assert abs(total - 75.5) < 0.01, f'total {total} dev-hari, harus 75,5'
print('\n'.join(blok))
EOF
```

Total harus tetap **76 item / 75,5 dev-hari**. Kedua `assert` itu bukan hiasan, dan
masing-masing sudah menangkap kegagalan yang berbeda:

- **Jumlah item.** Saat merge `main` ke `c-01` (16 Sep), resolusi konflik **menjatuhkan
  baris papan `F-12`** — bagian detailnya dan catatan rencananya selamat, barisnya tidak.
  Yang menangkapnya angka 74, bukan mata.
- **Jumlah hari.** Sampai 20 Sep header backlog menulis `73,0 dev-hari` sementara barisnya
  berjumlah `74,5`, dan `Dev AB` (2,5 hari) tidak terhitung sama sekali. Jumlah itemnya
  benar sepanjang waktu itu, jadi assert yang lama meloloskannya — **selama seminggu.**

> **Kalau menambah atau membuang item, ubah kedua angka di sini DAN header `BACKLOG.md`.**
> Angka yang ditulis tangan di dua tempat akan menyimpang; itulah yang baru saja terjadi.

Kalau assert-nya gagal, bandingkan daftar ID terhadap `main`:

```bash
python3 - <<'EOF'
import subprocess, re, pathlib
ids = lambda t: re.findall(r'^\| `([A-Z]+-\d+)` \|(?:[^|]*\|){8}$', t, re.M)
main = subprocess.run(['git','show','origin/main:docs/BACKLOG.md'], capture_output=True, text=True).stdout
cur = pathlib.Path('docs/BACKLOG.md').read_text()
print('hilang:', [x for x in ids(main) if x not in ids(cur)])
EOF
```

Aturan penulisan papan:

- **Hanya ubah baris item yang kamu kerjakan** (plus koreksi dari langkah 2)
- Jangan mengubah kolom ID, Item, Dev, W, Hari — itu spesifikasi, bukan status
- Kolom Bukti diisi **hash commit pendek** atau nomor PR, tidak pernah kosong untuk `done`
- Tanggal format `YYYY-MM-DD`

### 9 · Commit dan lapor

```bash
git add -A
git commit -m "<ID>: <perubahan singkat>"
```

#### PR bertumpuk: **jangan** `--delete-branch`

Kalau PR-mu memakai `--base` selain `main`, ia bagian dari sebuah stack.

Menghapus branch dasar **menutup otomatis** PR yang menargetkannya, dan **PR yang
sudah tertutup tidak bisa dibuka ulang maupun diubah base-nya.** Sudah terjadi:
menghapus `f-04-migrasi-init` menutup PR #6, yang lalu butuh PR pengganti #11 dan
kehilangan seluruh riwayat diskusinya.

```bash
gh pr merge <n> --squash                  # BENAR untuk PR bertumpuk
gh pr merge <n> --squash --delete-branch   # SALAH — menutup PR di atasnya
```

Merge dari **bawah ke atas**, hapus branch-nya belakangan setelah seluruh stack masuk.

Lebih baik lagi: **jangan bikin stack.** Aturan keras 1 ("satu sesi, satu item") sudah
mencegahnya kalau dipatuhi — stack muncul justru ketika sesi berikutnya jalan sebelum
PR sebelumnya ter-review.

Laporan akhir sesi, wajib memuat empat bagian:

```
SELESAI
  <ID> — <judul>. Bukti: <commit>. Seluruh <n> acceptance criteria terbukti.

KUPUTUSKAN SENDIRI
  - <hal yang tidak tercakup dokumen, dan pilihanku>
  (tulis "tidak ada" kalau memang tidak ada — jangan dikosongkan)

BISA RUSAK KARENA PERUBAHAN INI
  - <apa yang mungkin terpengaruh>

BERIKUTNYA
  <ID> — <judul>. Dependensi: <status>.
  (atau: "tidak ada item yang siap, menunggu <ID> dari Dev <X>")
```

---

## Aturan keras

| # | Aturan | Kenapa |
|---|---|---|
| 1 | **Satu sesi, satu item** | Item yang dikerjakan paruh-paruh tidak pernah selesai dan tidak bisa direview |
| 2 | **Jangan pernah tandai `done` tanpa bukti yang dijalankan** | Papan status yang berbohong lebih buruk daripada papan kosong |
| 3 | **Jangan sentuh file milik developer lain** | Lihat tabel kepemilikan di `CLAUDE.md` |
| 4 | **Jangan tambah tabel/kolom di luar `docs/PRD.md` §9 tanpa bertanya** | Skema yang menyimpang dari PRD adalah utang yang tidak terlihat |
| 5 | **Jangan bangun yang sudah diputuskan dibeli** | Auth, checkout, panel admin — lihat `CLAUDE.md` |
| 6 | **Temukan bug di item lain → catat, jangan perbaiki** | Perbaikan di luar scope membuat PR tidak bisa direview |
| 7 | **Kalau dokumen tidak menjawab → BERHENTI dan tanya** | Keputusan diam-diam adalah sumber penyimpangan terbesar |
| 8 | **Jangan `git push --force`, jangan rebase `main`** | — |
| 9 | **Jangan commit secret, `.env`, atau kredensial** | — |
| 10 | **Jangan ubah estimasi, ID, atau urutan minggu di backlog** | Itu keputusan manusia, bukan agent |
| 11 | **Konflik di tabel Ringkasan progres TIDAK PERNAH diselesaikan dengan memilih satu sisi** | Memilih satu sisi menghasilkan file yang ter-merge bersih, lulus CI, dan **angkanya salah** — lihat langkah 8 |
| 12 | **PR bertumpuk: jangan `--delete-branch` sampai seluruh stack ter-merge** | Menghapus branch dasar **menutup otomatis** PR di atasnya, dan PR tertutup tidak bisa dibuka ulang |
| 13 | **PR Dev A di-merge tanpa reviewer; PR Dev B di-review Dev A** | Dua orang, satu arah review. Keputusan Dev A 2026-09-16 (isu #34) — lihat catatan di `CLAUDE.md` Definition of Done soal apa yang hilang |

---

## Kapan harus berhenti dan bertanya

Berhenti, tulis pertanyaannya, tunggu manusia. **Jangan menebak.**

1. Perubahan menyentuh `coin_ledger`, `streaks`, atau transaksi `POST /attempts` dengan cara yang tidak dijelaskan PRD
2. Butuh tabel atau kolom yang tidak ada di `docs/PRD.md` §9
3. Butuh memanggil vendor yang tidak ada di `docs/PRD.md` §12
4. Acceptance criteria di backlog terasa bertentangan dengan PRD
5. Dependensi item ini `done` di papan tapi buktinya tidak ada di repo
6. Ada kerja belum ter-commit dari sesi sebelumnya yang tidak kamu kenali
7. Muncul dorongan membangun sesuatu yang sudah diputuskan untuk dibeli
8. Item ini ternyata butuh lebih dari 2× estimasinya

Untuk nomor 8, jangan diam-diam lanjut sampai selesai. Laporkan selisihnya — itu data yang dibutuhkan checkpoint minggu 5.

---

## Ringkasan alur

```
   ┌─────────────────────────────────────────────────────────┐
   │ 1 ORIENTASI   AGENTS.md · CLAUDE.md · papan · antrean    │
   └───────────────────────────┬─────────────────────────────┘
                               ▼
   ┌─────────────────────────────────────────────────────────┐
   │ 2 VERIFIKASI  git log + isi repo vs papan                │
   │               papan salah? koreksi + laporkan            │
   └───────────────────────────┬─────────────────────────────┘
                               ▼
   ┌─────────────────────────────────────────────────────────┐
   │ 3 PILIH       todo · dependensi done · minggu terendah   │
   │               tidak ada yang siap? BERHENTI, laporkan    │
   └───────────────────────────┬─────────────────────────────┘
                               ▼
   ┌─────────────────────────────────────────────────────────┐
   │ 4 KONFIRMASI  item · dependensi · aturan · AC · rencana  │
   │               dependensi kurang? BERHENTI                │
   └───────────────────────────┬─────────────────────────────┘
                               ▼
   ┌─────────────────────────────────────────────────────────┐
   │ 5 in_progress → papan + commit terpisah                  │
   └───────────────────────────┬─────────────────────────────┘
                               ▼
   ┌─────────────────────────────────────────────────────────┐
   │ 6 KERJAKAN    test merah dulu → implementasi → hijau     │
   └───────────────────────────┬─────────────────────────────┘
                               ▼
   ┌─────────────────────────────────────────────────────────┐
   │ 7 BUKTIKAN    output nyata tiap AC, bukan klaim          │
   │               tidak terbukti? BUKAN done                 │
   └───────────────────────────┬─────────────────────────────┘
                               ▼
   ┌─────────────────────────────────────────────────────────┐
   │ 8 done        → papan + ringkasan progres                │
   └───────────────────────────┬─────────────────────────────┘
                               ▼
   ┌─────────────────────────────────────────────────────────┐
   │ 9 COMMIT + LAPOR                                         │
   │   selesai · kuputuskan sendiri · bisa rusak · berikutnya │
   └─────────────────────────────────────────────────────────┘
```

---

## Prompt pembuka sesi

Tempel ini di awal setiap sesi. Tidak perlu diubah selain nama developer.

```
Kamu agent untuk Dev A di repo Strive Academy.

Jalankan protokol AGENTS.md dari langkah 1 sampai 9.
Kerjakan SATU item berikutnya dari antrean docs/TASKS-DEV-A.md.

Jangan lewati langkah 2 (verifikasi silang) — papan status tidak boleh dipercaya
begitu saja.
```

Untuk enam item berisiko (`C-01`, `L-03`, `S-01`, `P-03`, `K-02`, `Q-02`/`Q-03`), tambahkan blok khusus dari `docs/AGENT-NOTES-RISKY-ITEMS.md`.

---

## Prompt review mingguan

Dijalankan manusia tiap Jumat, bukan oleh agent pelaksana.

```
Review akhir Minggu <N>. JANGAN menulis kode.

1. Baca papan status docs/BACKLOG.md dan verifikasi silang setiap item `done`
   minggu ini dengan git log dan isi repo. Laporkan yang tidak cocok.
2. Hitung dev-hari selesai vs direncanakan untuk minggu ini.
3. Jawab gate minggu ini (docs/DELIVERY-PLAN.md §5) dengan ya/tidak dan bukti.
4. Sebutkan item minggu depan yang dependensinya belum selesai.
5. Kalau ini akhir Minggu 5: bandingkan total W2–W5 dengan 36 dev-hari.
   Di bawah 31 → katakan terus terang bahwa pemotongan di docs/DELIVERY-PLAN.md §7
   harus dijalankan sekarang, dan sebutkan yang dipotong pertama.
6. Sebutkan utang teknis yang menumpuk dan belum tercatat.

Akhiri dengan satu paragraf terus terang: apakah jadwal masih realistis?
```
