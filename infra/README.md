# infra

| File                 | Isi                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------ |
| `docker-compose.yml` | PostgreSQL 16, Redis 7, MinIO + pembuat bucket. Dijalankan dari **root**: `docker compose up -d` |
| `Dockerfile.web`     | Next.js 15, `output: standalone`                                                                 |
| `Dockerfile.api`     | NestJS. Satu image, `MODE=api` atau `MODE=worker`                                                |
| `Dockerfile.ai`      | FastAPI                                                                                          |

Ketiga Dockerfile dibangun dari **root repo**, bukan dari folder ini:

```bash
docker build -f infra/Dockerfile.api -t strive-api .
```

## Port

Digeser dari default agar tidak bentrok dengan layanan yang mungkin sudah
berjalan di mesin developer.

| Layanan       | Host    | Container |
| ------------- | ------- | --------- |
| PostgreSQL    | `55432` | 5432      |
| Redis         | `56379` | 6379      |
| MinIO S3 API  | `59000` | 9000      |
| MinIO Console | `59001` | 9001      |
| web           | `3000`  | 3000      |
| api           | `3001`  | 3001      |
| ai            | `8000`  | 8000      |

## Deploy staging

Staging tidak lagi "belum ada", dan **web tidak dibangun dari `Dockerfile.web`**.

| Proses                 | Tempat                                  | Cara bangun                                                                                            |
| ---------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| web                    | Vercel, project `strive-staging-web`    | `vercel build` di GitHub Actions. Root `apps/web`. `Dockerfile.web` hanya untuk percobaan Docker lokal |
| api                    | Railway `strive-staging`, service `api` | `infra/Dockerfile.api`, `MODE=api`. Konteks build = root repo                                          |
| worker                 | Railway, service `worker`, tanpa domain | **image yang sama** dengan api, `MODE=worker`. Tanpa healthcheck HTTP                                  |
| ai                     | Railway, service `ai`                   | `infra/Dockerfile.ai`                                                                                  |
| PostgreSQL 16, Redis 7 | Railway, region Singapore               | image terkelola, bukan Dockerfile repo ini                                                             |
| objek                  | Cloudflare R2                           | tiga bucket privat                                                                                     |

Deploy otomatis ada di `.github/workflows/deploy-staging.yml`: setelah CI
di `main` hijau, urutannya migrasi, pemeriksaan skema hanya-baca, ketiga
service Railway, lalu Vercel, lalu smoke. Path Dockerfile yang di-commit
ada di `infra/railway/`. Rollback ada di `docs/runbooks/rollback-staging.md`.

Yang belum terbukti — URL hidup, deploy dari push, rollback di bawah lima
menit — tertulis di `docs/reports/F-05/`. Jangan membaca bagian ini sebagai
klaim bahwa staging sudah melayani.
