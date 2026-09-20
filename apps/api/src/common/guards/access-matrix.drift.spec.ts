import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { AppModule } from '../../app.module';
import { ACCESS_MATRIX } from './access-matrix';
import { ROLES_KEY, type UserRole } from './roles.decorator';

/**
 * `ACCESS_MATRIX` **harus sama dengan apa yang benar-benar ditegakkan** — isu #68.
 *
 * ── Kenapa test ini ada ──
 *
 * Sebelum ini `ACCESS_MATRIX` tidak dibaca satu pun kode non-test. Penegakan
 * sesungguhnya ada di `@Roles(...)` per-controller. Dua tempat menyatakan hal
 * yang sama, dan tidak ada yang memeriksa keduanya sepakat — pola yang persis
 * diperingatkan komentar migrasi 005: **dua sumber untuk satu fakta akan
 * menyimpang.**
 *
 * Dan sudah menyimpang. Saat test ini ditulis, **enam rute berdiri di API tanpa
 * tercatat di matriks sama sekali** — termasuk `GET /pricing`, yang tidak punya
 * guard apa pun.
 *
 * 91 test di `access-matrix.spec.ts` membuktikan matriks konsisten dengan
 * DIRINYA SENDIRI. Berkas ini yang membuktikan ia konsisten dengan **kode yang
 * berjalan**.
 *
 * ── Kenapa metadata, bukan regex atas berkas sumber ──
 *
 * Yang dibaca di sini adalah metadata dekorator yang SAMA dengan yang dibaca
 * Nest saat runtime — `Reflect.getMetadata`, bukan pencocokan teks. Regex atas
 * `@Roles(...)` akan meleset pada dekorator yang ditulis beda spasi, di-alias,
 * atau diwarisi dari kelas induk. Metadata tidak bisa berbohong: ia persis apa
 * yang akan dipakai `RolesGuard`.
 *
 * Tidak ada aplikasi yang di-boot dan tidak ada database yang disentuh — ini
 * unit test, dan ia berjalan di job CI `node` yang memang tidak punya
 * PostgreSQL.
 */

type Kelas = new (...args: never[]) => unknown;

/** Rute sungguhan yang ditegakkan Nest, diturunkan dari metadata dekoratornya. */
interface RuteNyata {
  kunci: string;
  allow: readonly UserRole[];
  controller: string;
}

const METODE: Record<number, string> = {
  [RequestMethod.GET]: 'GET',
  [RequestMethod.POST]: 'POST',
  [RequestMethod.PUT]: 'PUT',
  [RequestMethod.DELETE]: 'DELETE',
  [RequestMethod.PATCH]: 'PATCH',
  [RequestMethod.ALL]: 'ALL',
  [RequestMethod.OPTIONS]: 'OPTIONS',
  [RequestMethod.HEAD]: 'HEAD',
};

/** Menelusuri graf modul dari `AppModule` dan mengumpulkan seluruh controller. */
function semuaController(mod: unknown, lihat = new Set<unknown>()): Kelas[] {
  if (!mod || lihat.has(mod)) return [];
  lihat.add(mod);
  const ctrl = (Reflect.getMetadata('controllers', mod as object) ?? []) as Kelas[];
  const imports = (Reflect.getMetadata('imports', mod as object) ?? []) as unknown[];
  return [...ctrl, ...imports.flatMap((m) => semuaController(m, lihat))];
}

function gabung(...bagian: string[]): string {
  const p = bagian
    .map((x) => x.replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/');
  return `/${p}`;
}

function ruteNyata(): RuteNyata[] {
  const hasil: RuteNyata[] = [];

  for (const Ctrl of semuaController(AppModule)) {
    const prefix = (Reflect.getMetadata('path', Ctrl) ?? '') as string;
    const peranKelas = Reflect.getMetadata(ROLES_KEY, Ctrl) as UserRole[] | undefined;
    const proto = Ctrl.prototype as Record<string, unknown>;

    for (const nama of Object.getOwnPropertyNames(proto)) {
      if (nama === 'constructor') continue;
      const fn = proto[nama];
      if (typeof fn !== 'function') continue;

      const path = Reflect.getMetadata('path', fn) as string | undefined;
      const metode = Reflect.getMetadata('method', fn) as number | undefined;
      if (path === undefined || metode === undefined) continue;

      // Peran di METODE menimpa peran di KELAS — urutan yang sama dengan
      // `reflector.getAllAndOverride` di RolesGuard.
      const allow =
        (Reflect.getMetadata(ROLES_KEY, fn) as UserRole[] | undefined) ?? peranKelas ?? [];

      hasil.push({
        kunci: `${METODE[metode]} ${gabung(prefix, path)}`,
        allow,
        controller: Ctrl.name,
      });
    }
  }
  return hasil.sort((a, b) => a.kunci.localeCompare(b.kunci));
}

/** Apakah aturan matriks (boleh berakhiran `*`) mencakup rute ini. */
function cocok(aturan: string, rute: string): boolean {
  if (aturan === rute) return true;
  const [mAturan, pAturan] = aturan.split(' ');
  const [mRute, pRute] = rute.split(' ');
  if (mAturan !== 'ALL' && mAturan !== mRute) return false;
  if (!pAturan?.endsWith('/*')) return false;
  return pRute!.startsWith(pAturan.slice(0, -1));
}

const nyata = ruteNyata();

describe('ACCESS_MATRIX vs rute yang benar-benar terpasang (isu #68)', () => {
  it('ada rute yang terbaca — kalau nol, test ini tidak menjaga apa pun', () => {
    // Tanpa assert ini, perubahan yang membuat `semuaController` mengembalikan
    // daftar kosong akan membuat SELURUH test di bawah lulus dengan hampa.
    expect(nyata.length).toBeGreaterThan(5);
  });

  it('setiap rute yang terpasang ADA di ACCESS_MATRIX', () => {
    const hilang = nyata
      .filter((r) => !ACCESS_MATRIX.some((a) => cocok(a.route, r.kunci)))
      .map((r) => `${r.kunci}  (${r.controller})`);

    expect(
      hilang,
      'rute berdiri tapi tidak tercatat di ACCESS_MATRIX — tambahkan aturannya, ' +
        'termasuk kalau rutenya memang publik (allow: [])',
    ).toEqual([]);
  });

  it('peran di @Roles() SAMA PERSIS dengan ACCESS_MATRIX', () => {
    const beda: string[] = [];

    for (const r of nyata) {
      const aturan = ACCESS_MATRIX.find((a) => cocok(a.route, r.kunci));
      if (!aturan) continue; // sudah dilaporkan test di atas

      const a = [...aturan.allow].sort().join(',') || '(publik)';
      const b = [...r.allow].sort().join(',') || '(publik)';
      if (a !== b) beda.push(`${r.kunci}: matriks=${a} · kode=${b} (${r.controller})`);
    }

    expect(
      beda,
      'ACCESS_MATRIX dan @Roles() menyatakan peran yang BERBEDA untuk rute yang sama. ' +
        'Matriks bukan dokumentasi — ia harus sama dengan yang ditegakkan.',
    ).toEqual([]);
  });

  it('tidak ada rute yang lolos tanpa peran padahal matriks menuntutnya', () => {
    // Kebalikan dari test di atas, dinyatakan terpisah supaya kegagalannya
    // langsung terbaca sebagai LUBANG, bukan sekadar "beda".
    const bocor = nyata
      .filter((r) => r.allow.length === 0)
      .filter((r) => {
        const aturan = ACCESS_MATRIX.find((a) => cocok(a.route, r.kunci));
        return aturan !== undefined && aturan.allow.length > 0;
      })
      .map((r) => `${r.kunci} (${r.controller})`);

    expect(bocor, 'rute tanpa @Roles() padahal matriks membatasinya').toEqual([]);
  });

  it('setiap rute publik di matriks punya alasan tertulis', () => {
    // `allow: []` berarti siapa pun, termasuk yang belum login. Itu keputusan
    // yang pantas dijelaskan — dan `note` membuat reviewer berikutnya bisa
    // membedakan "publik disengaja" dari "lupa menulis @Roles".
    const tanpaAlasan = ACCESS_MATRIX.filter((a) => a.allow.length === 0 && !a.note).map(
      (a) => a.route,
    );
    expect(tanpaAlasan, 'rute publik tanpa catatan alasan').toEqual([]);
  });
});
