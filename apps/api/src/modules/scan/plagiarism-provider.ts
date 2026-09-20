/**
 * Antarmuka vendor plagiarisme — **`docs/PRD.md` §12.2**, aturan `KL-12`.
 *
 * Bentuknya disalin dari PRD, bukan dirancang ulang. Versi pertama berkas ini
 * (`K-02`) menyimpang: `submit()` menerima `documentKey` alih-alih
 * `documentUrl`, dan `verifyWebhook`/`parseWebhook` tidak ada sama sekali.
 * PRD menang untuk perilaku (CLAUDE.md), jadi yang diperbaiki ini.
 *
 * Bedanya bukan kosmetik: **`documentUrl`, bukan `documentKey`.** Vendor
 * mengambil dokumennya sendiri lewat signed URL — ia tidak punya akses ke
 * bucket kita dan tidak boleh punya. Antarmuka yang menerima `documentKey`
 * diam-diam mengandaikan vendor bisa membaca storage kita.
 *
 * ── Kenapa ada meski vendornya belum tersambung ──
 *
 * PRD §5 Q7 memilih Copyleaks sebagai vendor pertama dengan catatan bahwa
 * harga kontraknya belum diketahui dan **bisa membuat vendor lain lebih masuk
 * akal**. Antarmuka yang baru dibuat saat vendor kedua datang selalu berbentuk
 * seperti vendor pertama.
 */

export interface PlagiarismSubmission {
  /** `plagiarism_scans.id` — dipakai sebagai `scanId` vendor (PRD §12.2). */
  scanId: string;
  /** Signed URL 15 menit. Vendor mengambil dokumennya sendiri. */
  documentUrl: string;
  filename: string;
}

/** Hasil sukses dari webhook vendor. */
export interface WebhookSuccess {
  scanId: string;
  /** 0..100. */
  score: number;
  reportUrl: string;
}

/** Kegagalan yang dilaporkan vendor — bukan kegagalan jaringan. */
export interface WebhookFailure {
  scanId: string;
  error: string;
}

export type ParsedWebhook = WebhookSuccess | WebhookFailure;

export const isWebhookFailure = (w: ParsedWebhook): w is WebhookFailure => 'error' in w;

export interface PlagiarismProvider {
  /** Nama yang masuk `plagiarism_scans.provider`. */
  readonly name: string;

  /** Mengirim dokumen. Hasilnya datang lewat webhook, bukan dari nilai balik. */
  submit(p: PlagiarismSubmission): Promise<{ providerScanId: string }>;

  /**
   * Apakah webhook ini benar-benar dari vendor.
   *
   * Menerima **`rawBody: Buffer`**, bukan objek yang sudah di-parse, dan itu
   * menentukan: tanda tangan dihitung atas byte yang dikirim. `JSON.parse`
   * lalu `JSON.stringify` mengubah urutan kunci dan spasi, dan tanda tangan
   * yang dihitung ulang dari hasil parse **tidak akan pernah cocok** — atau
   * lebih buruk, kebetulan cocok dan berhenti memeriksa apa pun.
   */
  verifyWebhook(headers: Record<string, string>, rawBody: Buffer): boolean;

  /** Menerjemahkan badan webhook ke bentuk yang dipahami `ScanService`. */
  parseWebhook(body: unknown): ParsedWebhook;
}

/** Token injeksi — satu provider aktif per proses. */
export const PLAGIARISM_PROVIDER = Symbol('PLAGIARISM_PROVIDER');
