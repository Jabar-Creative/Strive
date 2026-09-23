/**
 * Header keamanan respons — `R-03`, PRD §16.1.
 *
 * > Header keamanan: `Content-Security-Policy`, `X-Content-Type-Options`,
 * > `Referrer-Policy`, `Permissions-Policy`
 *
 * Sebelum ini API menyetel **nol** dari keempatnya.
 *
 * ── Ditulis sendiri, bukan `helmet` ──
 *
 * Bukan soal menghindari dependensi. Bawaan `helmet` dirancang untuk aplikasi
 * yang mengirim HTML, dan API ini tidak pernah mengirim HTML — ia hanya
 * mengirim JSON. Untuk permukaan seperti itu, jawaban yang benar jauh lebih
 * keras daripada bawaan mana pun: `default-src 'none'`. Menyalakan `helmet`
 * lalu menimpa separuh setelannya menghasilkan konfigurasi yang lebih sulit
 * dibaca daripada dua belas baris di bawah, dan setiap nilainya di sini
 * adalah pilihan yang bisa ditunjuk alasannya.
 *
 * ── HSTS hanya di atas TLS ──
 *
 * `Strict-Transport-Security` mengunci browser ke HTTPS untuk host itu.
 * Mengirimnya dari `http://localhost:3001` akan mengunci **localhost** —
 * memutus seluruh pengembangan lokal di mesin siapa pun yang pernah
 * membukanya, dan tidak bisa dibatalkan dari sisi server. Jadi ia hanya
 * dikirim kalau request memang tiba lewat TLS; sampai `F-05` berdiri tidak
 * ada proxy yang menyetel `x-forwarded-proto`, jadi praktisnya belum aktif —
 * dan itu benar, bukan kekurangan.
 *
 * ── Tipe request/respons ditulis minimal, bukan diimpor dari `express` ──
 *
 * `@types/express` bukan dependensi langsung `apps/api` (ia transitif lewat
 * `@nestjs/platform-express`), dan menambahkannya hanya untuk dua bidang
 * berarti menambah paket yang versinya harus dijaga selaras. Yang benar-benar
 * dipakai di bawah cuma `setHeader`, `secure`, dan satu header — jadi itu
 * yang dituliskan. Efek sampingnya bagus: bentuk ini juga membuat fungsinya
 * bisa diuji tanpa server.
 */

/** Sebagian kecil `express.Request` yang benar-benar dipakai. */
export interface RequestMinimal {
  secure?: boolean;
  headers: Record<string, string | string[] | undefined>;
}

/** Sebagian kecil `express.Response` yang benar-benar dipakai. */
export interface ResponseMinimal {
  setHeader(nama: string, nilai: string): void;
}
export function headerKeamanan(): (
  req: RequestMinimal,
  res: ResponseMinimal,
  next: () => void,
) => void {
  return (req: RequestMinimal, res: ResponseMinimal, next: () => void): void => {
    // API ini TIDAK PERNAH mengirim HTML. Tidak ada script, style, gambar,
    // atau frame yang sah untuk dimuat dari respons JSON — jadi semuanya
    // ditolak, dan `frame-ancestors` menutup clickjacking sekalian.
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    // Tanpa ini, respons JSON yang isinya dikendalikan pengguna bisa ditebak
    // ulang browser sebagai HTML dan dieksekusi.
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Jangan bocorkan path API (yang memuat id sumber daya) ke situs lain.
    res.setHeader('Referrer-Policy', 'no-referrer');
    // API tidak membutuhkan satu pun perangkat ini. Daftar kosong = ditolak.
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    // Pelengkap `frame-ancestors` untuk browser lama.
    res.setHeader('X-Frame-Options', 'DENY');

    const lewatTls = req.secure === true || req.headers['x-forwarded-proto'] === 'https';
    if (lewatTls) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  };
}
