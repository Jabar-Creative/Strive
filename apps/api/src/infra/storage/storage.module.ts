import { Module } from '@nestjs/common';

/**
 * Object storage S3-compatible (MinIO di dev) — docs/PRD.md §12.6.
 * Akses HANYA lewat signed URL 15 menit. Tidak ada bucket publik untuk dokumen
 * pengguna.
 *
 * KERANGKA — provider menyusul di item K-01 (docs/BACKLOG.md).
 */
@Module({})
export class StorageModule {}
