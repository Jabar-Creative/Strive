/**
 * Membuang kunci jawaban sebelum konten kartu dikirim ke client (LE-3).
 *
 * Dibuang REKURSIF berdasarkan NAMA FIELD, bukan lewat jalur `content.options[]`
 * yang spesifik. Bedanya penting: `order_steps` dan `reveal` ada di skema tapi
 * belum ada di UI (docs/PRD.md §22), dan bentuk `content`-nya belum ditetapkan.
 * Serializer yang menebak bentuk akan membocorkan tipe kartu berikutnya tanpa
 * ada yang menyadarinya — dan bocornya tidak terlihat di UI, cuma di tab network.
 *
 * Harga yang dibayar: field bernama `why` yang BUKAN kunci jawaban juga ikut
 * terbuang. Itu pertukaran yang disengaja — kehilangan satu field yang salah
 * nama jauh lebih murah daripada membocorkan jawaban, dan `ANSWER_KEY_FIELDS`
 * punya test yang memaksa daftar ini tetap sadar diubah.
 */

/** Persis yang disebut LE-3. Menambah di sini = menambah di test juga. */
export const ANSWER_KEY_FIELDS = new Set(['correct', 'why']);

/**
 * Menyalin `value` tanpa field kunci jawaban, di kedalaman berapa pun.
 * Input tidak diubah — serializer tidak boleh punya efek samping ke baris
 * yang mungkin dipakai pemanggil lain di request yang sama.
 */
export function stripAnswerKeys<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripAnswerKeys(item)) as unknown as T;
  }

  // `typeof null === 'object'`, jadi null harus disaring lebih dulu.
  if (value === null || typeof value !== 'object') {
    return value;
  }

  // Date dan sejenisnya bukan bag-of-fields; menyalin entry-nya akan merusaknya.
  if (value instanceof Date) return value;

  const hasil: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (ANSWER_KEY_FIELDS.has(key)) continue;
    hasil[key] = stripAnswerKeys(nested);
  }
  return hasil as T;
}
