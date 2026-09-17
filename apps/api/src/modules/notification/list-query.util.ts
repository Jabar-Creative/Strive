import type { ListNotificationsQuery } from '@strive/contracts';

/**
 * Validasi manual untuk `GET /notifications?cursor=&limit=` — SENGAJA bukan
 * `listNotificationsQuerySchema.safeParse()` dari `@strive/contracts`,
 * walau skema zod itu ADALAH kontrak kanoniknya (bakal dipakai form/hook di
 * sisi web untuk N-02).
 *
 * GAP FONDASI YANG DITEMUKAN & DIBUKTIKAN saat mengerjakan N-01 (bukan
 * dugaan — direproduksi langsung):
 *
 * `packages/contracts/package.json` mengirim `"main": "./src/index.ts"` —
 * TypeScript MENTAH, bukan hasil kompilasi. Ini aman untuk `apps/web`
 * (Next.js) dan Vitest (keduanya lewat bundler yang transpile `.ts` on the
 * fly) DAN aman untuk `apps/api` selama importnya `import type` (dihapus
 * total saat `tsc` mengompilasi — tidak ada jejak di JS hasil build).
 *
 * Tapi begitu `apps/api` mengimpor sebuah NILAI (bukan tipe) dari paket itu
 * — misalnya skema zod untuk dipanggil `.safeParse()` — hasil kompilasi
 * `nest build` memuat `require('@strive/contracts')` sungguhan. Producation
 * runtime-nya adalah `node dist/main.js` (persis command di
 * `infra/Dockerfile.api`), dan Node TIDAK BISA mem-parsing `.ts` mentah:
 *
 *   node dist/main.js
 *   Error [ERR_UNSUPPORTED_DIR_IMPORT]: Directory import
 *   '…/packages/contracts/src/common' is not supported resolving ES
 *   modules imported from …/packages/contracts/src/index.ts
 *
 * Terverifikasi sungguhan di sesi N-01 ini (build sukses, tapi `node
 * dist/main.js` CRASH saat boot — persis pola "build hijau tapi rusak" yang
 * sudah pernah terjadi di repo ini untuk `tsc --incremental`, lihat
 * CLAUDE.md §Yang benar-benar terjadi). Ini import NILAI PERTAMA dari
 * `apps/api` ke `@strive/contracts` — sebelumnya (`health.controller.ts`)
 * selalu `import type`, jadi lubang ini belum pernah ketahuan.
 *
 * PERBAIKAN YANG BENAR (di luar scope N-01, butuh keputusan tim karena
 * menyentuh pipeline build/CI semua modul):
 *   (a) `packages/contracts` benar-benar dikompilasi ke JS (`tsc` emit,
 *       bukan `noEmit`) lalu `main`/`exports` diarahkan ke `dist/` — tapi ini
 *       menambah urutan build baru: `pnpm test` di CI (job `node`) jalan
 *       SEBELUM `pnpm build`, jadi test `apps/api` akan gagal resolve
 *       `@strive/contracts` kalau dist-nya belum pernah dibangun.
 *   (b) `apps/api` pindah ke builder webpack Nest CLI supaya dependensi
 *       workspace ikut di-bundle saat compile — butuh webpack config custom
 *       supaya `@strive/contracts` TIDAK di-externalize seperti dependency
 *       npm biasa.
 * Keduanya perubahan config bersama, bukan yang aman disisipkan diam-diam di
 * satu PR fitur. Dilaporkan di laporan PR N-01 untuk keputusan tim.
 *
 * Aturan di bawah ini SENGAJA meniru persis `listNotificationsQuerySchema`
 * (limit 1-50, default 20) supaya tidak ada drift diam-diam — kalau skema
 * kanoniknya berubah, ubah juga di sini sampai gap di atas beres.
 */
export function parseListNotificationsQuery(
  raw: unknown,
): { ok: true; value: ListNotificationsQuery } | { ok: false; details: Record<string, string> } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, details: { query: 'harus berupa objek query string' } };
  }
  const record = raw as Record<string, unknown>;
  const details: Record<string, string> = {};

  let cursor: string | undefined;
  const cursorRaw = record['cursor'];
  if (cursorRaw !== undefined) {
    if (typeof cursorRaw !== 'string' || cursorRaw.length === 0) {
      details['cursor'] = 'harus string tidak kosong';
    } else {
      cursor = cursorRaw;
    }
  }

  let limit = 20;
  const limitRaw = record['limit'];
  if (limitRaw !== undefined) {
    // Express bisa memberi array kalau parameter diulang (`?limit=1&limit=2`) —
    // ditolak eksplisit, bukan diam-diam mengambil elemen pertama.
    if (Array.isArray(limitRaw) || (typeof limitRaw !== 'string' && typeof limitRaw !== 'number')) {
      details['limit'] = 'harus satu angka';
    } else {
      const parsedLimit = Number(limitRaw);
      if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 50) {
        details['limit'] = 'harus bilangan bulat 1-50';
      } else {
        limit = parsedLimit;
      }
    }
  }

  if (Object.keys(details).length > 0) {
    return { ok: false, details };
  }
  return { ok: true, value: { cursor, limit } };
}
