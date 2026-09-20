#!/usr/bin/env node
// Penyisiran rute: PRD §10.3 <-> ACCESS_MATRIX <-> item backlog.
//
// ── Kenapa skrip ini ada ──
//
// Tiga item sudah lahir dari "pekerjaan yang jatuh di antara dua item":
// `F-12` (job partisi, isu #14), `F-13` (`pnpm seed`, isu #69), dan `Q-06`
// (endpoint squad, isu #79). Ketiganya ditemukan dengan cara yang sama —
// **mencoba memakai hasilnya**, bukan membaca papan. Tidak satu pun tertangkap
// oleh pembacaan papan, karena papan hanya tahu apa yang tertulis di dalamnya.
//
// ── Apa yang BUKAN dijawab test drift ──
//
// `access-matrix.drift.spec.ts` (isu #68) membandingkan **matriks <-> kode**:
// ia menangkap rute yang SUDAH BERDIRI tapi tidak tercatat. Ia tidak bisa
// menangkap rute yang **dijanjikan PRD tapi belum dibangun siapa pun** —
// rute itu tidak ada di kode, jadi tidak ada yang dibandingkan.
//
// Skrip ini yang menjawab pertanyaan itu: untuk setiap rute yang dijanjikan
// PRD kepada klien, adakah item yang berjanji membangunnya?
//
// ── Dua sinyal EKSAK, dan irisannya yang berarti ──
//
// Versi pertama skrip ini mencoba menebak item pemilik dari kata kunci path.
// Hasilnya 39-46 dari 59 rute dilaporkan yatim — kebanyakan positif palsu,
// karena item menjelaskan perilakunya dalam prosa: `L-01` berjudul "API baca
// track/modul/lesson/kartu" dan jelas membangun `GET /tracks`, tanpa pernah
// menulis path-nya. Daftar yang isinya kebanyakan positif palsu adalah daftar
// yang dimatikan orang, jadi penebakan itu DIBUANG.
//
// Yang tersisa dua sinyal yang tidak perlu ditebak:
//
//   A · rute PRD yang TIDAK ADA di ACCESS_MATRIX       (perbandingan harfiah)
//   B · rute PRD yang path-nya TIDAK PERNAH disebut
//       di seluruh docs/BACKLOG.md                      (pencarian harfiah)
//
// **Irisan A ∩ B** yang actionable: rute yang dijanjikan ke klien, tidak
// tercatat di postur aksesnya, dan tidak disebut item mana pun dengan kata
// apa pun. Itu bukan tebakan.
//
// B sendirian berisik (item berprosa), A sendirian wajar (rute masa depan
// memang belum masuk matriks). Yang keduanya sekaligus, tidak wajar.
//
//   node scripts/audit-rute.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const akar = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baca = (p) => fs.readFileSync(path.join(akar, p), 'utf8');

// ── 1 · rute yang DIJANJIKAN PRD §10.3 ────────────────────────────────────
const prd = baca('docs/PRD.md');
const mulai = prd.indexOf('### 10.3 Endpoint');
if (mulai === -1) throw new Error('PRD §10.3 tidak ditemukan — apakah judulnya berubah?');
const sisa = prd.slice(mulai);
const seksi = sisa.slice(0, sisa.indexOf('\n### ', 10));

const rutePrd = [];
const re = /^\|\s*`(GET|POST|PATCH|PUT|DELETE)`[^|]*\|\s*`([^`]+)`\s*\|\s*([^|]*)\|/gm;
for (let m; (m = re.exec(seksi)) !== null;) {
  rutePrd.push({
    rute: `${m[1]} ${m[2].split('?')[0]}`,
    peran: m[3].trim(),
    path: m[2].split('?')[0],
  });
}

// ── 2 · aturan ACCESS_MATRIX ──────────────────────────────────────────────
const mat = baca('apps/api/src/common/guards/access-matrix.ts');
const matriks = [...mat.matchAll(/route: '([^']+)'/g)].map((m) => m[1]);

const cocokMatriks = (rute) =>
  matriks.find((a) => {
    if (a === rute) return true;
    const [ma, pa] = a.split(' ');
    const [mr, pr] = rute.split(' ');
    return (ma === 'ALL' || ma === mr) && pa.endsWith('/*') && pr.startsWith(pa.slice(0, -1));
  }) ?? null;

// ── 3 · item backlog yang MENYEBUT path-nya ───────────────────────────────
const bl = baca('docs/BACKLOG.md');
const status = Object.fromEntries(
  [...bl.matchAll(/^\| `([A-Z]+-\d+)` \|.*?\| `(\w+)` \|/gm)].map((m) => [m[1], m[2]]),
);

/** Blok teks setiap item + baris papannya, sekali baca. */
const blokItem = (() => {
  const out = {};
  for (const m of bl.matchAll(/^### `([A-Z]+-\d+)` — (.*)$/gm)) {
    const berikut = bl.indexOf('\n### ', m.index + 1);
    out[m[1]] = bl.slice(m.index, berikut === -1 ? undefined : berikut);
  }
  for (const m of bl.matchAll(/^\| `([A-Z]+-\d+)` \|(.*)$/gm)) {
    out[m[1]] = (out[m[1]] ?? '') + m[2];
  }
  return out;
})();

/**
 * Item yang menyebut rute ini secara HARFIAH. Tanpa tebakan.
 *
 * METODE ikut dihitung, dan itu bukan kerewelan: `/attempts` muncul di `L-03`
 * sebagai `POST /attempts`, dan `/me` muncul di `Q-06` sebagai `/squads/me`.
 * Pencarian substring polos melaporkan keduanya "sudah ada pemiliknya" —
 * padahal `GET /attempts` dan `PATCH /me` tidak dibangun siapa pun.
 *
 * Aturannya: kemunculan path DIABAIKAN kalau tepat sebelumnya ada metode HTTP
 * yang BERBEDA, atau kalau ia bagian dari path yang lebih panjang.
 */
const METODE = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'];

function menyebut(blok, metode, path) {
  let i = -1;
  while ((i = blok.indexOf(path, i + 1)) !== -1) {
    // Bagian dari path yang lebih panjang? `/me` di dalam `/squads/me`.
    const sebelumnya = blok[i - 1];
    if (sebelumnya && /[A-Za-z0-9/_:-]/.test(sebelumnya)) continue;
    // Metode lain tepat di depannya?
    const awalan = blok.slice(Math.max(0, i - 10), i);
    const lain = METODE.find((m) => m !== metode && awalan.trim().endsWith(m));
    if (lain) continue;
    return true;
  }
  return false;
}

const penyebut = (metode, path) =>
  Object.entries(blokItem)
    .filter(([, b]) => menyebut(b, metode, path))
    .map(([id]) => id);

// ── laporan ───────────────────────────────────────────────────────────────
const takDiMatriks = [];
const takDisebut = [];
const irisan = [];

for (const r of rutePrd) {
  const m = cocokMatriks(r.rute);
  const own = penyebut(r.rute.split(' ')[0], r.path);
  if (!m) takDiMatriks.push(r);
  if (own.length === 0) takDisebut.push(r);
  if (!m && own.length === 0) irisan.push(r);
}

const garis = '='.repeat(76);
console.log(garis);
console.log(`PENYISIRAN RUTE — ${rutePrd.length} rute dijanjikan PRD §10.3 kepada klien`);
console.log(garis);

console.log(`\n■■ PERLU DITINDAK: tidak di ACCESS_MATRIX DAN tidak disebut item mana pun`);
console.log(`   ${irisan.length} rute\n`);
for (const r of irisan) console.log(`   ${r.rute.padEnd(38)} peran=${r.peran}`);

console.log(`\n□ konteks A — tidak ada di ACCESS_MATRIX: ${takDiMatriks.length}`);
for (const r of takDiMatriks) {
  const tanda = irisan.includes(r) ? '  <-- irisan' : '';
  console.log(`   ${r.rute.padEnd(38)}${tanda}`);
}

console.log(`\n□ konteks B — path tidak pernah disebut di BACKLOG: ${takDisebut.length}`);
console.log('   (berisik sendirian: item menjelaskan perilakunya dalam prosa, tanpa path)');

// Kebalikannya: aturan matriks yang tidak dijanjikan PRD.
const setPrd = new Set(rutePrd.map((r) => r.rute));
const liar = matriks.filter((a) => {
  if (setPrd.has(a)) return false;
  if (a.endsWith('/*')) {
    const pa = a.split(' ')[1].slice(0, -1);
    return ![...setPrd].some((r) => r.split(' ')[1].startsWith(pa));
  }
  return true;
});
console.log(`\n□ ada di ACCESS_MATRIX tapi tidak di PRD §10.3: ${liar.length}`);
for (const l of liar) console.log(`   ${l}`);

console.log(`\n${garis}`);
console.log(
  `Item terbaca: ${Object.keys(blokItem).length} · status diketahui: ${Object.keys(status).length}`,
);
console.log(garis);

// Sengaja TIDAK keluar dengan kode != 0. Skrip ini alat telusur, bukan gerbang
// CI: sebagian "yatim" memang rute masa depan yang itemnya belum ditulis, dan
// membuat CI merah karenanya akan membuat orang mematikannya.
