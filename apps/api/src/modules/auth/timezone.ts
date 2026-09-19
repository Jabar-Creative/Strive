/**
 * Bentuk minimal Standard Schema (v1) yang dibutuhkan Better-Auth.
 *
 * Ditulis ulang di sini alih-alih mengimpor `@standard-schema/spec`: paket itu
 * dependensi TRANSITIF Better-Auth, bukan dependensi langsung `apps/api`.
 * Mengimpor dari paket transitif berarti bergantung pada detail pohon
 * dependensi orang lain — hilang tanpa peringatan saat Better-Auth menaikkan
 * versinya, dan gejalanya error typecheck di berkas yang tidak diubah siapa
 * pun. Standard Schema memang spesifikasi struktural: apa pun yang berbentuk
 * begini diterima, tanpa perlu paketnya.
 */
interface SkemaStandar<Output> {
  readonly '~standard': {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (
      nilai: unknown,
    ) => { value: Output; issues?: undefined } | { issues: ReadonlyArray<{ message: string }> };
  };
}

/**
 * Validasi zona waktu IANA untuk AU-7 (isu #65 poin 2).
 *
 * ── Kenapa ini bukan sekadar "cek string" ──
 *
 * Nilai ini berakhir di `users.timezone`, dan aturan keras 5 memakainya
 * langsung di SQL:
 *
 *     (now() AT TIME ZONE users.timezone)::date
 *
 * Kalau PostgreSQL tidak mengenal namanya, query itu **melempar saat
 * dijalankan** — bukan saat registrasi. Gejalanya muncul berhari-hari
 * kemudian sebagai "streak saya error", di kode yang tidak menyentuh auth
 * sama sekali. Jadi yang harus dijamin validator ini bukan "IANA yang sah",
 * tapi **"nama yang pasti diterima PostgreSQL"**.
 *
 * ── Daftar izinnya diverifikasi, bukan diasumsikan ──
 *
 * `Intl.supportedValuesOf('timeZone')` memberi 418 nama kanonik. Dibandingkan
 * terhadap `pg_timezone_names` (599 nama) di PostgreSQL 16 yang dipakai repo
 * ini: **nol** yang ditolak. Daftar ICU adalah himpunan bagian yang aman.
 *
 * Dua hal yang ketahuan saat memverifikasinya, dan keduanya mengejutkan:
 *
 * 1. **`'UTC'` TIDAK ada di `Intl.supportedValuesOf('timeZone')`.** Memakai
 *    daftar itu apa adanya akan menolak zona waktu paling umum di dunia.
 *    Makanya ia ditambahkan eksplisit di bawah — dan sudah diperiksa ada di
 *    `pg_timezone_names`.
 * 2. **`Asia/Kolkata` dikanonikalkan Node jadi `Asia/Calcutta`**, bukan
 *    sebaliknya. Nama modern jadi nama lawas. Keduanya diterima PostgreSQL,
 *    jadi tidak jadi masalah — tapi jangan kaget melihat `Asia/Calcutta`
 *    tersimpan padahal yang dikirim `Asia/Kolkata`.
 *
 * ── Zona offset tetap (`Etc/GMT+7`) sengaja DITOLAK ──
 *
 * Ia lolos `Intl.DateTimeFormat` tapi tidak ada di daftar kanonik. Itu bukan
 * zona waktu manusia: ia tidak punya aturan DST dan tidak pernah berubah.
 * Mahasiswa tidak tinggal di `Etc/GMT+7`, mereka tinggal di `Asia/Jakarta`.
 * Menerimanya berarti menerima nilai yang tidak bisa dikoreksi belakangan.
 */

/** Fallback AU-7 kalau klien tidak mengirim apa pun. Sama dengan default kolomnya. */
export const ZONA_DEFAULT = 'Asia/Jakarta';

/**
 * Daftar izin: nama kanonik ICU + `UTC`.
 *
 * Dibangun sekali saat modul dimuat. 419 entri — cukup kecil untuk `Set`, dan
 * pencariannya O(1) di jalur registrasi.
 */
const ZONA_DIIZINKAN: ReadonlySet<string> = new Set([...Intl.supportedValuesOf('timeZone'), 'UTC']);

/**
 * Bentuk kanonik sebuah zona waktu, atau `null` kalau ICU tidak mengenalnya.
 *
 * Ini yang membuat `asia/jakarta` dan `ASIA/JAKARTA` diterima: keduanya
 * dikanonikalkan jadi `Asia/Jakarta`. Bersikap longgar pada apa yang
 * diterima, ketat pada apa yang disimpan.
 */
function kanonik(nilai: string): string | null {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: nilai }).resolvedOptions().timeZone;
  } catch {
    // RangeError = ICU tidak mengenalnya. Bukan kondisi luar biasa di jalur
    // ini — input dari internet memang begitu.
    return null;
  }
}

/** Bentuk kanonik yang PASTI diterima PostgreSQL, atau `null`. */
export function zonaWaktuKanonik(nilai: unknown): string | null {
  if (typeof nilai !== 'string') return null;
  const k = kanonik(nilai);
  return k !== null && ZONA_DIIZINKAN.has(k) ? k : null;
}

/** Apakah nilai ini zona waktu yang aman dipakai di `AT TIME ZONE`. */
export function zonaWaktuSah(nilai: unknown): nilai is string {
  return zonaWaktuKanonik(nilai) !== null;
}

/**
 * Skema Standard Schema untuk `additionalFields.timezone` Better-Auth.
 *
 * Ditulis tangan, bukan memakai zod: `apps/api` tidak punya zod sebagai
 * dependensi, dan ia HANYA boleh `import type` dari `@strive/contracts`
 * (jebakan `ERR_UNSUPPORTED_DIR_IMPORT` di CLAUDE.md). Standard Schema
 * memang dirancang supaya bisa diimplementasikan tanpa pustaka —
 * Better-Auth menerima objek apa pun yang memenuhi bentuk ini.
 *
 * `validate` mengembalikan bentuk KANONIK, bukan nilai aslinya. Jadi yang
 * tersimpan di `users.timezone` selalu nama yang sudah dinormalkan.
 */
export const skemaZonaWaktu: SkemaStandar<string> = {
  '~standard': {
    version: 1,
    vendor: 'strive',
    validate: (nilai: unknown) => {
      const k = zonaWaktuKanonik(nilai);
      if (k !== null) return { value: k };
      return {
        issues: [
          {
            message:
              `Zona waktu tidak dikenal: ${JSON.stringify(nilai)}. ` +
              `Pakai nama IANA seperti "Asia/Jakarta", "Asia/Makassar", atau "Asia/Jayapura".`,
          },
        ],
      };
    },
  },
};
