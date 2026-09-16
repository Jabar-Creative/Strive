#!/usr/bin/env node
// Pipeline seed konten — F-11 (docs/BACKLOG.md).
//
// `pnpm seed:content <file>` mengimpor SATU track lengkap (track -> modules ->
// lessons -> lesson_cards) dari file `.json` atau `.csv` ke database. Ini
// pengganti "diketik manual ke DB" (docs/PRD.md, aturan F-11).
//
// Format file didokumentasikan lengkap di db/seeds/README.md. Ringkasnya:
//   - JSON: satu objek `{ track, modules: [...] }`, hierarki asli. Dipakai
//     untuk fixture yang ditulis developer atau digenerate dari sumber lain.
//   - CSV: satu baris = satu kartu, kolom track/module/lesson diulang tiap
//     baris (gaya spreadsheet). Dipakai tim konten non-developer — lihat
//     db/seeds/README.md "Peringatan jadwal" soal ±90 kartu bukan pekerjaan dev.
//
// Kedua format diparsing ke satu struktur normal yang sama (lihat
// `validateContent`) sebelum disentuh SQL apa pun, supaya validasi dan jalur
// insert HANYA punya satu implementasi (DRY) — kalau kelak butuh format
// ketiga, cukup tambah satu parser baru yang mengembalikan struktur yang sama.
//
// Pola koneksi Postgres MENGIKUTI scripts/db-migrate.mjs (dibaca, bukan
// diedit — db-migrate.mjs milik Dev A): `pg.Client` mentah, bukan Kysely.
// Alasan memilih raw `pg` di sini: skrip ini satu-shot, tidak butuh query
// builder bertipe untuk 4 tabel yang sudah diketahui bentuknya, dan memakai
// Kysely dari sebuah file `.mjs` polos berarti mengimpor `database.d.ts`
// (yang notabene cuma tipe, tak berguna tanpa transpile TS) — raw `pg` lebih
// sederhana dan konsisten dengan pola script Node lain di repo ini.
import fs from 'node:fs/promises';
import path from 'node:path';

import pg from 'pg';

const CARD_KINDS = new Set(['multiple_choice', 'swipe_binary', 'order_steps', 'reveal']);
// Kedalaman v0.1 (docs/PRD.md §14): hanya dua tipe ini yang dirender UI.
// order_steps/reveal tetap boleh diimpor (ada di enum DB) tapi diberi
// peringatan non-fatal supaya tidak diam-diam menumpuk konten yang belum
// bisa ditampilkan.
const CARD_KINDS_IMPLEMENTED = new Set(['multiple_choice', 'swipe_binary']);

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// ════════════════════════════════════════════════════════════════════════
//  Util kecil
// ════════════════════════════════════════════════════════════════════════

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function isInt(v) {
  return typeof v === 'number' && Number.isInteger(v);
}

// ════════════════════════════════════════════════════════════════════════
//  Validasi — satu sumber kebenaran untuk kedua format input.
//
//  Mengumpulkan SEMUA error sebelum melempar, supaya penulis konten (sering
//  bukan developer, lihat db/seeds/README.md) bisa membetulkan sekaligus,
//  bukan iterasi satu-error-per-run.
// ════════════════════════════════════════════════════════════════════════

function validateContent(doc, sourceLabel) {
  const errors = [];
  const push = (p, msg) => errors.push(`${p}: ${msg}`);

  if (!isPlainObject(doc) || !isPlainObject(doc.track) || !Array.isArray(doc.modules)) {
    throw new Error(
      `[seed:content] ${sourceLabel}: struktur dasar tidak valid — butuh { track: {...}, modules: [...] }.`,
    );
  }

  const t = doc.track;
  if (!isNonEmptyString(t.slug) || !SLUG_RE.test(t.slug.trim())) {
    push(
      'track.slug',
      'wajib diisi, huruf kecil/angka/tanda hubung saja (contoh: "content-writing-dasar")',
    );
  }
  if (!isNonEmptyString(t.title)) push('track.title', 'wajib diisi');
  if (t.description != null && typeof t.description !== 'string')
    push('track.description', 'harus string atau kosong');
  if (t.category != null && typeof t.category !== 'string')
    push('track.category', 'harus string atau kosong');
  if (t.isPublished != null && typeof t.isPublished !== 'boolean')
    push('track.isPublished', 'harus boolean');
  if (t.sortOrder != null && !isInt(t.sortOrder))
    push('track.sortOrder', 'harus integer (CLAUDE.md: koin/angka tidak pernah float)');

  if (doc.modules.length === 0) push('track.modules', 'minimal 1 modul');

  doc.modules.forEach((mod, mi) => {
    const mp = `track.modules[${mi}]`;
    if (!isPlainObject(mod)) return push(mp, 'harus objek');
    if (!isNonEmptyString(mod.title)) push(`${mp}.title`, 'wajib diisi');
    if (mod.sortOrder != null && !isInt(mod.sortOrder)) push(`${mp}.sortOrder`, 'harus integer');
    if (!Array.isArray(mod.lessons) || mod.lessons.length === 0) {
      push(`${mp}.lessons`, 'minimal 1 lesson');
      return;
    }

    mod.lessons.forEach((les, li) => {
      const lp = `${mp}.lessons[${li}]`;
      if (!isPlainObject(les)) return push(lp, 'harus objek');
      if (!isNonEmptyString(les.title)) push(`${lp}.title`, 'wajib diisi');
      if (les.estSeconds != null && (!isInt(les.estSeconds) || les.estSeconds <= 0)) {
        push(`${lp}.estSeconds`, 'harus integer > 0 (target 120-180 detik, LE-1)');
      }
      if (les.basePoints != null && !isInt(les.basePoints))
        push(`${lp}.basePoints`, 'harus integer');
      if (les.baseCoins != null && !isInt(les.baseCoins)) push(`${lp}.baseCoins`, 'harus integer');
      if (les.sortOrder != null && !isInt(les.sortOrder)) push(`${lp}.sortOrder`, 'harus integer');
      if (!Array.isArray(les.cards) || les.cards.length === 0) {
        push(`${lp}.cards`, 'minimal 1 kartu');
        return;
      }
      if (les.cards.length < 3 || les.cards.length > 5) {
        // LE-1 bilang 3-5 kartu per lesson. Tidak fatal (biar contoh kecil di
        // luar rentang tetap bisa diimpor saat development), tapi ditandai.
        push(
          `${lp}.cards`,
          `berisi ${les.cards.length} kartu, PRD LE-1 menyarankan 3-5 (peringatan, tidak menghentikan impor)`,
        );
      }

      les.cards.forEach((card, ci) => {
        const cp = `${lp}.cards[${ci}]`;
        if (!isPlainObject(card)) return push(cp, 'harus objek');
        if (!CARD_KINDS.has(card.kind))
          push(`${cp}.kind`, `harus salah satu dari ${[...CARD_KINDS].join(', ')}`);
        if (!isNonEmptyString(card.prompt)) push(`${cp}.prompt`, 'wajib diisi');
        if (card.sortOrder != null && !isInt(card.sortOrder))
          push(`${cp}.sortOrder`, 'harus integer');
        if (!Array.isArray(card.options) || card.options.length < 2) {
          push(`${cp}.options`, 'minimal 2 opsi');
          return;
        }
        const ids = new Set();
        let hasCorrect = false;
        card.options.forEach((opt, oi) => {
          const op = `${cp}.options[${oi}]`;
          if (!isPlainObject(opt)) return push(op, 'harus objek');
          if (!isNonEmptyString(opt.id)) push(`${op}.id`, 'wajib diisi');
          else if (ids.has(opt.id)) push(`${op}.id`, `duplikat "${opt.id}" dalam kartu yang sama`);
          else ids.add(opt.id);
          if (!isNonEmptyString(opt.text)) push(`${op}.text`, 'wajib diisi');
          if (typeof opt.correct !== 'boolean') push(`${op}.correct`, 'harus boolean (true/false)');
          else if (opt.correct) hasCorrect = true;
          if (opt.why != null && typeof opt.why !== 'string')
            push(`${op}.why`, 'harus string atau kosong');
        });
        if (!hasCorrect)
          push(
            `${cp}.options`,
            'minimal satu opsi correct=true (LE-2/LE-3: kunci jawaban ditentukan di sini, bukan di client)',
          );
      });
    });
  });

  // Peringatan non-fatal: kind yang belum dirender UI v0.1 (docs/PRD.md §14).
  const unimplemented = new Set();
  for (const mod of doc.modules) {
    if (!Array.isArray(mod?.lessons)) continue;
    for (const les of mod.lessons) {
      if (!Array.isArray(les?.cards)) continue;
      for (const card of les.cards) {
        if (card?.kind && !CARD_KINDS_IMPLEMENTED.has(card.kind)) unimplemented.add(card.kind);
      }
    }
  }
  if (unimplemented.size > 0) {
    process.stderr.write(
      `[seed:content] peringatan: kartu bertipe ${[...unimplemented].join(
        ', ',
      )} belum dirender UI v0.1 (docs/PRD.md §14) — tetap diimpor ke DB.\n`,
    );
  }

  if (errors.length > 0) {
    throw new Error(
      `[seed:content] ${sourceLabel}: ${errors.length} masalah validasi:\n  - ${errors.join('\n  - ')}`,
    );
  }

  // Normalisasi default di sini (satu tempat), bukan di pemanggil.
  return {
    track: {
      slug: t.slug.trim(),
      title: t.title.trim(),
      description: t.description ?? null,
      category: t.category ?? null,
      isPublished: t.isPublished ?? false,
      sortOrder: t.sortOrder ?? 0,
    },
    modules: doc.modules.map((mod, mi) => ({
      title: mod.title.trim(),
      sortOrder: mod.sortOrder ?? mi,
      lessons: mod.lessons.map((les, li) => ({
        title: les.title.trim(),
        estSeconds: les.estSeconds ?? 150,
        basePoints: les.basePoints ?? 10,
        baseCoins: les.baseCoins ?? 20,
        sortOrder: les.sortOrder ?? li,
        cards: les.cards.map((card, ci) => ({
          kind: card.kind,
          prompt: card.prompt.trim(),
          sortOrder: card.sortOrder ?? ci,
          content: {
            options: card.options.map((opt) => ({
              id: String(opt.id).trim(),
              text: opt.text.trim(),
              correct: opt.correct,
              why: opt.why ?? null,
            })),
          },
        })),
      })),
    })),
  };
}

// ════════════════════════════════════════════════════════════════════════
//  Parser JSON
// ════════════════════════════════════════════════════════════════════════

function parseJson(raw, sourceLabel) {
  let doc;
  try {
    doc = JSON.parse(raw);
  } catch (error) {
    throw new Error(`[seed:content] ${sourceLabel}: JSON tidak valid — ${error.message}`);
  }
  return validateContent(doc, sourceLabel);
}

// ════════════════════════════════════════════════════════════════════════
//  Parser CSV
//
//  Satu baris = satu kartu. Kolom track/module/lesson diulang tiap baris
//  (gaya ekspor spreadsheet). Skema kolom lengkap ada di db/seeds/README.md.
//
//  Batasan yang disengaja untuk v0.1 (didokumentasikan, bukan bug tersembunyi):
//    - Satu file CSV = satu track (kalau ada slug berbeda di baris lain, error).
//    - Maksimal 4 opsi per kartu (option_1.. option_4). Cukup untuk multiple
//      choice/swipe_binary v0.1; kalau perlu lebih, pakai format JSON.
//    - Field tidak boleh mengandung newline literal di dalam sel (parser CSV
//      di sini sengaja sederhana, bukan RFC4180 penuh, supaya tidak perlu
//      dependency baru). Butuh multi-baris di satu prompt -> pakai JSON.
//    - Pengelompokan module/lesson memakai JUDUL sebagai kunci (bukan posisi
//      baris), jadi judul module/lesson HARUS unik dalam satu track.
// ════════════════════════════════════════════════════════════════════════

const MAX_CSV_OPTIONS = 4;

// Parser CSV manual (state machine per karakter) — bukan regex, supaya tidak
// ada risiko ReDoS pada file besar, dan bukan dependency baru.
function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const len = text.length;

  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < len) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (c === ',') {
      endField();
      i += 1;
      continue;
    }
    if (c === '\r') {
      i += 1;
      continue; // dilewati, \n yang menutup baris (aman untuk CRLF & LF)
    }
    if (c === '\n') {
      endRow();
      i += 1;
      continue;
    }
    field += c;
    i += 1;
  }
  // Baris terakhir tanpa newline penutup.
  if (field.length > 0 || row.length > 0) endRow();

  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

function csvBool(v, columnLabel) {
  const s = String(v ?? '')
    .trim()
    .toLowerCase();
  if (s === '') return undefined;
  if (s === 'true' || s === '1') return true;
  if (s === 'false' || s === '0') return false;
  throw new Error(
    `[seed:content] kolom ${columnLabel}: nilai boolean tidak dikenal "${v}" (pakai true/false)`,
  );
}

function csvInt(v) {
  const s = String(v ?? '').trim();
  if (s === '') return undefined;
  const n = Number(s);
  if (!Number.isInteger(n)) return NaN; // divalidasi lagi oleh validateContent
  return n;
}

function parseCsv(raw, sourceLabel) {
  // Buang BOM UTF-8 (code point U+FEFF, hex 0xFEFF) yang sering ditempel
  // Excel saat "Save As CSV UTF-8". Dicek lewat charCodeAt + hex numerik,
  // BUKAN karakter/escape literal di source, supaya tidak ada karakter
  // tak-terlihat yang tersimpan di file ini (ESLint no-irregular-whitespace
  // akan menandainya kalau ada).
  const hasBom = raw.length > 0 && raw.charCodeAt(0) === 0xfeff;
  const text = hasBom ? raw.slice(1) : raw;
  const rows = parseCsvRows(text);
  if (rows.length < 2) {
    throw new Error(
      `[seed:content] ${sourceLabel}: CSV kosong atau tidak ada baris data setelah header.`,
    );
  }

  const header = rows[0].map((h) => h.trim());
  const col = (name) => {
    const idx = header.indexOf(name);
    if (idx === -1)
      throw new Error(
        `[seed:content] ${sourceLabel}: kolom wajib "${name}" tidak ditemukan di header CSV.`,
      );
    return idx;
  };
  const optionalCol = (name) => header.indexOf(name);

  const idx = {
    trackSlug: col('track_slug'),
    trackTitle: col('track_title'),
    trackDescription: optionalCol('track_description'),
    trackCategory: optionalCol('track_category'),
    trackIsPublished: optionalCol('track_is_published'),
    trackSortOrder: optionalCol('track_sort_order'),
    moduleTitle: col('module_title'),
    moduleSortOrder: optionalCol('module_sort_order'),
    lessonTitle: col('lesson_title'),
    lessonEstSeconds: optionalCol('lesson_est_seconds'),
    lessonBasePoints: optionalCol('lesson_base_points'),
    lessonBaseCoins: optionalCol('lesson_base_coins'),
    lessonSortOrder: optionalCol('lesson_sort_order'),
    cardKind: col('card_kind'),
    cardPrompt: col('card_prompt'),
    cardSortOrder: optionalCol('card_sort_order'),
  };
  const get = (r, i) => (i >= 0 && i < r.length ? r[i] : '');

  let trackSlug;
  let trackShape;
  const modulesByTitle = new Map();

  for (let rIdx = 1; rIdx < rows.length; rIdx += 1) {
    const r = rows[rIdx];
    if (r.length === 1 && r[0].trim() === '') continue; // baris kosong di akhir file
    const lineNo = rIdx + 1;

    const slug = get(r, idx.trackSlug).trim();
    if (!slug) continue; // baris kosong total
    if (trackSlug === undefined) {
      trackSlug = slug;
      trackShape = {
        slug,
        title: get(r, idx.trackTitle),
        description: idx.trackDescription >= 0 ? get(r, idx.trackDescription) || null : null,
        category: idx.trackCategory >= 0 ? get(r, idx.trackCategory) || null : null,
        isPublished:
          idx.trackIsPublished >= 0
            ? (csvBool(get(r, idx.trackIsPublished), 'track_is_published') ?? false)
            : false,
        sortOrder: idx.trackSortOrder >= 0 ? (csvInt(get(r, idx.trackSortOrder)) ?? 0) : 0,
      };
    } else if (slug !== trackSlug) {
      throw new Error(
        `[seed:content] ${sourceLabel} baris ${lineNo}: track_slug "${slug}" berbeda dari "${trackSlug}" di baris sebelumnya — satu file CSV hanya boleh berisi satu track.`,
      );
    }

    const moduleTitle = get(r, idx.moduleTitle).trim();
    if (!modulesByTitle.has(moduleTitle)) {
      modulesByTitle.set(moduleTitle, {
        title: moduleTitle,
        sortOrder: idx.moduleSortOrder >= 0 ? csvInt(get(r, idx.moduleSortOrder)) : undefined,
        lessonsByTitle: new Map(),
      });
    }
    const mod = modulesByTitle.get(moduleTitle);

    const lessonTitle = get(r, idx.lessonTitle).trim();
    if (!mod.lessonsByTitle.has(lessonTitle)) {
      mod.lessonsByTitle.set(lessonTitle, {
        title: lessonTitle,
        estSeconds: idx.lessonEstSeconds >= 0 ? csvInt(get(r, idx.lessonEstSeconds)) : undefined,
        basePoints: idx.lessonBasePoints >= 0 ? csvInt(get(r, idx.lessonBasePoints)) : undefined,
        baseCoins: idx.lessonBaseCoins >= 0 ? csvInt(get(r, idx.lessonBaseCoins)) : undefined,
        sortOrder: idx.lessonSortOrder >= 0 ? csvInt(get(r, idx.lessonSortOrder)) : undefined,
        cards: [],
      });
    }
    const lesson = mod.lessonsByTitle.get(lessonTitle);

    const options = [];
    for (let n = 1; n <= MAX_CSV_OPTIONS; n += 1) {
      const textIdx = optionalCol(`option_${n}_text`);
      if (textIdx === -1) continue;
      const optionText = get(r, textIdx).trim();
      if (!optionText) continue; // slot opsi tidak dipakai kartu ini
      options.push({
        id: get(r, optionalCol(`option_${n}_id`)).trim() || String(n),
        text: optionText,
        correct:
          csvBool(get(r, optionalCol(`option_${n}_correct`)), `option_${n}_correct`) ?? false,
        why: get(r, optionalCol(`option_${n}_why`)).trim() || null,
      });
    }

    lesson.cards.push({
      kind: get(r, idx.cardKind).trim(),
      prompt: get(r, idx.cardPrompt),
      sortOrder: idx.cardSortOrder >= 0 ? csvInt(get(r, idx.cardSortOrder)) : undefined,
      options,
    });
  }

  if (trackShape === undefined) {
    throw new Error(`[seed:content] ${sourceLabel}: tidak ada baris data yang valid.`);
  }

  const doc = {
    track: trackShape,
    modules: [...modulesByTitle.values()].map((mod) => ({
      title: mod.title,
      sortOrder: mod.sortOrder,
      lessons: [...mod.lessonsByTitle.values()].map((les) => ({
        title: les.title,
        estSeconds: les.estSeconds,
        basePoints: les.basePoints,
        baseCoins: les.baseCoins,
        sortOrder: les.sortOrder,
        cards: les.cards,
      })),
    })),
  };

  return validateContent(doc, sourceLabel);
}

// ════════════════════════════════════════════════════════════════════════
//  Insert idempoten
//
//  Strategi (dua lapis, dipilih per tabel berdasarkan constraint yang ada):
//    - tracks: UPSERT lewat ON CONFLICT (slug) — slug UNIQUE di skema
//      (db/migrations/001_init.sql). Re-run dengan konten yang BERUBAH akan
//      memperbarui baris track, bukan cuma "tidak menggandakan" — ini sengaja
//      (lihat README) supaya seed bisa dipakai juga untuk mengoreksi typo
//      tanpa perlu tur manual ke DB.
//    - modules/lessons/lesson_cards: TIDAK ADA unique constraint alami di
//      skema saat ini (bukan kolom yang saya boleh tambah — db/migrations/
//      milik Dev A, lihat CLAUDE.md Kepemilikan file). Strategi: hapus semua
//      modules milik track ini (CASCADE otomatis membawa lessons + lesson_
//      cards ikut terhapus, lihat FK ON DELETE CASCADE), lalu insert ulang
//      semuanya dari file — SEMUA di satu transaksi, jadi kalau ada INSERT
//      yang gagal di tengah, DELETE ikut di-rollback (tidak pernah ada
//      state "track ada tapi kosong isinya").
// ════════════════════════════════════════════════════════════════════════

async function insertContent(client, content) {
  const { track, modules } = content;

  await client.query('BEGIN');
  try {
    const trackResult = await client.query(
      `INSERT INTO tracks (slug, title, description, category, is_published, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (slug) DO UPDATE SET
         title = EXCLUDED.title,
         description = EXCLUDED.description,
         category = EXCLUDED.category,
         is_published = EXCLUDED.is_published,
         sort_order = EXCLUDED.sort_order
       RETURNING id`,
      [
        track.slug,
        track.title,
        track.description,
        track.category,
        track.isPublished,
        track.sortOrder,
      ],
    );
    const trackId = trackResult.rows[0].id;

    // CASCADE (modules -> lessons -> lesson_cards) ditegakkan oleh FK di
    // 001_init.sql. Menghapus di sini SENGAJA hanya level modules.
    await client.query('DELETE FROM modules WHERE track_id = $1', [trackId]);

    let moduleCount = 0;
    let lessonCount = 0;
    let cardCount = 0;

    for (const mod of modules) {
      const modResult = await client.query(
        `INSERT INTO modules (track_id, title, sort_order) VALUES ($1, $2, $3) RETURNING id`,
        [trackId, mod.title, mod.sortOrder],
      );
      const moduleId = modResult.rows[0].id;
      moduleCount += 1;

      for (const les of mod.lessons) {
        const lesResult = await client.query(
          `INSERT INTO lessons (module_id, title, est_seconds, base_points, base_coins, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [moduleId, les.title, les.estSeconds, les.basePoints, les.baseCoins, les.sortOrder],
        );
        const lessonId = lesResult.rows[0].id;
        lessonCount += 1;

        for (const card of les.cards) {
          // content bertipe jsonb: parameter dikirim sebagai STRING JSON via
          // $N::jsonb, BUKAN interpolasi string SQL — mencegah injection dari
          // prompt/opsi yang mungkin mengandung tanda kutip atau `;`.
          await client.query(
            `INSERT INTO lesson_cards (lesson_id, kind, prompt, content, sort_order)
             VALUES ($1, $2, $3, $4::jsonb, $5)`,
            [lessonId, card.kind, card.prompt, JSON.stringify(card.content), card.sortOrder],
          );
          cardCount += 1;
        }
      }
    }

    await client.query('COMMIT');
    return { trackId, trackSlug: track.slug, moduleCount, lessonCount, cardCount };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

// ════════════════════════════════════════════════════════════════════════
//  Entry point
// ════════════════════════════════════════════════════════════════════════

async function main() {
  const [, , fileArg] = process.argv;
  if (!fileArg) {
    process.stderr.write(
      '[seed:content] penggunaan: pnpm seed:content <file.json|file.csv>\n' +
        '               format didokumentasikan di db/seeds/README.md\n',
    );
    process.exit(1);
  }

  const filePath = path.resolve(process.cwd(), fileArg);
  const ext = path.extname(filePath).toLowerCase();
  if (ext !== '.json' && ext !== '.csv') {
    process.stderr.write(
      `[seed:content] ekstensi "${ext}" tidak didukung — pakai .json atau .csv.\n`,
    );
    process.exit(1);
  }

  let raw;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    process.stderr.write(`[seed:content] tidak bisa membaca "${filePath}": ${error.message}\n`);
    process.exit(1);
  }

  const sourceLabel = path.relative(process.cwd(), filePath);
  let content;
  try {
    content = ext === '.json' ? parseJson(raw, sourceLabel) : parseCsv(raw, sourceLabel);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    process.stderr.write(
      '[seed:content] DATABASE_URL belum diset.\n' +
        '               Salin .env.example ke .env, atau set variabelnya di shell ini.\n',
    );
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const summary = await insertContent(client, content);
    process.stdout.write(
      `[seed:content] ${sourceLabel} -> track "${summary.trackSlug}" (${summary.trackId})\n` +
        `               ${summary.moduleCount} modul, ${summary.lessonCount} lesson, ${summary.cardCount} kartu diimpor.\n`,
    );
  } catch (error) {
    process.stderr.write(`[seed:content] gagal impor: ${error.message}\n`);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

// File konten satu-track diperkirakan kecil (puluhan KB, lihat README
// "±90 kartu"), jadi seluruh file dibaca sekaligus (fs.readFile) — bukan
// streaming. Kalau nanti perlu menampung file jauh lebih besar, parser CSV
// di atas perlu ditulis ulang jadi streaming-friendly.
main();
