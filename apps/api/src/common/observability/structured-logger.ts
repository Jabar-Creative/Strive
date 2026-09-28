import { ConsoleLogger, type LogLevel } from '@nestjs/common';

/**
 * Logger JSON terstruktur — `R-04`, PRD §17.1.
 *
 * > **Terstruktur JSON**, bukan teks bebas. Wajib ada: `request_id`,
 * > `user_id` (kalau ada), `route`, `duration_ms`, `status`. **Tidak boleh
 * > ada**: password, token, isi dokumen, API key.
 *
 * Bawaan Nest mencetak teks berwarna yang enak dibaca manusia dan **tidak bisa
 * di-query**. Saat insiden, pertanyaannya "berapa persen request rute ini yang
 * 5xx dalam sepuluh menit terakhir" — dan itu mustahil dijawab dari teks
 * berwarna tanpa parser yang rapuh.
 *
 * ── Di dev tetap teks berwarna ──
 *
 * JSON satu baris per log membuat `pnpm dev` praktis tidak terbaca. Format
 * ditentukan `LOG_FORMAT`: `json` di produksi, apa pun selainnya memakai
 * ConsoleLogger bawaan. Yang dipilih bukan "mana yang lebih benar" melainkan
 * siapa pembacanya — mesin atau orang yang sedang menulis kode.
 */
export type Konteks = Record<string, unknown>;

/** Lebih dalam dari ini dipotong — lihat alasannya di `saring()`. */
export const BATAS_KEDALAMAN = 6;

/** Kunci yang TIDAK PERNAH boleh ikut, di kedalaman berapa pun. */
const TERLARANG = [
  'password',
  'password_hash',
  'token',
  'access_token',
  'refresh_token',
  'id_token',
  'signature_key',
  'authorization',
  'api_key',
  'apikey',
  'secret',
  'cookie',
  'set-cookie',
];

/**
 * Membuang bidang rahasia SEBELUM apa pun dicetak.
 *
 * Bukan kehati-hatian berlebih: §16.1 menuliskannya tanpa syarat, dan satu-
 * satunya cara menegakkannya adalah di titik cetak. Penyaring yang dipasang di
 * pemanggil akan terlewat oleh pemanggil berikutnya.
 *
 * Nilai diganti `'[dibuang]'`, bukan dihapus: kehadiran bidangnya sendiri
 * sering informasi yang berguna saat menelusuri.
 *
 * ── Batas kedalaman MEMOTONG, tidak melewatkan ──
 *
 * Versi pertama mengembalikan nilai **apa adanya** begitu melewati batas
 * kedalaman. Itu membuat fungsi yang seluruh gunanya menjamin "tidak pernah
 * bocor" punya lubang berbentuk kedalaman: objek berisi `token` di lapis
 * ketujuh lolos utuh ke baris log.
 *
 * Yang lebih buruk, test yang menyentuh kasus itu hanya memastikan ia tidak
 * MELEMPAR — dua puluh lapis dibungkus di sekeliling `{ token }`, dan tidak
 * satu pun assert memeriksa tokennya. Test yang berhenti tepat sebelum
 * pertanyaan yang penting.
 *
 * Sekarang batasnya memotong: lebih dalam dari itu diganti penanda. Biayanya
 * nol untuk konteks log kita (semuanya dangkal), dan sekalian membuat panjang
 * satu baris log punya batas atas.
 */
export function saring(nilai: unknown, kedalaman = 0): unknown {
  if (nilai === null || typeof nilai !== 'object') return nilai;
  if (kedalaman > BATAS_KEDALAMAN) return '[terlalu dalam]';
  if (Array.isArray(nilai)) return nilai.map((x) => saring(x, kedalaman + 1));

  const keluar: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(nilai as Record<string, unknown>)) {
    keluar[k] = TERLARANG.includes(k.toLowerCase()) ? '[dibuang]' : saring(v, kedalaman + 1);
  }
  return keluar;
}

/** `true` kalau log harus berbentuk JSON. */
export function formatJson(): boolean {
  return (process.env['LOG_FORMAT'] ?? '').toLowerCase() === 'json';
}

/** Satu baris JSON. Dipakai logger Nest DAN peristiwa bisnis/metrik. */
export function barisLog(level: LogLevel, pesan: string, konteks: Konteks = {}): string {
  return JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg: pesan,
    ...(saring(konteks) as Konteks),
  });
}

/**
 * `LOG_LEVEL` -> daftar level Nest yang dinyalakan — isu #158.
 *
 * ── Kenapa ini sempat tidak ada ──
 *
 * `LOG_LEVEL` tercantum di PRD §19.2 DAN `.env.example` (`error | warn | info
 * | debug`), dan tidak satu baris kode pun membacanya. Yang benar-benar
 * menentukan sesuatu adalah `LOG_FORMAT`, yang tidak terdokumentasi di
 * keduanya. Jadi orang yang menyetel `LOG_LEVEL=debug` saat insiden tidak
 * mendapat apa pun, lalu mencari sebabnya di tempat yang salah — dan waktu
 * insiden adalah waktu paling mahal untuk itu.
 *
 * ── Kenapa `info`, bukan `log` ──
 *
 * Nama levelnya di Nest `log`; yang ditulis PRD dan dipakai hampir semua
 * perkakas `info`. Yang dipetakan di sini adalah kosakata PRD ke kosakata
 * Nest, bukan sebaliknya: dokumen yang sudah dibaca orang tidak diubah
 * supaya cocok dengan nama internal pustaka.
 *
 * ── Kenapa tidak disetel berarti TIDAK MENYENTUH apa pun ──
 *
 * Memberi bawaan di sini akan mendiamkan log yang selama ini muncul, di
 * setiap lingkungan yang belum menyetelnya sekarang. Perubahan yang membuat
 * baris log HILANG tanpa ada yang memintanya adalah perubahan yang baru
 * ketahuan saat baris itu dibutuhkan.
 */
const TANGGA: Record<string, LogLevel[]> = {
  error: ['fatal', 'error'],
  warn: ['fatal', 'error', 'warn'],
  info: ['fatal', 'error', 'warn', 'log'],
  debug: ['fatal', 'error', 'warn', 'log', 'debug', 'verbose'],
};

/** `undefined` berarti tidak disetel — biarkan bawaan Nest apa adanya. */
export function levelDariEnv(mentah = process.env['LOG_LEVEL']): LogLevel[] | undefined {
  const kunci = (mentah ?? '').trim().toLowerCase();
  if (kunci.length === 0) return undefined;
  return TANGGA[kunci];
}

/**
 * Logger Nest yang mengeluarkan JSON saat `LOG_FORMAT=json`.
 *
 * Meng-extend `ConsoleLogger` alih-alih menulis dari nol supaya seluruh
 * perilaku Nest (level, konteks, `setLogLevels`) tetap jalan apa adanya.
 */
export class StructuredLogger extends ConsoleLogger {
  // Tanpa parameter: kedua pemanggil (`main.ts`) memang tidak mengirim apa
  // pun, dan `ConstructorParameters<typeof ConsoleLogger>` mengambil overload
  // TERAKHIR — yang menuntut dua argumen — sehingga `new StructuredLogger()`
  // berhenti bisa dikompilasi. Kalau suatu saat butuh konteks, tambahkan
  // overload di sini; jangan ganti dengan cast.
  constructor() {
    super();
    const level = levelDariEnv();
    if (level) this.setLogLevels(level);
    else if (process.env['LOG_LEVEL']?.trim()) {
      // Nilai yang di-set tapi tidak dikenali JANGAN didiamkan: ia terlihat
      // seperti konfigurasi yang bekerja. Dilaporkan lewat jalur yang pasti
      // hidup, dan tidak mengubah level apa pun.
      super.warn(
        `LOG_LEVEL="${process.env['LOG_LEVEL']}" tidak dikenali. Yang sah: ${Object.keys(TANGGA).join(' | ')}. Level dibiarkan bawaan.`,
        'StructuredLogger',
      );
    }
  }

  private tulis(level: LogLevel, pesan: unknown, konteksTambahan: unknown[]): void {
    const konteks = konteksTambahan.find((x) => typeof x === 'string');
    process.stdout.write(`${barisLog(level, String(pesan), konteks ? { scope: konteks } : {})}\n`);
  }

  override log(pesan: unknown, ...rest: unknown[]): void {
    if (!formatJson()) return super.log(pesan as string, ...(rest as string[]));
    // Jalur JSON TIDAK lewat `super`, jadi `setLogLevels` tidak menyaringnya.
    // Tanpa baris ini `LOG_LEVEL` bekerja di dev dan diam-diam tidak bekerja
    // di produksi — tempat ia satu-satunya dibutuhkan.
    if (!this.isLevelEnabled('log')) return;
    this.tulis('log', pesan, rest);
  }

  override warn(pesan: unknown, ...rest: unknown[]): void {
    if (!formatJson()) return super.warn(pesan as string, ...(rest as string[]));
    // Jalur JSON TIDAK lewat `super`, jadi `setLogLevels` tidak menyaringnya.
    // Tanpa baris ini `LOG_LEVEL` bekerja di dev dan diam-diam tidak bekerja
    // di produksi — tempat ia satu-satunya dibutuhkan.
    if (!this.isLevelEnabled('warn')) return;
    this.tulis('warn', pesan, rest);
  }

  override error(pesan: unknown, ...rest: unknown[]): void {
    if (!formatJson()) return super.error(pesan as string, ...(rest as string[]));
    // Jalur JSON TIDAK lewat `super`, jadi `setLogLevels` tidak menyaringnya.
    // Tanpa baris ini `LOG_LEVEL` bekerja di dev dan diam-diam tidak bekerja
    // di produksi — tempat ia satu-satunya dibutuhkan.
    if (!this.isLevelEnabled('error')) return;
    this.tulis('error', pesan, rest);
  }

  override debug(pesan: unknown, ...rest: unknown[]): void {
    if (!formatJson()) return super.debug(pesan as string, ...(rest as string[]));
    // Jalur JSON TIDAK lewat `super`, jadi `setLogLevels` tidak menyaringnya.
    // Tanpa baris ini `LOG_LEVEL` bekerja di dev dan diam-diam tidak bekerja
    // di produksi — tempat ia satu-satunya dibutuhkan.
    if (!this.isLevelEnabled('debug')) return;
    this.tulis('debug', pesan, rest);
  }
}
