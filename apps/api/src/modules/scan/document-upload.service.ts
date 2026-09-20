import { createHash } from 'node:crypto';
import { BadRequestException, Injectable, PayloadTooLargeException } from '@nestjs/common';

import { StorageService, bucketDocuments } from '../../infra/storage';

/** KL-1: maksimal 25 MB. Dinyatakan dalam byte supaya tidak ada pembulatan diam-diam. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** KL-1: hanya PDF dan DOCX. */
export type DocumentType = 'pdf' | 'docx';

export interface UploadedDocument {
  /** Nama berkas dari klien — dipakai untuk tampilan saja, TIDAK pernah untuk keputusan. */
  filename: string;
  buffer: Buffer;
}

export interface StoredDocument {
  sha256: string;
  key: string;
  bucket: string;
  type: DocumentType;
  bytes: number;
  /** `true` kalau objek dengan hash ini SUDAH ada — tidak ditulis ulang. */
  deduplicated: boolean;
}

/**
 * Menerima dokumen untuk klinik plagiarisme — `K-01`, PRD §7 E7 `KL-1`/`KL-2`.
 *
 * ── Urutannya adalah keamanannya ──
 *
 *   1. ukuran      -> tolak
 *   2. isi berkas  -> tolak
 *   3. SHA-256
 *   4. baru storage
 *
 * AC-nya berbunyi *"tipe berkas lain ditolak SEBELUM menyentuh storage"*, dan
 * itu bukan soal kerapian. Bucket dokumen berisi skripsi yang belum
 * disidangkan; apa pun yang berhasil masuk ke sana sudah jadi masalah, bahkan
 * kalau baris databasenya kemudian ditolak.
 *
 * ── Tipe ditentukan dari ISI, bukan dari nama berkas atau Content-Type ──
 *
 * Keduanya datang dari klien dan keduanya bisa ditulis apa saja.
 * `virus.exe` yang dinamai `skripsi.pdf` dengan header
 * `Content-Type: application/pdf` akan lolos pemeriksaan ekstensi mana pun.
 * Yang diperiksa di sini **byte pertama berkasnya**.
 *
 * ── Hash sebelum apa pun terjadi (KL-2) ──
 *
 * SHA-256 dihitung dari buffer yang SAMA dengan yang disimpan, sebelum
 * menyentuh jaringan. Menghitungnya setelah upload akan mengukur apa yang
 * berhasil terkirim, bukan apa yang dikirim pengguna — dan dedup (KL-3)
 * memakai hash ini sebagai kunci uang: hash yang salah berarti pengguna
 * dikenai tarif penuh untuk dokumen yang sudah pernah dibayar, atau
 * sebaliknya.
 */
@Injectable()
export class DocumentUploadService {
  constructor(private readonly storage: StorageService) {}

  async accept(doc: UploadedDocument): Promise<StoredDocument> {
    // 1 · Ukuran DULU. Pemeriksaan isi pada buffer 2 GB tetap membaca 2 GB.
    if (doc.buffer.byteLength > MAX_UPLOAD_BYTES) {
      throw new PayloadTooLargeException({
        error: {
          code: 'FILE_TOO_LARGE',
          message: `Berkas ${mb(doc.buffer.byteLength)} melebihi batas ${mb(MAX_UPLOAD_BYTES)}`,
          details: { bytes: doc.buffer.byteLength, max_bytes: MAX_UPLOAD_BYTES },
        },
      });
    }

    if (doc.buffer.byteLength === 0) {
      throw new BadRequestException({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Berkas kosong',
          details: { bytes: 0 },
        },
      });
    }

    // 2 · Tipe dari ISI berkas.
    const type = detectType(doc.buffer);
    if (type === null) {
      throw new BadRequestException({
        error: {
          code: 'UNSUPPORTED_FILE_TYPE',
          message: 'Hanya PDF dan DOCX yang diterima',
          details: { filename: doc.filename },
        },
      });
    }

    // 3 · Hash, dari buffer yang sama dengan yang akan disimpan.
    const sha256 = createHash('sha256').update(doc.buffer).digest('hex');

    // 4 · Baru storage. Kunci diturunkan DARI HASH, bukan dari nama berkas:
    //     nama dari klien bisa berisi `../` dan bisa menabrak dokumen orang
    //     lain. Hash juga membuat dokumen identik menempati satu objek.
    const bucket = bucketDocuments();
    const key = `scans/${sha256.slice(0, 2)}/${sha256}.${type}`;

    const sudahAda = await this.storage.exists(bucket, key);
    if (!sudahAda) {
      await this.storage.put({
        bucket,
        key,
        body: doc.buffer,
        contentType: type === 'pdf' ? 'application/pdf' : DOCX_MIME,
      });
    }

    return {
      sha256,
      key,
      bucket,
      type,
      bytes: doc.buffer.byteLength,
      deduplicated: sudahAda,
    };
  }
}

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function mb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Tipe dokumen dari byte-nya sendiri, atau `null` kalau bukan keduanya.
 *
 * **PDF** diawali `%PDF-`.
 *
 * **DOCX** adalah arsip ZIP, jadi magic `PK\x03\x04` saja TIDAK cukup — setiap
 * `.zip`, `.jar`, `.xlsx`, dan `.apk` punya byte yang sama. Yang membedakannya
 * adalah isinya: DOCX selalu memuat entri bernama `word/document.xml`.
 *
 * Nama entri ZIP disimpan **tidak terkompresi** di header lokal dan di
 * direktori pusat, jadi ia bisa dicari sebagai literal tanpa membongkar
 * arsipnya dan tanpa dependensi.
 *
 * **Batas yang diketahui:** ZIP yang bukan DOCX tapi kebetulan memuat berkas
 * bernama `word/document.xml` akan lolos. Itu jauh lebih sulit terjadi secara
 * tidak sengaja daripada `.zip` biasa lolos pemeriksaan `PK` polos, dan lapis
 * berikutnya (ekstraksi teks di `K-03`) akan menolaknya. Yang dicegah di sini
 * adalah berkas sembarangan masuk ke bucket, bukan analisis dokumen.
 */
export function detectType(buf: Buffer): DocumentType | null {
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';

  const zip =
    buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
  if (zip && buf.includes(Buffer.from('word/document.xml', 'latin1'))) return 'docx';

  return null;
}
