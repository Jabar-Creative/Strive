import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Setiap `code` yang dikirim API harus ada di **`docs/PRD.md` §10.2**.
 *
 * PRD menulisnya sendiri, dan tidak setengah-setengah:
 *
 * > **Daftar ini TERTUTUP.** Kode yang tidak ada di sini tidak boleh dikirim
 * > API, karena justru itu sebabnya catatan "tertutup" ini ada.
 *
 * ── Kenapa test ini baru ada sekarang ──
 *
 * Ditemukan saat review bermusuhan atas dua item yang merge kemarin: **enam
 * kode melanggar daftar itu**, tersebar di sepuluh berkas, dan tiga di
 * antaranya kutulis sendiri dalam 24 jam terakhir.
 *
 * Tidak ada yang menangkapnya karena kode error adalah **kontrak** (CLAUDE.md
 * — "kode error adalah KONTRAK, pesan bukan") yang tidak punya penjaga. Test
 * per-modul memeriksa kode yang dipakai modulnya sendiri; tidak ada yang
 * memeriksa keseluruhannya terhadap PRD.
 *
 * ── Kenapa ada daftar karantina, bukan langsung merah ──
 *
 * Keenam kode itu menjawab kondisi yang NYATA dan **tidak punya padanan** di
 * daftar §10.2 — tidak ada kode validasi umum, tidak ada untuk tanda tangan
 * webhook, tidak ada untuk vendor yang mati. Daftarnya ditutup sebelum sistem
 * yang benar-benar dibangun selesai.
 *
 * Memperbaikinya berarti menambah baris ke PRD, dan itu keputusan manusia
 * (isu #92). Sampai itu diputuskan, keenamnya dikarantina EKSPLISIT di bawah:
 * test ini menangkap kode BARU yang melanggar, tanpa merah karena yang lama.
 *
 * **Jangan menambah entri ke karantina tanpa isu yang menyertainya.** Daftar
 * pengecualian yang tumbuh diam-diam adalah daftar yang berhenti berarti.
 */

const AKAR = join(__dirname, '..', '..');
const PRD = join(AKAR, '..', '..', 'docs', 'PRD.md');

/**
 * Kode yang SUDAH dipakai sebelum test ini ada dan belum punya padanan di
 * §10.2. Setiap baris menunggu keputusan di isu #92 — bukan izin permanen.
 */
const KARANTINA = new Set([
  'VALIDATION_ERROR', // tidak ada kode validasi umum di §10.2
  'INVALID_SIGNATURE', // tanda tangan webhook — tidak ada padanannya
  'PROVIDER_UNAVAILABLE', // vendor mati — tidak ada padanannya
  'PRICING_NOT_CONFIGURED', // P-01
  'INVALID_PRICING_PAYLOAD', // SA-02
  'PRICING_VERSION_CONFLICT', // SA-02
]);

function kodeSahDariPrd(): Set<string> {
  const prd = readFileSync(PRD, 'utf8');
  const mulai = prd.indexOf('### 10.2');
  const akhir = prd.indexOf('### 10.3');
  if (mulai === -1 || akhir === -1) throw new Error('PRD §10.2 tidak ditemukan');
  return new Set([...prd.slice(mulai, akhir).matchAll(/^\| `([A-Z_]+)` \|/gm)].map((m) => m[1]!));
}

/** Semua `.ts` di `src`, kecuali test. */
function berkasSumber(dir: string, out: string[] = []): string[] {
  for (const nama of readdirSync(dir)) {
    const p = join(dir, nama);
    if (statSync(p).isDirectory()) berkasSumber(p, out);
    else if (nama.endsWith('.ts') && !nama.endsWith('.spec.ts') && !nama.endsWith('.d.ts')) {
      out.push(p);
    }
  }
  return out;
}

const sah = kodeSahDariPrd();
const dipakai = new Map<string, Set<string>>();
for (const berkas of berkasSumber(join(AKAR, 'src'))) {
  const isi = readFileSync(berkas, 'utf8');
  for (const m of isi.matchAll(/code: '([A-Z_]+)'/g)) {
    const k = m[1]!;
    if (!dipakai.has(k)) dipakai.set(k, new Set());
    dipakai.get(k)!.add(berkas.slice(AKAR.length + 1));
  }
}

describe('Kode error vs daftar TERTUTUP di PRD §10.2', () => {
  it('daftar PRD terbaca — kalau kosong, test ini tidak menjaga apa pun', () => {
    expect(sah.size).toBeGreaterThan(15);
    expect(sah.has('INSUFFICIENT_COINS')).toBe(true);
  });

  it('ada kode yang terbaca dari sumber', () => {
    // Tanpa ini, perubahan yang membuat pemindainya mengembalikan nol berkas
    // akan membuat test di bawah lulus dengan hampa.
    expect(dipakai.size).toBeGreaterThan(10);
  });

  it('tidak ada kode BARU di luar §10.2', () => {
    const melanggar = [...dipakai.entries()]
      .filter(([k]) => !sah.has(k) && !KARANTINA.has(k))
      .map(([k, berkas]) => `${k} (${[...berkas].join(', ')})`);

    expect(
      melanggar,
      'Kode error adalah KONTRAK, dan daftar §10.2 TERTUTUP. Pakai kode yang ada, ' +
        'atau ajukan penambahan ke PRD lebih dulu — jangan tambahkan ke KARANTINA.',
    ).toEqual([]);
  });

  it('karantina tidak memuat kode yang sudah TIDAK dipakai lagi', () => {
    // Karantina yang memuat kode mati akan menyembunyikan kalau masalahnya
    // sudah selesai — dan daftar pengecualian yang tidak pernah mengecil
    // adalah daftar yang berhenti dibaca orang.
    const mati = [...KARANTINA].filter((k) => !dipakai.has(k));
    expect(mati, 'kode ini sudah tidak dipakai — hapus dari KARANTINA').toEqual([]);
  });

  it('karantina tidak memuat kode yang ternyata SAH', () => {
    const sudahSah = [...KARANTINA].filter((k) => sah.has(k));
    expect(sudahSah, 'kode ini sudah masuk PRD §10.2 — hapus dari KARANTINA').toEqual([]);
  });
});
