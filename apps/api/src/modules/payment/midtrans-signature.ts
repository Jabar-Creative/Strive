import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Tanda tangan notifikasi Midtrans — PRD §12.1, `PA-6`:
 *
 * > `SHA512(order_id + status_code + gross_amount + server_key)`
 *
 * Fungsi murni, dipisah dari service supaya formulanya punya unit test sendiri
 * (CLAUDE.md §Test: *"setiap formula punya unit test"*). Ia juga satu-satunya
 * gerbang uang di jalur ini: koin HANYA bertambah dari webhook yang lolos
 * pemeriksaan ini (`PA-5`).
 *
 * ── `gross_amount` dipakai APA ADANYA, bukan diangkakan ──
 *
 * Midtrans mengirim `"55000.00"` — string, dua desimal. Tanda tangannya
 * dihitung atas string itu persis seperti yang dikirim. Mengubahnya jadi
 * number lalu kembali jadi string menghasilkan `"55000"`, dan tanda tangan
 * yang benar pun tidak akan pernah cocok. Godaan berikutnya — menormalkan
 * kedua sisi supaya "cocok" — akan membuat pemeriksaannya berhenti memeriksa
 * apa pun.
 */
export function hitungTandaTangan(
  orderId: string,
  statusCode: string,
  grossAmount: string,
  serverKey: string,
): string {
  return createHash('sha512')
    .update(`${orderId}${statusCode}${grossAmount}${serverKey}`, 'utf8')
    .digest('hex');
}

/**
 * `true` kalau `signatureKey` cocok.
 *
 * Perbandingannya **waktu tetap**. Perbandingan `===` atas string berhenti di
 * byte pertama yang berbeda, dan selisih waktunya bisa diukur dari jarak
 * jauh — yang mengubah "menebak 128 karakter hex" menjadi "menebak satu
 * karakter, 128 kali".
 *
 * Kunci server kosong mengembalikan `false` TANPA menghitung apa pun. Tanpa
 * baris itu, `serverKey` yang belum dikonfigurasi membuat tanda tangan bisa
 * dihitung siapa saja — seluruh bahannya ada di badan request — dan webhook
 * palsu menambah koin sungguhan.
 */
export function tandaTanganSah(params: {
  orderId: string;
  statusCode: string;
  grossAmount: string;
  signatureKey: string;
  serverKey: string;
}): boolean {
  if (params.serverKey.length === 0) return false;

  const diharapkan = hitungTandaTangan(
    params.orderId,
    params.statusCode,
    params.grossAmount,
    params.serverKey,
  );
  const a = Buffer.from(diharapkan, 'utf8');
  const b = Buffer.from(params.signatureKey, 'utf8');
  // `timingSafeEqual` MELEMPAR kalau panjangnya beda — panjang yang berbeda
  // memang sudah bocor lewat jalur lain, jadi dijawab di sini.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
