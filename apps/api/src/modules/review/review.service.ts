import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { type Kysely, sql } from 'kysely';

import { DATABASE, type DB } from '../../infra/kysely';

/** PR-1: setiap submission dialokasikan ke 2 reviewer dari squad berbeda. */
export const REVIEWERS_PER_ATTEMPT = 2;

/** PR-4: maksimal 5 review BERPOIN per hari per reviewer. */
export const DAILY_SCORED_CAP = 5;

/**
 * Batas nilai rubrik yang diterima dari klien.
 *
 * ── PRD TIDAK mendefinisikan bentuk rubriknya, dan itu jadi lubang ──
 *
 * `PR-5` bilang `poin = rubrik_total × reviewer_weight`, tapi tidak ada satu
 * baris pun di `docs/PRD.md` yang menyebut kriteria rubriknya apa, berapa
 * banyak, atau rentang nilainya. Sementara `rubric_scores` datang **dari
 * klien**.
 *
 * Tanpa batas, `POST /reviews/:id` dengan `{"apa_saja": 999999}` mencetak
 * 999.999 poin — aturan keras 9 ("penilaian selalu di server, client tidak
 * pernah dipercaya") dilanggar lewat pintu depan.
 *
 * Angka di bawah adalah **tafsiran, bukan kutipan**: skala 0–5 per kriteria,
 * maksimal 10 kriteria. Dipilih karena itu bentuk rubrik yang paling lazim,
 * dan karena batas apa pun lebih benar daripada tanpa batas. Pertanyaannya
 * diajukan terpisah supaya angkanya bisa diganti tanpa menebak ulang —
 * lihat isu yang dirujuk di PR ini.
 */
export const RUBRIC_MAX_SCORE = 5;
export const RUBRIC_MAX_CRITERIA = 10;

/**
 * Kriteria rubrik — TETAP, empat. PRD §7 E11 `PR-10`, keputusan Dev A 14 Okt
 * (isu #73).
 *
 * ── Kenapa TETAP, bukan bebas ──
 *
 * Versi pertama menerima nama kriteria apa pun asal nilainya 0..5. Itu menutup
 * lubang poin (`{"apa_saja": 999999}` mencetak 999.999 poin) dan meninggalkan
 * lubang yang berbeda: **UI dan server tidak bisa dibuat sepakat.** `PR-03`
 * (form rubrik, Dev B) harus menampilkan daftar kriteria, dan tanpa daftar
 * resmi ia akan mengarangnya sendiri — lalu dua sisi menyimpang tanpa satu
 * pun galat, karena server menerima nama apa pun.
 *
 * Dan `rubric_scores` adalah `jsonb` yang disimpan permanen. Nama kriteria
 * yang bebas berarti data yang tidak bisa dianalisis belakangan: "berapa
 * rata-rata skor sitasi musim ini" tidak bisa dijawab kalau separuh baris
 * menulis `sitasi`, separuh `citation`, dan sisanya `kutipan`.
 *
 * ── Kenapa KEEMPAT ini ──
 *
 * Produk ini soal tulisan akademik — klinik plagiarisme dan ATS CV adalah dua
 * mesin monetisasinya. `sitasi` yang membedakan rubrik ini dari rubrik generik,
 * dan ia satu-satunya yang menyentuh hal yang juga diukur `K-02`.
 *
 * Total maksimum **20** (4 × 5). `PR-5` mengalikannya dengan
 * `reviewer_weight`, yang CHECK-nya 0,50..1,50 — jadi plafon poin satu review
 * **30**, dan itu angka yang bisa dihitung tangan saat memeriksa papan.
 *
 * `RUBRIC_MAX_CRITERIA = 10` DIPERTAHANKAN sebagai jaring kedua. Ia tidak
 * berguna lagi untuk membatasi jumlah (daftar tetap sudah membatasinya ke
 * empat), tapi ia tetap benar untuk apa yang memang dijaganya: badan request
 * yang mengirim seratus kunci ditolak sebelum satu pun nama dibandingkan.
 */
export const RUBRIC_KRITERIA = ['kejelasan', 'ketepatan', 'kelengkapan', 'sitasi'] as const;
export type RubricKriteria = (typeof RUBRIC_KRITERIA)[number];

/** Total tertinggi yang bisa dicapai satu review — 4 × 5. */
export const RUBRIC_TOTAL_MAX = RUBRIC_KRITERIA.length * RUBRIC_MAX_SCORE;

/**
 * Satu item antrean review — **tanpa identitas penulis**.
 *
 * Bentuk ini yang menegakkan PR-2. Tidak ada `author_id`, tidak ada nama,
 * tidak ada avatar. Bukan disembunyikan di UI — memang tidak ada di sini.
 */
export interface ReviewQueueItem {
  attempt_id: string;
  attempt_date: string;
  lesson_id: string;
  lesson_title: string;
  card_results: unknown;
  /** Berapa review yang sudah masuk untuk attempt ini (0 atau 1). */
  reviews_so_far: number;
}

export interface SubmitReviewInput {
  reviewerId: string;
  attemptId: string;
  rubricScores: Record<string, number>;
  comment?: string | undefined;
}

export interface SubmitReviewResult {
  id: string;
  /** Poin yang benar-benar diberikan. `0` berarti cap harian sudah habis. */
  weighted_points: number;
  /** Berapa review berpoin yang sudah dibuat reviewer ini HARI INI (lokal). */
  scored_today: number;
  /** `true` kalau review ini tersimpan tapi tidak berpoin (AC-PR-3). */
  capped: boolean;
}

/**
 * Total rubrik, DENGAN batas — PR-5 + aturan keras 9.
 *
 * Nilai rubrik datang dari klien, dan poin dihitung darinya. Tanpa validasi di
 * sini, `{"x": 999999}` mencetak 999.999 poin lewat endpoint publik. Yang
 * ditolak bukan cuma nilai di luar rentang tapi juga bentuk yang salah —
 * `NaN`, `Infinity`, pecahan, dan objek kosong semuanya menghasilkan total
 * yang tidak berarti.
 */
export function totalRubrik(scores: Record<string, number>): number {
  const kunci = Object.keys(scores);

  if (kunci.length === 0 || kunci.length > RUBRIC_MAX_CRITERIA) {
    throw new BadRequestException({
      error: {
        code: 'VALIDATION_ERROR',
        message: `Rubrik harus berisi 1..${RUBRIC_MAX_CRITERIA} kriteria`,
        details: { criteria: kunci.length, max: RUBRIC_MAX_CRITERIA },
      },
    });
  }

  // Nama kriteria diperiksa SEBELUM nilainya — isu #73. Daftar tetap, dan
  // keduanya arah: nama asing ditolak, DAN keempatnya wajib ada. Rubrik
  // separuh terisi akan menghasilkan total yang terlihat sah (mis. 10 dari
  // dua kriteria) sementara reviewer lain mengirim empat — dan poinnya
  // dibandingkan di papan yang sama.
  const asing = kunci.filter((k) => !(RUBRIC_KRITERIA as readonly string[]).includes(k));
  if (asing.length > 0) {
    throw new BadRequestException({
      error: {
        code: 'VALIDATION_ERROR',
        message: `Kriteria rubrik tidak dikenal: ${asing.join(', ')}`,
        details: { unknown: asing, expected: [...RUBRIC_KRITERIA] },
      },
    });
  }
  const hilang = RUBRIC_KRITERIA.filter((k) => !(k in scores));
  if (hilang.length > 0) {
    throw new BadRequestException({
      error: {
        code: 'VALIDATION_ERROR',
        message: `Kriteria rubrik belum lengkap: ${hilang.join(', ')}`,
        details: { missing: [...hilang], expected: [...RUBRIC_KRITERIA] },
      },
    });
  }

  let total = 0;
  for (const k of kunci) {
    const v = scores[k];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > RUBRIC_MAX_SCORE) {
      throw new BadRequestException({
        error: {
          code: 'VALIDATION_ERROR',
          message: `Nilai rubrik "${k}" harus bilangan bulat 0..${RUBRIC_MAX_SCORE}`,
          details: { criterion: k, value: v, max: RUBRIC_MAX_SCORE },
        },
      });
    }
    total += v;
  }
  return total;
}

/**
 * Peer review — PRD §7 E11 `PR-1` … `PR-5`.
 *
 * ── Kenapa tidak ada tabel "penugasan" ──
 *
 * `peer_reviews.rubric_scores` bertipe `NOT NULL`, jadi barisnya baru ada
 * setelah review DIKERJAKAN. Alokasi karena itu dihitung saat antrean dibaca,
 * bukan disimpan: attempt yang belum punya 2 review, bukan dari squad si
 * reviewer, dan bukan miliknya sendiri.
 *
 * Menyimpan penugasan akan menambah tabel di luar PRD §9 — dan menambah satu
 * keadaan yang bisa basi (reviewer keluar squad setelah ditugaskan).
 *
 * ── PR-2 ditegakkan oleh BENTUK DATA, bukan oleh kehati-hatian ──
 *
 * `ReviewQueueItem` tidak punya `author_id`. Tidak ada tempat untuk lupa
 * membuangnya, karena ia tidak pernah ada di sana. Serializer yang membuang
 * field bisa dilewati; tipe yang tidak punya field itu tidak bisa.
 */
@Injectable()
export class ReviewService {
  constructor(@Inject(DATABASE) private readonly db: Kysely<DB>) {}

  /**
   * Antrean review untuk satu reviewer — `GET /reviews/queue`.
   *
   * Empat penyaring, dan tiga di antaranya adalah aturan produk:
   *   1. attempt belum punya 2 review              (PR-1)
   *   2. bukan karya si reviewer sendiri           (PR-3)
   *   3. penulisnya BUKAN dari squad yang sama     (PR-1)
   *   4. reviewer ini belum menilainya             (UNIQUE attempt_id,reviewer_id)
   */
  async queueFor(reviewerId: string, limit = 20): Promise<ReviewQueueItem[]> {
    const r = await sql<{
      attempt_id: string;
      attempt_date: string;
      lesson_id: string;
      lesson_title: string;
      card_results: unknown;
      reviews_so_far: string;
    }>`
      WITH squad_reviewer AS (
        SELECT m.squad_id FROM squad_members m
        WHERE m.user_id = ${reviewerId} AND m.left_at IS NULL
      )
      SELECT a.id AS attempt_id,
             to_char(a.attempt_date, 'YYYY-MM-DD') AS attempt_date,
             a.lesson_id,
             l.title AS lesson_title,
             a.card_results,
             (SELECT count(*) FROM peer_reviews pr WHERE pr.attempt_id = a.id)::text
               AS reviews_so_far
      FROM lesson_attempts a
      JOIN lessons l ON l.id = a.lesson_id
      WHERE a.user_id <> ${reviewerId}
        AND (SELECT count(*) FROM peer_reviews pr WHERE pr.attempt_id = a.id)
            < ${sql.lit(REVIEWERS_PER_ATTEMPT)}
        AND NOT EXISTS (
          SELECT 1 FROM peer_reviews pr
          WHERE pr.attempt_id = a.id AND pr.reviewer_id = ${reviewerId}
        )
        -- PR-1: penulis TIDAK boleh dari squad yang sama. Reviewer tanpa squad
        -- melihat semuanya; penulis tanpa squad terlihat oleh semua orang.
        AND NOT EXISTS (
          SELECT 1
          FROM squad_members penulis
          JOIN squad_reviewer sr ON sr.squad_id = penulis.squad_id
          WHERE penulis.user_id = a.user_id AND penulis.left_at IS NULL
        )
      ORDER BY a.completed_at NULLS LAST, a.id
      LIMIT ${sql.lit(0)} + ${limit}
    `.execute(this.db);

    return r.rows.map((x) => ({
      attempt_id: x.attempt_id,
      attempt_date: x.attempt_date,
      lesson_id: x.lesson_id,
      lesson_title: x.lesson_title,
      card_results: x.card_results,
      reviews_so_far: Number(x.reviews_so_far),
    }));
  }

  /**
   * Menyimpan satu review — `POST /reviews/:id`.
   *
   * Setiap penyaring antrean diperiksa ULANG di sini. Antrean adalah tampilan;
   * ia bisa basi sejak halaman dibuka, dan klien bisa mengirim `attempt_id`
   * apa pun. Yang menentukan adalah pemeriksaan di jalur tulis.
   */
  async submit(input: SubmitReviewInput): Promise<SubmitReviewResult> {
    const rubrik = totalRubrik(input.rubricScores);

    return this.db.transaction().execute(async (trx) => {
      // Kunci baris reviewer DULU, sebelum menghitung apa pun.
      //
      // Cap harian dibaca lalu ditulis — klasik read-modify-write. Dua request
      // bersamaan dari reviewer yang sama sama-sama membaca "4 review berpoin
      // hari ini", keduanya lolos, dan hasilnya SIX review berpoin. Cap yang
      // bocor tepat di batasnya adalah cap yang tidak ada.
      //
      // `users` yang dikunci, bukan `peer_reviews`: barisnya belum ada, dan
      // tidak ada yang bisa dikunci pada baris yang belum ditulis.
      await trx
        .selectFrom('users')
        .select('id')
        .where('id', '=', input.reviewerId)
        .forUpdate()
        .executeTakeFirst();

      const attempt = await trx
        .selectFrom('lesson_attempts')
        .select(['id', 'user_id', 'attempt_date'])
        .where('id', '=', input.attemptId)
        .executeTakeFirst();

      if (!attempt) {
        throw new ConflictException({
          error: { code: 'NOT_FOUND', message: 'Attempt tidak ditemukan', details: {} },
        });
      }

      // PR-3, lapis service. Lapis kedua ada di CHECK `no_self_review`, dan
      // test membuktikan lapis kedua itu sungguhan dengan menembus yang ini.
      if (attempt.user_id === input.reviewerId) {
        throw new ForbiddenException({
          error: {
            code: 'SELF_REVIEW_FORBIDDEN',
            message: 'Tidak boleh menilai karya sendiri',
            details: {},
          },
        });
      }

      if (await this.sameSquad(input.reviewerId, attempt.user_id, trx)) {
        throw new ForbiddenException({
          error: {
            code: 'FORBIDDEN_ROLE',
            message: 'Reviewer tidak boleh dari squad yang sama dengan penulis',
            details: {},
          },
        });
      }

      const sudah = await trx
        .selectFrom('peer_reviews')
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .where('attempt_id', '=', input.attemptId)
        .executeTakeFirst();

      if (Number(sudah?.n ?? 0) >= REVIEWERS_PER_ATTEMPT) {
        throw new ConflictException({
          error: {
            code: 'ALREADY_PURCHASED',
            message: 'Attempt ini sudah punya dua review',
            details: { max: REVIEWERS_PER_ATTEMPT },
          },
        });
      }

      // PR-4 + aturan keras 5. "Hari ini" adalah hari lokal REVIEWER, dihitung
      // di Postgres dari `users.timezone` — bukan `::date` atas UTC.
      //
      // Bedanya bukan teoretis: reviewer WIB yang mengirim review pukul 06.00
      // akan dianggap "kemarin" oleh `created_at::date` UTC, sehingga cap
      // hariannya diam-diam jadi 10, bukan 5.
      const hitung = await sql<{ n: string }>`
        SELECT count(*)::text AS n
        FROM peer_reviews pr
        JOIN users u ON u.id = pr.reviewer_id
        WHERE pr.reviewer_id = ${input.reviewerId}
          AND pr.weighted_points > 0
          AND (pr.created_at AT TIME ZONE u.timezone)::date
            = (now()           AT TIME ZONE u.timezone)::date
      `.execute(trx);

      const berpoinHariIni = Number(hitung.rows[0]?.n ?? 0);
      const capped = berpoinHariIni >= DAILY_SCORED_CAP;

      // PR-5: poin = rubrik_total × reviewer_weight. `reviewer_weights` selalu
      // ada sejak AU-6 (trigger migrasi 005), tapi COALESCE tetap dipakai:
      // kalau barisnya hilang karena alasan apa pun, reviewer kehilangan poin
      // secara diam-diam — lebih baik dianggap 1,00 daripada 0.
      const bobot = await trx
        .selectFrom('reviewer_weights')
        .select('weight')
        .where('user_id', '=', input.reviewerId)
        .executeTakeFirst();

      // AC-PR-3: yang ke-6 TERSIMPAN, hanya poinnya 0. Bukan ditolak —
      // menolaknya akan menghukum reviewer yang rajin, dan penulis yang
      // karyanya nomor 6 tidak pernah mendapat review kedua.
      const poin = capped ? 0 : Math.round(rubrik * Number(bobot?.weight ?? 1));

      // UNIQUE `(attempt_id, reviewer_id)` menolak review kedua dari reviewer
      // yang sama — benar, dan itu yang menjaga integritasnya. Tapi tanpa
      // penanganan di sini, klien menerima **500** dari `DatabaseError` pg
      // 23505 untuk kondisi yang sepenuhnya normal: tombol dipencet dua kali.
      //
      // Ditemukan lewat review bermusuhan. Test yang ada hanya memastikan
      // tidak ada baris kedua — dan itu memang benar, lewat jalur yang salah.
      const sudahDinilai = await trx
        .selectFrom('peer_reviews')
        .select('id')
        .where('attempt_id', '=', input.attemptId)
        .where('reviewer_id', '=', input.reviewerId)
        .executeTakeFirst();

      if (sudahDinilai) {
        throw new ConflictException({
          error: {
            code: 'ALREADY_PURCHASED',
            message: 'Kamu sudah menilai karya ini',
            details: { review_id: sudahDinilai.id },
          },
        });
      }

      const row = await trx
        .insertInto('peer_reviews')
        .values({
          attempt_id: input.attemptId,
          // Wajib sejak migrasi 003 — bagian dari FK majemuk. Diambil DARI
          // BARIS attempt-nya, tidak pernah dibentuk di Node: ini tanggal
          // lokal pengguna, dan Date milik proses Node akan meleset satu hari.
          attempt_date: attempt.attempt_date,
          reviewer_id: input.reviewerId,
          author_id: attempt.user_id,
          rubric_scores: JSON.stringify(input.rubricScores),
          comment: input.comment ?? null,
          weighted_points: poin,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      return {
        id: row.id,
        weighted_points: poin,
        scored_today: berpoinHariIni + (poin > 0 ? 1 : 0),
        capped,
      };
    });
  }

  private async sameSquad(a: string, b: string, trx: Kysely<DB>): Promise<boolean> {
    const r = await trx
      .selectFrom('squad_members as x')
      .innerJoin('squad_members as y', 'y.squad_id', 'x.squad_id')
      .select('x.squad_id')
      .where('x.user_id', '=', a)
      .where('y.user_id', '=', b)
      .where('x.left_at', 'is', null)
      .where('y.left_at', 'is', null)
      .executeTakeFirst();
    return r !== undefined;
  }
}
