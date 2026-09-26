# Konfigurasi build Railway — hanya build

Tiga berkas ini memaku **cara membangun** image. Mereka tidak memuat variabel
runtime, perintah start, healthcheck, region, atau replika. Semua itu sudah
dipasang di service Railway dan tidak boleh ikut tertimpa dari repo.

| Berkas        | Service  | Dockerfile                                                                |
| ------------- | -------- | ------------------------------------------------------------------------- |
| `api.json`    | `api`    | `infra/Dockerfile.api`, `MODE=api` (variabel service, bukan berkas ini)   |
| `worker.json` | `worker` | **image yang sama** dengan api. Satu-satunya pembeda adalah `MODE=worker` |
| `ai.json`     | `ai`     | `infra/Dockerfile.ai`                                                     |

`api` dan `worker` berbagi Dockerfile karena PRD §8.1: satu image, dua peran.
Jangan membuat Dockerfile kedua untuk worker.

Workflow `.github/workflows/deploy-staging.yml` menyalin berkas service yang
sedang di-deploy menjadi `railway.json` di root **hanya untuk unggahan itu**,
lalu menghapusnya. Railway membaca `railway.json` di root arsip. Satu berkas
di root untuk ketiga service akan memasang Dockerfile yang salah ke service
yang lain — makanya tidak ada `railway.json` tetap di root.

Yang sengaja tidak ada di berkas ini:

- Bagian `deploy`. Healthcheck HTTP pada `worker` membuat Railway me-restart
  proses yang sehat, karena worker tidak membuka port.
- Variabel. `AUTH_SECRET`, `DATABASE_URL`, dan sisanya sudah di service.
  Menulisnya di sini berarti rahasia masuk git, atau nilai dashboard tertimpa
  saat deploy.

`RAILWAY_DOCKERFILE_PATH` di tiap service menunjuk path yang sama. Berkas ini
membuat path itu terlihat dari repo, bukan hanya dari dashboard.

Config-as-code Railway (`railway.json`) tidak lagi dibaca untuk service baru
dan berhenti dibaca pada **2026-12-01**. Setelah tanggal itu, path Dockerfile
yang tetap berlaku adalah variabel `RAILWAY_DOCKERFILE_PATH` di service.
Jangan pindah ke Infrastructure as Code (`.railway/railway.ts`) tanpa rencana
terpisah: berkas itu menggambarkan **seluruh** project, termasuk variabel,
dan menerapkan rencana itu akan menimpa environment yang sudah hidup.
