# Dasbor Retool superadmin — `SA-04`

> **Status: BELUM SELESAI, dan ini alasannya.**
>
> Acceptance criteria `SA-04` berbunyi *"Superadmin bisa bekerja tanpa membuka database"*.
> Itu **tidak bisa dipenuhi tanpa langganan Retool**, yang belum ada — blocker non-kode
> yang sudah tercatat di `docs/reports/blocker-non-kode.pdf`. Panel `health` juga menunggu
> `SA-03`, yang sendiri masih terblokir `AI-06`.
>
> Yang ADA di sini: **seluruh query-nya, sudah diverifikasi berjalan di bawah role
> `strive_readonly` terhadap database sungguhan.** Saat lisensinya ada, merakit dasbornya
> pekerjaan setengah jam — bukan setengah hari — karena bagian yang bisa salah sudah diuji.

---

## Kenapa query-nya ada di repo, bukan di Retool saja

Query yang hanya hidup di dalam Retool **tidak ter-review, tidak ter-versi, dan tidak
ter-test.** Ia berubah lewat klik, oleh siapa pun yang punya akses, tanpa jejak di `git log`.

Di repo, ia:

- ikut PR dan ikut di-review
- punya test yang membuktikan ia **berjalan di bawah `strive_readonly`** — bukan hanya di
  bawah superuser yang kebetulan dipakai saat mencobanya
- rusak dengan berisik kalau skemanya berubah, lewat CI, bukan lewat superadmin yang
  membuka dasbor pada hari yang buruk

---

## Prasyarat koneksi

Retool menyambung sebagai role **`strive_readonly`** (migrasi 006, `SA-01`). Role itu:

- hanya bisa `SELECT`, dan **hanya pada view `admin_*`**
- **tidak bisa membaca tabel mentah** — `users` mentah membawa email dan zona waktu
  setiap orang ke layar yang dibuka sambil lalu, dan `coin_ledger` mentah mengundang orang
  menghitung saldo sendiri alih-alih membaca yang sudah dijamin

  > Sampai migrasi 007, alasan pertamanya lebih tajam lagi: `users` masih punya kolom
  > `password_hash`. Kolomnya sudah tidak ada (isu #47), tapi batas ini tetap berlaku —
  > ia menjaga PII, bukan satu kolom tertentu.
- tidak bisa menulis apa pun (`SA-2`: semua aksi tulis lewat endpoint resmi)

```sql
-- Dijalankan sekali per lingkungan, DI LUAR migrasi.
-- Repo ini publik; password di migrasi adalah password yang bocor selamanya.
ALTER ROLE strive_readonly LOGIN PASSWORD '<isi dari password manager>';
```

> **View yang dibuat SETELAH migrasi 006 tidak otomatis terbaca.** Ada
> `ALTER DEFAULT PRIVILEGES … REVOKE`, jadi setiap view baru butuh `GRANT SELECT` eksplisit.
> Kalau Retool "tidak melihat" view baru, itu sebabnya — bukan bug koneksi.

---

## Panel

| # | Panel | Sumber | Status |
|---|---|---|---|
| 1 | Transaksi | `admin_transactions` | siap |
| 2 | Uang masuk tanpa koin keluar | `admin_transactions` | siap |
| 3 | Riwayat harga | `admin_transactions` | siap |
| 4 | Audit | `admin_audit` | siap |
| 5 | Health vendor | `GET /admin/integrations/health` | **menunggu `SA-03`** |

Query-nya ada di [`queries.sql`](./queries.sql), diberi nama `-- panel: <nama>` supaya
test bisa menemukannya satu per satu.

### Panel 5 sengaja dibiarkan kosong

Panel `health` membaca **endpoint**, bukan SQL — status vendor dan biaya harian tidak ada
di database ini. Menambalnya dengan query SQL palsu akan membuat dasbor yang menampilkan
angka yang tidak berarti, dan itu lebih buruk daripada panel kosong: orang mempercayainya.

---

## Aksi tulis: lewat endpoint, bukan SQL

`SA-2` mewajibkan seluruh aksi tulis lewat endpoint resmi. Di Retool itu berarti komponen
**REST query**, bukan SQL query:

| Aksi | Cara |
|---|---|
| Ubah harga | `PATCH /api/v1/admin/pricing` (`SA-02`) — menerbitkan versi baru, bukan menimpa |

Yang menegakkan aturan ini bukan disiplin orang yang membuka Retool, tapi role-nya: koneksi
SQL-nya **tidak bisa menulis**, jadi jalur SQL bukan sekadar tidak dianjurkan — ia tidak ada.

---

## Cara merakit, saat lisensinya ada

1. Buat resource PostgreSQL bernama `strive-readonly`, isi dengan kredensial role di atas.
2. Untuk tiap blok di `queries.sql`, buat SQL query baru dengan nama yang sama persis dengan
   label `-- panel:`-nya, lalu tempel isinya.
3. Panel 1 dan 4 memakai parameter `{{ cari.value }}` dan `{{ hari.value }}` — buat dua
   input komponen dengan `id` itu.
4. Aksi tulis: resource REST terpisah ke `APP_URL` API, **bukan** ke resource PostgreSQL.
5. Verifikasi bahwa mengetik `UPDATE` apa pun di SQL query **ditolak**. Kalau ia berhasil,
   koneksinya salah role — hentikan dan periksa, jangan lanjutkan.
