import { createHash, randomUUID } from 'node:crypto';
import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { StorageService, bucketDocuments, createS3FromEnv } from '../src/infra/storage';
import { DocumentUploadService, MAX_UPLOAD_BYTES, detectType } from '../src/modules/scan';

/**
 * `K-01` terhadap MinIO NYATA.
 *
 * AC-nya dua kalimat, dan yang pertama menolak dibuktikan dengan membaca kode:
 *
 *   "Tipe berkas lain ditolak SEBELUM menyentuh storage"
 *   "Berkas >25 MB ditolak dengan pesan yang jelas"
 *
 * Kata **sebelum** yang menentukan. Service yang menyimpan dulu lalu menghapus
 * saat validasi gagal akan lulus setiap test yang hanya memeriksa "apakah
 * objeknya ada di akhir" — padahal ia sudah menaruh berkas sembarangan di
 * bucket berisi skripsi yang belum disidangkan.
 *
 * Yang membuktikannya: `StorageService.put` dibungkus penghitung, dan
 * assertnya **nol panggilan**, bukan "objeknya tidak ada".
 */

const BUCKET = bucketDocuments();

let storage: StorageService;
let upload: DocumentUploadService;
let reachable = false;
let putCalls = 0;

/** PDF paling minimal yang tetap punya header sungguhan. */
function pdf(isi = 'halo'): Buffer {
  return Buffer.concat([
    Buffer.from('%PDF-1.7\n', 'latin1'),
    Buffer.from(`% ${isi}\n`, 'latin1'),
    Buffer.from('%%EOF\n', 'latin1'),
  ]);
}

/**
 * DOCX minimal — header berkas lokal ZIP yang BENAR-BENAR berbentuk benar,
 * bukan gumpalan byte yang kebetulan memuat string yang dicari.
 *
 * Tata letak: signature (4) · versi (2) · flag (2) · metode (2) · waktu (2) ·
 * tanggal (2) · crc32 (4) · ukuran terkompresi (4) · ukuran asli (4) ·
 * panjang nama (2) · panjang extra (2) · nama · data.
 */
function docx(isi = '<w:document/>'): Buffer {
  const nama = Buffer.from('word/document.xml', 'latin1');
  const data = Buffer.from(isi, 'utf8');
  const h = Buffer.alloc(30);
  h.writeUInt32LE(0x04034b50, 0); // PK\x03\x04
  h.writeUInt16LE(20, 4); // versi minimum
  h.writeUInt16LE(0, 6); // flag
  h.writeUInt16LE(0, 8); // metode: store
  h.writeUInt32LE(0, 14); // crc32 (tidak diperiksa detektor)
  h.writeUInt32LE(data.length, 18);
  h.writeUInt32LE(data.length, 22);
  h.writeUInt16LE(nama.length, 26);
  h.writeUInt16LE(0, 28);
  return Buffer.concat([h, nama, data]);
}

/** ZIP yang BUKAN DOCX — sama magic-nya, isinya berbeda. */
function zipBiasa(): Buffer {
  const nama = Buffer.from('catatan.txt', 'latin1');
  const h = Buffer.alloc(30);
  h.writeUInt32LE(0x04034b50, 0);
  h.writeUInt16LE(nama.length, 26);
  return Buffer.concat([h, nama, Buffer.from('bukan docx')]);
}

beforeAll(async () => {
  const s3 = createS3FromEnv();
  storage = new StorageService(s3);

  // Pembungkus penghitung. Yang diuji bukan "objeknya tidak ada di akhir" tapi
  // "put tidak pernah DIPANGGIL" — bedanya adalah seluruh AC ini.
  const asli = storage.put.bind(storage);
  storage.put = async (input) => {
    putCalls++;
    return asli(input);
  };

  upload = new DocumentUploadService(storage);

  try {
    await storage.exists(BUCKET, `probe/${randomUUID()}`);
    reachable = true;
  } catch {
    reachable = false;
  }
});

afterAll(() => undefined);

beforeEach(() => {
  putCalls = 0;
});

describe('DocumentUploadService (MinIO nyata)', () => {
  it('MinIO siap dipakai', () => {
    expect(reachable, 'MinIO tidak bisa dihubungi — `docker compose up -d`').toBe(true);
  });

  // ── AC 1: tipe lain ditolak SEBELUM menyentuh storage ───────────────────

  it('AC: tipe yang tidak didukung ditolak, dan `put` TIDAK PERNAH dipanggil', async () => {
    if (!reachable) return;
    const jahat: [string, Buffer][] = [
      ['skripsi.pdf', Buffer.from('MZ\x90\x00 ini executable Windows', 'latin1')],
      ['skripsi.docx', Buffer.from('\x7fELF ini binary Linux', 'latin1')],
      ['skripsi.pdf', Buffer.from('<?php system($_GET["c"]); ?>', 'latin1')],
      ['gambar.pdf', Buffer.from('\x89PNG\r\n\x1a\n', 'latin1')],
      ['arsip.docx', zipBiasa()],
      ['catatan.pdf', Buffer.from('teks biasa saja', 'utf8')],
    ];

    for (const [filename, buffer] of jahat) {
      await expect(
        upload.accept({ filename, buffer }),
        `${filename} (${buffer.subarray(0, 4).toString('latin1')}) DITERIMA`,
      ).rejects.toBeInstanceOf(BadRequestException);
    }

    expect(
      putCalls,
      'ada berkas ditolak yang tetap sampai ke storage — AC "sebelum menyentuh storage" gagal',
    ).toBe(0);
  });

  it('nama berkas dan ekstensi TIDAK menentukan apa pun', async () => {
    if (!reachable) return;
    // PDF sungguhan bernama `.exe` DITERIMA…
    const a = await upload.accept({ filename: 'virus.exe', buffer: pdf('sebetulnya pdf') });
    expect(a.type).toBe('pdf');

    // …dan executable bernama `.pdf` DITOLAK. Yang menentukan isinya.
    await expect(
      upload.accept({ filename: 'aman.pdf', buffer: Buffer.from('MZ\x90\x00', 'latin1') }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('ZIP biasa ditolak — magic `PK` saja tidak cukup untuk DOCX', () => {
    // Setiap .zip, .jar, .xlsx, dan .apk punya empat byte pertama yang sama.
    expect(detectType(zipBiasa())).toBeNull();
    expect(detectType(docx())).toBe('docx');
  });

  it('berkas kosong ditolak', async () => {
    if (!reachable) return;
    await expect(
      upload.accept({ filename: 'kosong.pdf', buffer: Buffer.alloc(0) }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(putCalls).toBe(0);
  });

  // ── AC 2: >25 MB ditolak dengan pesan yang jelas ────────────────────────

  it('AC: berkas >25 MB ditolak, pesannya menyebut ukuran DAN batasnya', async () => {
    if (!reachable) return;
    // PDF yang SAH tapi kebesaran — supaya yang diuji batas ukuran, bukan tipe.
    const besar = Buffer.concat([pdf(), Buffer.alloc(MAX_UPLOAD_BYTES)]);

    let galat: unknown;
    try {
      await upload.accept({ filename: 'tebal.pdf', buffer: besar });
    } catch (e) {
      galat = e;
    }

    expect(galat).toBeInstanceOf(PayloadTooLargeException);
    const body = (galat as PayloadTooLargeException).getResponse() as {
      error: { code: string; message: string; details: { bytes: number; max_bytes: number } };
    };
    expect(body.error.code).toBe('FILE_TOO_LARGE');
    // "Pesan yang jelas" berarti pengguna tahu berkasnya berapa DAN batasnya
    // berapa. "Terlalu besar" tanpa angka memaksa orang menebak.
    expect(body.error.message).toMatch(/MB/);
    expect(body.error.details.max_bytes).toBe(MAX_UPLOAD_BYTES);
    expect(body.error.details.bytes).toBe(besar.byteLength);
    expect(putCalls, 'berkas kebesaran tetap diunggah').toBe(0);
  });

  it('tepat 25 MB DITERIMA — batasnya inklusif, bukan meleset satu', async () => {
    if (!reachable) return;
    const p = pdf();
    const tepat = Buffer.concat([p, Buffer.alloc(MAX_UPLOAD_BYTES - p.length)]);
    expect(tepat.byteLength).toBe(MAX_UPLOAD_BYTES);

    const r = await upload.accept({ filename: 'pas.pdf', buffer: tepat });
    expect(r.bytes).toBe(MAX_UPLOAD_BYTES);
  });

  // ── KL-2: hash sebelum apa pun terjadi ──────────────────────────────────

  it('KL-2: SHA-256 dihitung dari isi berkas, dan cocok dengan hitungan mandiri', async () => {
    if (!reachable) return;
    const buf = pdf(randomUUID());
    const harapan = createHash('sha256').update(buf).digest('hex');

    const r = await upload.accept({ filename: 'skripsi.pdf', buffer: buf });
    expect(r.sha256).toBe(harapan);
    expect(r.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('kunci objek diturunkan dari HASH, bukan dari nama berkas', async () => {
    if (!reachable) return;
    // Nama dari klien bisa berisi `../` dan bisa menabrak dokumen orang lain.
    const r = await upload.accept({
      filename: '../../etc/passwd',
      buffer: pdf(randomUUID()),
    });
    expect(r.key).toBe(`scans/${r.sha256.slice(0, 2)}/${r.sha256}.pdf`);
    expect(r.key).not.toContain('..');
    expect(r.key).not.toContain('passwd');
  });

  it('dokumen BENAR-BENAR tersimpan, dan isinya utuh byte per byte', async () => {
    if (!reachable) return;
    const buf = pdf(randomUUID());
    const r = await upload.accept({ filename: 'skripsi.pdf', buffer: buf });

    expect(await storage.exists(r.bucket, r.key)).toBe(true);
    const kembali = await storage.get(r.bucket, r.key);
    // Bukan cuma "ada": isinya harus identik. Objek yang terpotong saat unggah
    // akan lulus `exists` dan gagal di vendor, jauh dari sini.
    expect(kembali.equals(buf)).toBe(true);
    expect(createHash('sha256').update(kembali).digest('hex')).toBe(r.sha256);
  });

  it('DOCX diterima dan disimpan dengan content-type yang benar', async () => {
    if (!reachable) return;
    const buf = docx(`<w:document>${randomUUID()}</w:document>`);
    const r = await upload.accept({ filename: 'skripsi.docx', buffer: buf });
    expect(r.type).toBe('docx');
    expect(r.key.endsWith('.docx')).toBe(true);
    expect(await storage.exists(r.bucket, r.key)).toBe(true);
  });

  it('dokumen identik tidak ditulis ulang — satu hash, satu objek', async () => {
    if (!reachable) return;
    const buf = pdf(randomUUID());

    const pertama = await upload.accept({ filename: 'a.pdf', buffer: buf });
    expect(pertama.deduplicated).toBe(false);

    const sebelum = putCalls;
    const kedua = await upload.accept({ filename: 'nama-lain.pdf', buffer: buf });

    expect(kedua.sha256).toBe(pertama.sha256);
    expect(kedua.key).toBe(pertama.key);
    expect(kedua.deduplicated, 'objek ditulis ulang padahal isinya sama').toBe(true);
    expect(putCalls, 'put dipanggil untuk dokumen yang sudah ada').toBe(sebelum);
  });

  // ── KL-10: unduhan hanya lewat signed URL berumur pendek ────────────────

  it('KL-10: signed URL dibuat, berumur 15 menit, dan BEKERJA', async () => {
    if (!reachable) return;
    const buf = pdf(randomUUID());
    const r = await upload.accept({ filename: 'skripsi.pdf', buffer: buf });

    const url = await storage.signedDownloadUrl(r.bucket, r.key);
    expect(url).toContain('X-Amz-Signature');
    expect(url).toContain('X-Amz-Expires=900');

    // URL yang berbentuk benar tapi tidak bisa diunduh sama saja dengan tidak
    // ada. Diuji dengan benar-benar mengambilnya.
    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).equals(buf)).toBe(true);
  });

  it('KL-10: objek TIDAK bisa diambil tanpa tanda tangan — bucketnya privat', async () => {
    if (!reachable) return;
    const r = await upload.accept({ filename: 'rahasia.pdf', buffer: pdf(randomUUID()) });

    // Skripsi yang belum disidangkan. URL yang bisa ditebak = bocor.
    const telanjang = `${process.env['S3_ENDPOINT'] ?? 'http://localhost:59000'}/${r.bucket}/${r.key}`;
    const res = await fetch(telanjang);
    expect(res.status, 'bucket dokumen bisa dibaca tanpa tanda tangan').toBeGreaterThanOrEqual(400);
  });
});
