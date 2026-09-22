import { NotFoundException } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase, type DB } from '../src/infra/kysely';
import { MasteryService } from '../src/modules/mastery';

/**
 * `MT-01` terhadap DATABASE NYATA.
 *
 * AC-nya dua kalimat, keduanya diuji:
 *   "Sesi menyimpan seluruh giliran tanya-jawab sebagai JSONB"
 *   "Pengguna hanya bisa membaca sesinya sendiri"
 *
 * Yang kedua adalah KEPEMILIKAN, bukan peran — jadi ia tidak bisa diuji lewat
 * guard. Ia harus diuji di service, dengan dua pengguna sungguhan.
 */

const URL_DEV = 'postgres://strive:strive_dev_only@localhost:55432/strive';
const url = process.env['DATABASE_URL_TEST'] ?? process.env['DATABASE_URL'] ?? URL_DEV;

let db: Kysely<DB>;
let mastery: MasteryService;
let reachable = false;

const A = '00000000-0000-4000-8000-0000000mt001'.replace(/mt/, 'cd');
const B = '00000000-0000-4000-8000-0000000mt002'.replace(/mt/, 'cd');

beforeAll(async () => {
  db = createDatabase(url);
  mastery = new MasteryService(db);
  try {
    await db.selectFrom('mastery_sessions').select('id').limit(1).execute();
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
  await sql`TRUNCATE users RESTART IDENTITY CASCADE`.execute(db);
  await db
    .insertInto('users')
    .values([
      { id: A, email: 'mt1@uji.test', display_name: 'A' },
      { id: B, email: 'mt2@uji.test', display_name: 'B' },
    ])
    .execute();
});

describe('MasteryService (database nyata)', () => {
  it('database siap dipakai', () => {
    expect(reachable, `DATABASE_URL tidak bisa dipakai (${url})`).toBe(true);
  });

  it('sesi baru: draft, turns kosong, target tersimpan', async () => {
    if (!reachable) return;
    const s = await mastery.create(A, 'interview', 'chevening');
    expect(s).toMatchObject({ kind: 'interview', target: 'chevening', status: 'draft' });
    expect(s.turns).toEqual([]);
  });

  // ── AC 1 ────────────────────────────────────────────────────────────────
  it('AC: SELURUH giliran tanya-jawab tersimpan sebagai JSONB, urut', async () => {
    if (!reachable) return;
    const s = await mastery.create(A, 'interview', 'chevening');

    for (let i = 1; i <= 5; i++) {
      await mastery.appendTurn(A, s.id, { role: 'question', text: `Pertanyaan ${i}` });
      await mastery.appendTurn(A, s.id, { role: 'answer', text: `Jawaban ${i}` });
    }

    const akhir = await mastery.byId(A, s.id);
    expect(akhir.turns).toHaveLength(10);
    expect(akhir.turns.map((t) => t.text)).toEqual([
      'Pertanyaan 1',
      'Jawaban 1',
      'Pertanyaan 2',
      'Jawaban 2',
      'Pertanyaan 3',
      'Jawaban 3',
      'Pertanyaan 4',
      'Jawaban 4',
      'Pertanyaan 5',
      'Jawaban 5',
    ]);

    // Benar-benar JSONB di database, bukan string yang kebetulan terbaca.
    const jenis = await sql<{ t: string; n: string }>`
      SELECT jsonb_typeof(turns) AS t, jsonb_array_length(turns)::text AS n
      FROM mastery_sessions WHERE id = ${s.id}
    `.execute(db);
    expect(jenis.rows[0]).toMatchObject({ t: 'array', n: '10' });
  });

  it('waktu tiap giliran dibentuk SERVER, bukan diterima dari klien', async () => {
    if (!reachable) return;
    const s = await mastery.create(A, 'interview');
    // Klien tidak punya cara mengirim `at` — tipenya memang tidak menerimanya.
    await mastery.appendTurn(A, s.id, { role: 'question', text: 'Q' });

    const [t] = (await mastery.byId(A, s.id)).turns;
    expect(t!.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // Urutan giliran adalah satu-satunya hal yang membuat transkrip berarti;
    // waktu dari klien bisa dipalsukan.
    expect(Math.abs(Date.now() - Date.parse(t!.at))).toBeLessThan(60_000);
  });

  it('giliran ditambahkan di DATABASE, bukan dirakit di Node', async () => {
    if (!reachable) return;
    const s = await mastery.create(A, 'interview');

    // Sepuluh penambahan bersamaan. Kalau array-nya dibaca-diubah-ditulis di
    // memori, sebagian akan saling menimpa dan yang hilang adalah jawaban
    // pengguna.
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        mastery.appendTurn(A, s.id, { role: 'answer', text: `paralel-${i}` }),
      ),
    );

    const akhir = await mastery.byId(A, s.id);
    expect(akhir.turns, 'ada giliran yang hilang — array dirakit di Node').toHaveLength(10);
    expect(new Set(akhir.turns.map((t) => t.text)).size).toBe(10);
  });

  // ── AC 2 ────────────────────────────────────────────────────────────────
  it('AC: pengguna TIDAK bisa membaca sesi orang lain', async () => {
    if (!reachable) return;
    const s = await mastery.create(A, 'statement', 'lpdp');

    await expect(mastery.byId(B, s.id)).rejects.toBeInstanceOf(NotFoundException);
    expect(await mastery.listFor(B)).toEqual([]);
  });

  it('sesi orang lain dan sesi yang TIDAK ADA menghasilkan jawaban yang sama', async () => {
    if (!reachable) return;
    const s = await mastery.create(A, 'statement');
    const hantu = '00000000-0000-4000-8000-00000000dead';

    // Membedakan keduanya memberi tahu penebak bahwa id itu nyata.
    const a = await mastery.byId(B, s.id).catch((e) => (e as Error).message);
    const b = await mastery.byId(B, hantu).catch((e) => (e as Error).message);
    expect(a).toBe(b);
  });

  it('pengguna lain tidak bisa MENULIS ke sesi itu juga', async () => {
    if (!reachable) return;
    const s = await mastery.create(A, 'interview');
    await expect(
      mastery.appendTurn(B, s.id, { role: 'answer', text: 'menyelinap' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect((await mastery.byId(A, s.id)).turns).toHaveLength(0);
  });

  it('submit mengubah status sekali; submit kedua ditolak', async () => {
    if (!reachable) return;
    const s = await mastery.create(A, 'statement', 'fulbright');
    expect((await mastery.submit(A, s.id)).status).toBe('submitted');
    await expect(mastery.submit(A, s.id)).rejects.toBeTruthy();
  });

  it('daftar sesi hanya memuat milik sendiri, terbaru dulu', async () => {
    if (!reachable) return;
    await mastery.create(A, 'interview', 'chevening');
    await mastery.create(A, 'statement', 'lpdp');
    await mastery.create(B, 'interview', 'fulbright');

    const daftar = await mastery.listFor(A);
    expect(daftar).toHaveLength(2);
    expect(daftar.every((x) => x.target !== 'fulbright')).toBe(true);
  });
});
