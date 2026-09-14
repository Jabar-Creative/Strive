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

Belum ada — itu item `F-05` (Dev A, W1). Sampai itu selesai, `infra/` hanya
melayani pengembangan lokal.
