/**
 * Antarmuka vendor plagiarisme — `KL-12`, dan ia ada **sejak awal** justru
 * karena belum ada implementasinya.
 *
 * PRD §5 Q7 memilih Copyleaks sebagai vendor pertama, dengan catatan bahwa
 * harga kontraknya belum diketahui dan **bisa membuat vendor lain lebih
 * masuk akal**. Antarmuka yang baru dibuat saat vendor kedua datang selalu
 * berbentuk seperti vendor pertama — dan pindah vendor lalu jadi pekerjaan
 * berminggu-minggu alih-alih berhari-hari.
 *
 * Implementasinya datang di `K-03`. Yang ada di sini hanya bentuknya, dan
 * bentuk itu sengaja **tidak menyebut Copyleaks sama sekali**.
 */
export interface PlagiarismSubmission {
  /** Kunci objek di object storage — vendor mengambilnya lewat signed URL. */
  documentKey: string;
  documentSha256: string;
  filename: string;
}

export interface PlagiarismResult {
  /** Id scan di sisi vendor, untuk mencocokkan webhook. */
  providerScanId: string;
  /** 0..100. Disimpan `numeric(5,2)`. */
  similarityScore: number;
  /** Kunci objek laporan, diunduh lewat signed URL 15 menit (KL-10). */
  reportKey: string;
  wordCount: number;
}

export interface PlagiarismProvider {
  /** Nama yang masuk `plagiarism_scans.provider`. */
  readonly name: string;
  /** Mengirim dokumen. Mengembalikan id vendor; hasilnya datang lewat webhook. */
  submit(input: PlagiarismSubmission): Promise<{ providerScanId: string }>;
}
