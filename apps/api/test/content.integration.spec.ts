import type { HttpException } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase, type DB } from '../src/infra/kysely';
import { ContentService } from '../src/modules/learning';

/**
 * Test integrasi rute baca konten terhadap DATABASE NYATA.
 *
 * Yang paling penting di sini bukan bentuk responsnya, tapi satu hal:
 * **tidak ada `correct` maupun `why` di JSON mentah** (AC-LE-5). Unit test
 * serializer sudah membuktikan fungsinya benar; yang dibuktikan di sini adalah
 * jalur yang benar-benar dipakai memanggilnya — fungsi yang benar tapi tidak
 * pernah dipanggil tidak melindungi apa pun.
 */

const URL_DEV = 'postgres://strive:strive_dev_only@localhost:55432/strive';
const url = process.env['DATABASE_URL_TEST'] ?? process.env['DATABASE_URL'] ?? URL_DEV;

let db: Kysely<DB>;
let content: ContentService;
let reachable = false;

const USER = '00000000-0000-4000-8000-00000000c001';
const LAIN = '00000000-0000-4000-8000-00000000c002';
const TRACK = '00000000-0000-4000-8000-00000000d001';
const TRACK_DRAFT = '00000000-0000-4000-8000-00000000d002';
const MODUL = '00000000-0000-4000-8000-00000000e001';
const LESSON_A = '00000000-0000-4000-8000-00000000f001';
const LESSON_B = '00000000-0000-4000-8000-00000000f002';

beforeAll(async () => {
  db = createDatabase(url);
  content = new ContentService(db);
  try {
    await db.selectFrom('tracks').select('id').limit(1).execute();
    reachable = true;
  } catch {
    reachable = false;
  }
});

afterAll(async () => {
  if (db) await db.destroy();
});

beforeEach(async () => {
  if (!reachable) return;
  await sql`TRUNCATE lesson_attempts, lesson_cards, lessons, modules, tracks RESTART IDENTITY CASCADE`.execute(
    db,
  );
  await db.deleteFrom('users').where('id', 'in', [USER, LAIN]).execute();

  await db
    .insertInto('users')
    .values([
      { id: USER, email: 'c1@uji.test', display_name: 'Uji' },
      { id: LAIN, email: 'c2@uji.test', display_name: 'Lain' },
    ])
    .execute();

  await db
    .insertInto('tracks')
    .values([
      { id: TRACK, slug: 'pr', title: 'Public Relations', is_published: true, sort_order: 1 },
      { id: TRACK_DRAFT, slug: 'draf', title: 'Belum terbit', is_published: false, sort_order: 2 },
    ])
    .execute();

  await db.insertInto('modules').values({ id: MODUL, track_id: TRACK, title: 'Dasar' }).execute();

  await db
    .insertInto('lessons')
    .values([
      { id: LESSON_A, module_id: MODUL, title: 'Lesson A', sort_order: 1 },
      { id: LESSON_B, module_id: MODUL, title: 'Lesson B', sort_order: 2 },
    ])
    .execute();

  // Dua kartu berisi kunci jawaban, satu di antaranya menaruhnya di tempat
  // yang TIDAK biasa — supaya serializer tidak lolos hanya karena menebak
  // bentuk `options[]`.
  await db
    .insertInto('lesson_cards')
    .values([
      {
        lesson_id: LESSON_A,
        kind: 'multiple_choice',
        prompt: 'Mana yang benar?',
        sort_order: 1,
        content: JSON.stringify({
          options: [
            { id: 'opt_a', text: 'A', correct: true, why: 'sebab A' },
            { id: 'opt_b', text: 'B', correct: false, why: 'sebab B' },
          ],
        }),
      },
      {
        lesson_id: LESSON_A,
        kind: 'swipe_binary',
        prompt: 'Setuju?',
        sort_order: 2,
        content: JSON.stringify({
          answer: { correct: true, why: 'karena X' },
          hint: { nested: { deeper: { why: 'terkubur dalam' } } },
        }),
      },
    ])
    .execute();
});

/**
 * Mengambil `error.code` dari HttpException.
 *
 * Diperiksa lewat CODE, bukan `message` — `code` adalah KONTRAK, `message`
 * bukan (docs/PRD.md §10.1). Versi pertama test ini memeriksa message dan
 * gagal: NestJS mengisi `.message` dengan "Not Found Exception" saat body-nya
 * berupa objek. Test yang memeriksa message bukan cuma rapuh, ia melanggar
 * aturan yang sama dengan yang dilarang di client.
 */
async function codeDari(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    throw new Error('diharapkan melempar, tapi tidak');
  } catch (e) {
    const body = (e as HttpException).getResponse?.() as { error?: { code?: string } } | undefined;
    return body?.error?.code ?? 'BUKAN_HTTP_EXCEPTION';
  }
}

describe('ContentService (database nyata)', () => {
  it('database siap dipakai', () => {
    expect(
      reachable,
      `DATABASE_URL tidak bisa dipakai (${url}). Jalankan: docker compose up -d && pnpm db:migrate`,
    ).toBe(true);
  });

  // ── AC L-01 ───────────────────────────────────────────────────────────
  it('AC: JSON MENTAH respons kartu tidak memuat `correct` maupun `why`', async () => {
    if (!reachable) return;
    const hasil = await content.getLessonCards(LESSON_A);
    const mentah = JSON.stringify(hasil);

    // Diperiksa sebagai teks, bukan lewat properti — kalau kuncinya bersarang
    // di tempat yang tidak kuduga, pemeriksaan properti akan melewatkannya.
    expect(mentah).not.toMatch(/"correct"/);
    expect(mentah).not.toMatch(/"why"/);

    // Dan yang BUKAN kunci jawaban harus tetap ada.
    expect(mentah).toMatch(/"opt_a"/);
    expect(mentah).toMatch(/"Mana yang benar\?"/);
  });

  it('AC: baris database MEMANG memuat kunci jawaban — jadi test di atas berarti', async () => {
    if (!reachable) return;
    // Tanpa ini, test di atas bisa hijau hanya karena datanya kebetulan bersih.
    const baris = await db
      .selectFrom('lesson_cards')
      .select('content')
      .where('lesson_id', '=', LESSON_A)
      .execute();
    const mentah = JSON.stringify(baris);
    expect(mentah).toMatch(/"correct"/);
    expect(mentah).toMatch(/"why"/);
  });

  it('kunci jawaban yang bersarang dalam juga terbuang', async () => {
    if (!reachable) return;
    const hasil = await content.getLessonCards(LESSON_A);
    const swipe = hasil.cards.find((c) => c.kind === 'swipe_binary');
    expect(JSON.stringify(swipe)).not.toMatch(/"why"|"correct"/);
    // Struktur di sekitarnya tetap utuh, cuma kuncinya yang hilang.
    expect(swipe?.content).toEqual({ answer: {}, hint: { nested: { deeper: {} } } });
  });

  it('kartu diurutkan sesuai sort_order', async () => {
    if (!reachable) return;
    const hasil = await content.getLessonCards(LESSON_A);
    expect(hasil.cards.map((c) => c.kind)).toEqual(['multiple_choice', 'swipe_binary']);
  });

  // ── Progres (LE-9) ────────────────────────────────────────────────────
  it('progres dihitung dari lesson yang PERNAH diselesaikan, bukan jumlah attempt', async () => {
    if (!reachable) return;

    // Lesson A dikerjakan TIGA kali di tanggal berbeda — pengulangan diizinkan
    // untuk latihan (LE-4), tapi progresnya tetap satu lesson.
    for (const tanggal of ['2026-09-13', '2026-09-14', '2026-09-15']) {
      await db
        .insertInto('lesson_attempts')
        .values({
          user_id: USER,
          lesson_id: LESSON_A,
          attempt_date: tanggal,
          card_results: JSON.stringify([]),
          score: 100,
          points: 10,
          coins: 20,
          duration_ms: 1000,
        })
        .execute();
    }

    const tracks = await content.listTracks(USER);
    expect(tracks).toHaveLength(1);
    expect(tracks[0]?.progress).toEqual({ completedLessons: 1, totalLessons: 2, percent: 50 });
  });

  it('progres milik pengguna lain tidak bocor', async () => {
    if (!reachable) return;
    await db
      .insertInto('lesson_attempts')
      .values({
        user_id: LAIN,
        lesson_id: LESSON_A,
        attempt_date: '2026-09-15',
        card_results: JSON.stringify([]),
        score: 100,
        points: 10,
        coins: 20,
        duration_ms: 1000,
      })
      .execute();

    const punyaKita = await content.listTracks(USER);
    expect(punyaKita[0]?.progress.completedLessons).toBe(0);

    const punyaDia = await content.listTracks(LAIN);
    expect(punyaDia[0]?.progress.completedLessons).toBe(1);
  });

  it('track yang belum diterbitkan tidak muncul di daftar', async () => {
    if (!reachable) return;
    const tracks = await content.listTracks(USER);
    expect(tracks.map((t) => t.slug)).toEqual(['pr']);
  });

  it('track yang belum diterbitkan diperlakukan seperti tidak ada', async () => {
    if (!reachable) return;
    // Membedakan "belum terbit" dari "tidak ada" memberi tahu penebak bahwa
    // id-nya benar.
    expect(await codeDari(() => content.getTrack(USER, TRACK_DRAFT))).toBe('NOT_FOUND');
  });

  it('detail track memuat modul, lesson, jumlah kartu, dan progres per modul', async () => {
    if (!reachable) return;
    await db
      .insertInto('lesson_attempts')
      .values({
        user_id: USER,
        lesson_id: LESSON_A,
        attempt_date: '2026-09-15',
        card_results: JSON.stringify([]),
        score: 80,
        points: 9,
        coins: 18,
        duration_ms: 1000,
      })
      .execute();

    const track = await content.getTrack(USER, TRACK);
    expect(track.modules).toHaveLength(1);

    const modul = track.modules[0];
    expect(modul?.progress).toEqual({ completedLessons: 1, totalLessons: 2, percent: 50 });
    expect(modul?.lessons.map((l) => [l.title, l.completed, l.cardCount])).toEqual([
      ['Lesson A', true, 2],
      ['Lesson B', false, 0],
    ]);
  });

  it('detail track juga bersih dari kunci jawaban', async () => {
    if (!reachable) return;
    // Rute ini tidak mengembalikan `content` sama sekali, dan itu disengaja:
    // daftar lesson tidak butuh isi kartu. Diuji supaya kalau suatu saat
    // seseorang menambahkannya demi kenyamanan, test ini yang menolak.
    const track = await content.getTrack(USER, TRACK);
    expect(JSON.stringify(track)).not.toMatch(/"correct"|"why"|"content"/);
  });

  it('track tanpa lesson menghasilkan progres 0%, bukan NaN', async () => {
    if (!reachable) return;
    await db.deleteFrom('lessons').where('module_id', '=', MODUL).execute();
    const tracks = await content.listTracks(USER);
    expect(tracks[0]?.progress).toEqual({ completedLessons: 0, totalLessons: 0, percent: 0 });
  });

  it('lesson yang tidak ada menghasilkan NOT_FOUND, bukan daftar kartu kosong', async () => {
    if (!reachable) return;
    expect(
      await codeDari(() => content.getLessonCards('00000000-0000-4000-8000-0000000000ff')),
    ).toBe('NOT_FOUND');
  });
});
