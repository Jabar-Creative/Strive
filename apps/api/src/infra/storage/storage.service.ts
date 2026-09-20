import { Readable } from 'node:stream';
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable } from '@nestjs/common';

/** Token injeksi klien S3 — memudahkan menggantinya di test tanpa memalsukan HTTP. */
export const S3 = Symbol('S3');

/** KL-10 & SR-5: unduhan lewat signed URL yang berlaku 15 menit. */
export const SIGNED_URL_TTL_SECONDS = 15 * 60;

export interface PutObjectInput {
  bucket: string;
  key: string;
  body: Buffer;
  contentType: string;
}

/**
 * Object storage S3-compatible — `docs/PRD.md` §12.6, item `K-01`.
 *
 * ── Tidak ada bucket publik ──
 *
 * Ketiga bucket di `infra/docker-compose.yml` privat, dan itu bukan kebetulan:
 * dokumen pengguna adalah skripsi yang belum disidangkan. Akses HANYA lewat
 * signed URL berumur pendek (KL-10). Kalau suatu saat ada kode yang membuat
 * URL publik ke bucket dokumen, itu bukan optimasi — itu kebocoran.
 *
 * ── Kenapa AWS SDK, bukan klien MinIO ──
 *
 * Dev memakai MinIO, produksi memakai S3 atau yang setara. Memakai SDK khusus
 * MinIO berarti menulis kode yang hanya benar di satu dari dua lingkungan, dan
 * bedanya baru ketahuan saat deploy. `forcePathStyle` di bawah adalah SATU
 * baris yang membuat keduanya bekerja.
 */
@Injectable()
export class StorageService {
  constructor(@Inject(S3) private readonly s3: S3Client) {}

  /** Menyimpan objek. Melempar kalau gagal — pemanggil TIDAK boleh menganggapnya sukses. */
  async put(input: PutObjectInput): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: input.bucket,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType,
      }),
    );
  }

  /** Apakah objek ini ada. Dipakai test dan pemeriksaan integritas, bukan jalur panas. */
  async exists(bucket: string, key: string): Promise<boolean> {
    try {
      await this.s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  /** Mengambil isi objek. Dipakai worker (`K-03`), bukan dikirim ke klien. */
  async get(bucket: string, key: string): Promise<Buffer> {
    const r = await this.s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const chunks: Buffer[] = [];
    for await (const c of r.Body as Readable) chunks.push(Buffer.from(c as Buffer));
    return Buffer.concat(chunks);
  }

  /**
   * URL unduhan bertanda tangan, berumur 15 menit (KL-10, SR-5).
   *
   * TTL-nya konstanta, bukan parameter. Umur yang bisa dipilih pemanggil akan
   * pelan-pelan jadi "satu hari saja supaya tidak merepotkan", dan link yang
   * bocor jadi berlaku satu hari.
   */
  async signedDownloadUrl(bucket: string, key: string): Promise<string> {
    return getSignedUrl(this.s3, new GetObjectCommand({ Bucket: bucket, Key: key }), {
      expiresIn: SIGNED_URL_TTL_SECONDS,
    });
  }
}

/** Klien S3 dari env. Satu-satunya tempat kredensial storage dibaca. */
export function createS3FromEnv(): S3Client {
  return new S3Client({
    endpoint: process.env['S3_ENDPOINT'] ?? 'http://localhost:59000',
    // MinIO tidak punya DNS per-bucket. Tanpa ini, SDK membentuk
    // `http://strive-documents.localhost:59000` dan setiap panggilan gagal
    // dengan galat DNS yang tidak menyebut bucket sama sekali.
    forcePathStyle: true,
    region: process.env['S3_REGION'] ?? 'us-east-1',
    credentials: {
      accessKeyId: process.env['S3_ACCESS_KEY'] ?? 'strive',
      secretAccessKey: process.env['S3_SECRET_KEY'] ?? 'strive_dev_only',
    },
  });
}

/** Bucket dokumen pengguna — privat, isinya skripsi yang belum disidangkan. */
export function bucketDocuments(): string {
  return process.env['S3_BUCKET_DOCUMENTS'] ?? 'strive-documents';
}
