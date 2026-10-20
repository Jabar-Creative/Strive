import { Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable } from '@nestjs/common';
import { envTeks, produksi } from '../../common/env';

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
  /**
   * Menghapus satu objek — isu #123 (retensi 90 hari §16.1).
   *
   * ── Kenapa ini sebelumnya tidak ada ──
   *
   * `StorageService` punya `put`, `get`, `exists`, dan `signedDownloadUrl`,
   * dan **nol cara menghapus**. Jadi janji §16.1 *"dokumen sensitif disimpan
   * maksimal 90 hari"* tidak punya satu pun mekanisme di baliknya — bukan
   * "belum dijadwalkan", tapi tidak bisa dilakukan sama sekali.
   *
   * ── IDEMPOTEN, dan itu bukan kebetulan S3 ──
   *
   * `DeleteObject` S3 menjawab 204 untuk kunci yang tidak ada: menghapus dua
   * kali bukan galat. Itu yang membuat penyapu retensi aman dijalankan ulang
   * setelah gagal separuh jalan — dan penyapu yang tidak aman dijalankan ulang
   * adalah penyapu yang orang ragu menjalankannya setelah insiden, yaitu
   * pelajaran yang sudah tercatat untuk `PartitionService`.
   *
   * Yang TIDAK dilakukan di sini: menyentuh baris database. Objeknya dihapus,
   * barisnya tetap — riwayat laporan plagiarisme harus selamat tanpa
   * berkasnya, karena yang sensitif dokumennya, bukan fakta bahwa scan pernah
   * terjadi. Pemanggilnya yang memutuskan bagaimana barisnya ditandai.
   */
  async hapus(bucket: string, key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  }

  async signedDownloadUrl(bucket: string, key: string): Promise<string> {
    return getSignedUrl(this.s3, new GetObjectCommand({ Bucket: bucket, Key: key }), {
      expiresIn: SIGNED_URL_TTL_SECONDS,
    });
  }
}

/**
 * Variabel yang WAJIB eksplisit di produksi — bawaan dev-nya menyesatkan.
 *
 * **Nama bucket ikut di daftar ini sejak isu #237.** Sebelumnya hanya
 * endpoint dan kredensial yang diperiksa, jadi `createS3FromEnv()` gagal
 * tertutup sementara `bucketDocuments()`/`bucketAssets()` di bawahnya tetap
 * diam-diam jatuh ke `strive-documents`/`strive-assets` — nama bucket DEV.
 * Separuh gerbang: kredensialnya produksi, tujuannya dev.
 *
 * Yang membuatnya berbahaya bukan kegagalannya, tapi keberhasilannya. Dengan
 * kredensial R2 yang sah dan nama bucket dev, panggilan pertama yang mengenai
 * bucket tak-ada menjawab `NoSuchBucket` — dan di akun yang KEBETULAN punya
 * bucket bernama sama, ia berhasil: skripsi pengguna produksi tertulis ke
 * tempat yang tidak pernah dimaksudkan menyimpannya, tanpa satu galat pun.
 */
const WAJIB_DI_PRODUKSI = [
  'S3_ENDPOINT',
  'S3_ACCESS_KEY',
  'S3_SECRET_KEY',
  'S3_BUCKET_DOCUMENTS',
  'S3_BUCKET_ASSETS',
] as const;

/**
 * Nama bucket di produksi: eksplisit atau melempar — tidak pernah bawaan.
 *
 * Pemeriksaan di `createS3FromEnv()` menangkapnya lebih awal (saat boot,
 * ketika masih ada yang menonton), dan itu memang gerbang yang lebih baik.
 * Yang ini ada karena gerbang itu hanya dilewati proses yang MEMBUAT klien
 * S3; fungsi bucket bisa dipanggil dari mana saja — skrip perbaikan data,
 * worker, test yang merakit modul sendiri. Pola yang sama dengan trigger
 * database di repo ini: aman dari jalur mana pun, bukan dari satu jalur kode.
 */
function bucketWajib(nama: string, bawaanDev: string): string {
  const v = envTeks(nama);
  if (v !== undefined) return v;
  if (produksi()) {
    throw new Error(
      `${nama} kosong di produksi. Bawaan dev '${bawaanDev}' TIDAK dipakai — ` +
        'nama bucket dev di akun produksi menulis dokumen pengguna ke tempat ' +
        'yang tidak dimaksudkan menyimpannya, dan itu berhasil tanpa galat.',
    );
  }
  return bawaanDev;
}

/**
 * Klien S3 dari env. Satu-satunya tempat kredensial storage dibaca.
 *
 * ── Kenapa ini melempar, bukan diam-diam memakai bawaan ──
 *
 * Bawaan di bawah menunjuk MinIO lokal dengan password yang tertulis di repo
 * PUBLIK ini. Di produksi itu bukan "kurang optimal": endpoint `localhost`
 * membuat setiap unggahan gagal dengan galat jaringan yang tidak menyebut
 * kredensial sama sekali, dan yang lebih buruk, ia gagal SAAT PENGGUNA
 * MENGUNGGAH skripsinya — bukan saat deploy, ketika masih ada yang menonton.
 *
 * Melempar di sini berarti gagal saat boot: container tidak pernah sehat,
 * healthcheck platform merah, dan deployment sebelumnya tetap melayani. Pola
 * yang sama dengan `createAuthFromEnv()` untuk `AUTH_SECRET`.
 *
 * Di luar produksi bawaan tetap berlaku, karena CLAUDE.md menjanjikan stack
 * ini jalan tanpa `.env` sama sekali.
 */
export function createS3FromEnv(): S3Client {
  const hilang = produksi() ? WAJIB_DI_PRODUKSI.filter((n) => envTeks(n) === undefined) : [];
  if (hilang.length > 0) {
    throw new Error(
      `Storage belum dikonfigurasi untuk produksi: ${hilang.join(', ')} kosong. ` +
        'Bawaan dev menunjuk MinIO lokal dengan kredensial yang ada di repo publik, ' +
        'jadi ia TIDAK dipakai di produksi.',
    );
  }
  return new S3Client({
    endpoint: envTeks('S3_ENDPOINT') ?? 'http://localhost:59000',
    // MinIO tidak punya DNS per-bucket. Tanpa ini, SDK membentuk
    // `http://strive-documents.localhost:59000` dan setiap panggilan gagal
    // dengan galat DNS yang tidak menyebut bucket sama sekali.
    forcePathStyle: true,
    region: envTeks('S3_REGION') ?? 'us-east-1',
    credentials: {
      accessKeyId: envTeks('S3_ACCESS_KEY') ?? 'strive',
      secretAccessKey: envTeks('S3_SECRET_KEY') ?? 'strive_dev_only',
    },
  });
}

/** Bucket dokumen pengguna — privat, isinya skripsi yang belum disidangkan. */
export function bucketDocuments(): string {
  return bucketWajib('S3_BUCKET_DOCUMENTS', 'strive-documents');
}

/**
 * Bucket aset store — privat, dilayani lewat signed URL (`ST-02`, 15 menit).
 *
 * Isu #159: `S3_BUCKET_ASSETS` tercantum di `.env.example` dan PRD §12.6 sejak
 * awal, dan **nol kode membacanya** — variabel yang terbaca seperti
 * konfigurasi yang bekerja. CLAUDE.md menuliskan aturannya: variabel yang
 * ditulis di PRD atau `.env.example` adalah JANJI; buat ia benar, atau hapus
 * baris itu. Menghapusnya salah karena PRD §12.6 mewajibkan bucketnya ada dan
 * `ST-02` akan memakainya.
 *
 * Privat seperti dua bucket lainnya. Aset store bukan rahasia, tapi bucket
 * publik berarti setiap URL yang pernah dibagikan hidup selamanya — dan
 * `ST-02` menjanjikan kedaluwarsa 15 menit, yang hanya bisa ditegakkan signed
 * URL di atas bucket privat.
 *
 * Penjaganya `storage-bucket-env.spec.ts`: setiap `S3_BUCKET_*` di
 * `.env.example` WAJIB dibaca kode. Tanpa penjaga itu, bucket ketiga yang
 * ditambahkan besok mengulang isu ini.
 */
export function bucketAssets(): string {
  return bucketWajib('S3_BUCKET_ASSETS', 'strive-assets');
}
