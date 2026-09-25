# Rollback staging

Dipakai saat deploy staging yang baru saja naik merusak API, worker, layanan
AI, atau web. Target: versi sebelumnya melayani lagi dalam **di bawah 5 menit**
setelah keputusan rollback diambil.

Prosedur ini **belum pernah dijalankan dan diukur**. V13 di `docs/reports/F-05/`
bertanda tidak terbukti. Jangan menulis "sudah bisa di bawah 5 menit" sebelum
ada stopwatch dari satu kali rollback sungguhan.

Empat proses, dua penyedia:

| Proses | Tempat | Yang di-rollback |
|---|---|---|
| api | Railway service `api` | deployment sebelumnya |
| worker | Railway service `worker` | deployment sebelumnya |
| ai | Railway service `ai` | deployment sebelumnya |
| web | Vercel `strive-staging-web` | deployment produksi sebelumnya |

Id service dan URL ada di `.github/workflows/deploy-staging.yml`. Jangan
menyalin token ke berkas ini.

## Sebelum menyentuh apa pun

1. Catat jam mulai. Lima menit dihitung dari sini, bukan dari saat seseorang
   membuka dashboard.
2. Putuskan proses mana yang rusak. Jangan me-rollback keempatnya kalau yang
   gagal hanya web — migrasi dan API yang sehat tidak perlu ikut mundur.
3. **Jangan menjalankan ulang migrasi, dan jangan mengarang migrasi `down`.**
   Runner repo ini forward-only. Rollback aplikasi tidak mengembalikan skema.

## Railway — satu service

Ulangi untuk tiap service yang rusak (`api`, `worker`, `ai`). Worker tidak
punya URL; selesai untuk worker berarti deployment lamanya yang berstatus
aktif, bukan halaman yang terbuka.

1. Buka project `strive-staging`, environment `staging`, service yang rusak.
2. Tab Deployments. Pilih deployment **sebelumnya** yang statusnya sukses,
   bukan yang baru saja gagal, lalu Redeploy / Rollback pada deployment itu.
3. CLI `@railway/cli@5.62.1` **tidak bisa** menunjuk id deployment lama.
   `railway redeploy` mengulang deployment **terbaru** — kalau yang terbaru
   yang rusak, perintah itu mengulang kerusakan, bukan mundur.
   `railway down` menghapus deployment terbaru; itu bukan rollback yang
   sudah dibuktikan di sini, jangan dipakai saat panik.
   Yang aman dari CLI hanya melihat daftarnya:

   ```bash
   railway deployment list --service <id-service> --environment f21ad5e8-4c7c-4600-b20b-7fc12232f860 --json
   ```

   Mundurnya tetap dari dashboard, pada baris deployment lama.
4. Pastikan berhasil:
   - `api`: `curl -fsS https://api-staging-af8c.up.railway.app/health`
     menjawab `"service":"api"`.
   - `ai`: `curl -fsS https://ai-staging-330d.up.railway.app/health`
     menjawab `"service":"ai"`.
   - `worker`: tidak ada `/health`. Di log service harus ada proses yang
     hidup (`MODE=worker`), dan Railway tidak boleh me-restart-nya karena
     healthcheck HTTP. Healthcheck HTTP pada worker adalah kesalahan.

## Web — Vercel

Dari checkout repo, dengan `VERCEL_TOKEN`, `VERCEL_ORG_ID`, dan
`VERCEL_PROJECT_ID` di env (secret GitHub yang sama; jangan dicetak):

```bash
vercel ls strive-staging-web --prod
vercel rollback <url-atau-id-deployment-sebelumnya> --yes
```

`vercel promote <url-atau-id-deployment-lama> --yes` memakai deployment
yang dipilih kalau `rollback` tidak menerima url-nya. Keduanya menunggu
sampai selesai (bawaan CLI 3 menit). Tambahkan `--scope` kalau token-nya
punya lebih dari satu tim; `VERCEL_ORG_ID` di secret adalah id tim Hobby,
bukan id user.

Pastikan berhasil, dan **jangan ikuti redirect**:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' --max-redirs 0 https://strive-staging-web.vercel.app/
```

Harus `200`. `302` ke `vercel.com/sso` berarti Deployment Protection
mengunci domain produksi — itu bukan aplikasi yang sehat.

`NEXT_PUBLIC_API_URL` ter-inline saat build. Rollback web mengembalikan
bundle lama beserta URL yang ter-inline di bundle itu. Tidak cukup mengubah
env di dashboard tanpa build.

## Migrasi tidak ikut mundur

`pnpm db:migrate` hanya menerapkan file yang belum jalan, dan checksum
menolak file yang sudah diterapkan lalu diubah. Tidak ada langkah `down`.

Artinya:

- Kode lama + skema baru **boleh** selama migrasi itu expand: kolom baru
  yang belum dibaca kode lama, bukan kolom yang kode lama masih tulis.
- Kode lama + migrasi yang **menghapus atau mengubah arti kolom** tidak
  selamat dengan rollback image saja. Perbaikannya migrasi baru ke depan,
  bukan mengembalikan file SQL lama.
- Jangan `DELETE` atau `UPDATE` `coin_ledger` untuk "membersihkan" deploy
  yang gagal. Trigger menolaknya, dan saldo yang benar adalah jumlah ledger.
- Jangan menjalankan blok verifikasi CI yang meng-`INSERT` ke staging.
  Pemeriksaan di workflow deploy hanya membaca jumlah tabel, nama trigger,
  dan nama foreign key. Itu **tidak** membuktikan trigger menolak perubahan.

## Sesudahnya

Catat jam selesai dan selisihnya di `docs/reports/F-05/`. Kalau selisihnya
di atas 5 menit, tulis di mana waktunya habis — jangan memendekkan angkanya.
Lalu maju lagi ke commit yang memang ingin dilayani, lewat workflow
`Deploy staging`, bukan dengan mengedit database.
