import { Inject, Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';

import { DATABASE, type DB } from '../../infra/kysely';

/**
 * Zona waktu operasional untuk "hari ini".
 *
 * Aturan keras 5 mengikat "hari ini" ke zona waktu PENGGUNA, dan itu tetap
 * berlaku untuk streak, quest, dan kuota harian. Angka di sini bukan itu: ia
 * biaya vendor yang dibaca tim ops, dan tim ops ada di satu zona waktu.
 * Memakai UTC akan membuat "hari ini" berakhir pukul 07.00 pagi WIB — persis
 * jebakan yang sama, hanya untuk pembaca yang berbeda.
 *
 * Nilainya ikut dikirim di respons supaya angkanya tidak pernah ambigu.
 */
export const TZ_OPS = 'Asia/Jakarta';

/** Jendela pengamatan kesehatan vendor. */
export const JENDELA_MENIT = 60;

/** Berapa kali lipat di atas dasar sebelum disebut lonjakan. */
export const AMBANG_LONJAKAN = 3;

/** Di bawah ini, rasio tidak berarti apa-apa — 0,000001 → 0,000004 bukan insiden. */
export const LANTAI_LONJAKAN_USD = 0.5;

/** Berapa hari sebelum hari ini yang membentuk garis dasar. */
export const HARI_DASAR = 6;

/**
 * Notifikasi yang baru dibuat belum tentu gagal — ia belum sempat dikirim.
 * Di bawah tenggang ini ia tidak dihitung apa pun.
 */
export const TENGGANG_KIRIM_MENIT = 5;

export type StatusVendor = 'up' | 'degraded' | 'down' | 'not_configured' | 'unknown';

export interface KesehatanVendor {
  vendor: string;
  status: StatusVendor;
  ok: number;
  gagal: number;
  catatan?: string;
}

export interface BiayaModel {
  model: string | null;
  cost_usd: string;
  jobs: number;
}

export interface IntegrationsHealth {
  generated_at: string;
  timezone: string;
  window_minutes: number;
  integrations: KesehatanVendor[];
  llm_cost: {
    today_usd: string;
    by_model: BiayaModel[];
    last_7_days: { date: string; cost_usd: string }[];
    spike: { baseline_usd: string; ratio: number | null; alert: boolean };
  };
  scans: { today: number; by_status: Record<string, number> };
}

/**
 * `GET /admin/integrations/health` — `SA-03`, PRD §10.3, `SA-6`.
 *
 * > **Selesai berarti:** Lonjakan biaya LLM terlihat di hari yang sama. Status
 * > tiap vendor (up/down/degraded) akurat.
 *
 * ── Status diturunkan dari PENGALAMAN KITA, bukan dari ping ke vendor ──
 *
 * Godaan pertamanya memanggil endpoint status tiap vendor. Itu menjawab
 * pertanyaan yang salah: vendor bisa menjawab `/health` dengan 200 sementara
 * setiap panggilan sungguhan kita gagal karena kuota, kredensial, atau bentuk
 * request yang berubah. Yang perlu diketahui superadmin bukan "apakah server
 * mereka hidup" melainkan **"apakah pengguna kita sedang gagal"** — dan itu
 * ada di tabel kita sendiri.
 *
 * Efek sampingnya juga benar: membuka dasbor admin tidak menembak Midtrans.
 *
 * ── Lima status, bukan tiga ──
 *
 * Acceptance criteria menyebut `up`/`down`/`degraded`, dan dua lagi
 * ditambahkan karena tanpanya jawabannya akan BOHONG:
 *
 *   `not_configured`  Kredensialnya kosong. Hari ini itu keadaan Midtrans dan
 *                     Copyleaks (isu #29-an: menunggu akun vendor). Menyebutnya
 *                     `down` menyalahkan vendor untuk konfigurasi kita;
 *                     menyebutnya `up` adalah kebohongan langsung.
 *   `unknown`         Tidak ada satu pun panggilan dalam jendela. Nol kegagalan
 *                     dari nol percobaan bukan bukti sehat.
 *
 * "Akurat" di acceptance criteria itulah yang menuntut keduanya ada.
 */
@Injectable()
export class IntegrationsHealthService {
  constructor(@Inject(DATABASE) private readonly db: Kysely<DB>) {}

  async get(): Promise<IntegrationsHealth> {
    const [llm, copyleaks, midtrans, resend, biaya, tujuhHari, scans] = await Promise.all([
      this.kesehatanLlm(),
      this.kesehatanCopyleaks(),
      this.kesehatanMidtrans(),
      this.kesehatanResend(),
      this.biayaHariIni(),
      this.biayaTujuhHari(),
      this.scanHariIni(),
    ]);

    return {
      generated_at: new Date().toISOString(),
      timezone: TZ_OPS,
      window_minutes: JENDELA_MENIT,
      integrations: [llm, copyleaks, midtrans, resend],
      llm_cost: {
        today_usd: biaya.total,
        by_model: biaya.perModel,
        last_7_days: tujuhHari,
        spike: lonjakan(biaya.total, tujuhHari, biaya.tanggal),
      },
      scans,
    };
  }

  /** Vendor LLM — dilihat dari `ai_jobs`, satu-satunya jalur ke LLM (aturan 8). */
  private async kesehatanLlm(): Promise<KesehatanVendor> {
    const r = await this.db
      .selectFrom('ai_jobs')
      .select([
        sql<string>`count(*) filter (where status = 'done')`.as('ok'),
        sql<string>`count(*) filter (where status = 'failed')`.as('gagal'),
      ])
      .where('created_at', '>', sql<Date>`now() - ${sql.lit(JENDELA_MENIT)} * interval '1 minute'`)
      .executeTakeFirstOrThrow();

    const belumDikonfigurasi = (process.env['AI_SERVICE_TOKEN'] ?? '').length === 0;
    return this.rakit('llm', Number(r.ok), Number(r.gagal), {
      belumDikonfigurasi,
      catatanKosong: 'AI_SERVICE_TOKEN kosong',
    });
  }

  private async kesehatanCopyleaks(): Promise<KesehatanVendor> {
    const r = await this.db
      .selectFrom('plagiarism_scans')
      .select([
        sql<string>`count(*) filter (where status = 'done')`.as('ok'),
        sql<string>`count(*) filter (where status = 'failed')`.as('gagal'),
      ])
      .where('created_at', '>', sql<Date>`now() - ${sql.lit(JENDELA_MENIT)} * interval '1 minute'`)
      .executeTakeFirstOrThrow();

    return this.rakit('copyleaks', Number(r.ok), Number(r.gagal), {
      belumDikonfigurasi: (process.env['COPYLEAKS_API_KEY'] ?? '').length === 0,
      catatanKosong: 'COPYLEAKS_API_KEY kosong',
    });
  }

  /**
   * Midtrans — dilihat dari `payments`, bukan `orders`.
   *
   * Order `pending` yang menumpuk BUKAN tanda Midtrans sakit: pengguna yang
   * membuka Snap lalu menutupnya juga meninggalkan `pending`. Yang benar-benar
   * datang dari Midtrans adalah baris `payments`.
   */
  private async kesehatanMidtrans(): Promise<KesehatanVendor> {
    const r = await this.db
      .selectFrom('payments')
      .select([
        sql<string>`count(*) filter (where signature_ok)`.as('ok'),
        sql<string>`count(*) filter (where not signature_ok)`.as('gagal'),
      ])
      .where('received_at', '>', sql<Date>`now() - ${sql.lit(JENDELA_MENIT)} * interval '1 minute'`)
      .executeTakeFirstOrThrow();

    return this.rakit('midtrans', Number(r.ok), Number(r.gagal), {
      belumDikonfigurasi: (process.env['MIDTRANS_SERVER_KEY'] ?? '').length === 0,
      catatanKosong: 'MIDTRANS_SERVER_KEY kosong — P-02 menunggu kredensial vendor',
    });
  }

  /**
   * Resend — dan di sinilah "akurat" paling mudah dilanggar.
   *
   * Versi pertama menghitung SETIAP `sent_at IS NULL` sebagai gagal. Itu
   * salah dua kali:
   *
   * 1. Notifikasi yang baru dibuat sepuluh detik lalu belum gagal — ia belum
   *    sempat dikirim. Sistem yang sehat dan sibuk akan terlihat `degraded`
   *    justru karena ia sibuk.
   * 2. Lebih buruk: worker notifikasi **belum dijadwalkan sama sekali**
   *    (isu #131). Jadi begitu ada satu notifikasi, vendor ini dilaporkan
   *    `down` — menyalahkan Resend untuk worker kita sendiri yang tidak
   *    berjalan. Dasbor yang menunjuk pihak yang salah lebih buruk daripada
   *    dasbor kosong: ia mengirim orang menelepon vendor.
   *
   * Sekarang hanya yang sudah lewat tenggang yang dihitung gagal; yang masih
   * di dalamnya tidak dihitung apa pun, dan nol panggilan berarti `unknown`.
   */
  private async kesehatanResend(): Promise<KesehatanVendor> {
    const r = await this.db
      .selectFrom('notifications')
      .select([
        sql<string>`count(*) filter (where sent_at is not null)`.as('ok'),
        sql<string>`count(*) filter (
          where sent_at is null
            and created_at < now() - ${sql.lit(TENGGANG_KIRIM_MENIT)} * interval '1 minute'
        )`.as('gagal'),
      ])
      .where('created_at', '>', sql<Date>`now() - ${sql.lit(JENDELA_MENIT)} * interval '1 minute'`)
      .executeTakeFirstOrThrow();

    return this.rakit('resend', Number(r.ok), Number(r.gagal), {
      belumDikonfigurasi: (process.env['RESEND_API_KEY'] ?? '').length === 0,
      catatanKosong: 'RESEND_API_KEY kosong',
    });
  }

  private rakit(
    vendor: string,
    ok: number,
    gagal: number,
    opsi: { belumDikonfigurasi: boolean; catatanKosong: string },
  ): KesehatanVendor {
    if (opsi.belumDikonfigurasi) {
      return { vendor, status: 'not_configured', ok, gagal, catatan: opsi.catatanKosong };
    }
    const total = ok + gagal;
    if (total === 0) {
      return {
        vendor,
        status: 'unknown',
        ok,
        gagal,
        catatan: 'tidak ada panggilan di jendela ini',
      };
    }
    if (gagal === 0) return { vendor, status: 'up', ok, gagal };
    return { vendor, status: gagal / total >= 0.5 ? 'down' : 'degraded', ok, gagal };
  }

  /** Biaya LLM HARI INI menurut zona waktu ops, per model dan totalnya. */
  private async biayaHariIni(): Promise<{
    total: string;
    perModel: BiayaModel[];
    tanggal: string;
  }> {
    const rows = await this.db
      .selectFrom('ai_jobs')
      .select([
        'model',
        sql<string>`coalesce(sum(cost_usd), 0)::text`.as('cost_usd'),
        sql<string>`count(*)`.as('jobs'),
      ])
      .where('cost_usd', 'is not', null)
      .where(
        sql<boolean>`(created_at AT TIME ZONE ${sql.lit(TZ_OPS)})::date = (now() AT TIME ZONE ${sql.lit(TZ_OPS)})::date`,
      )
      .groupBy('model')
      .orderBy('model')
      .execute();

    // Tanggal ops diambil dari POSTGRES, bukan dibentuk di Node: `lonjakan()`
    // memakainya untuk menyaring hari ini dari daftar, dan daftar itu juga
    // lahir dari `(created_at AT TIME ZONE …)::date` di Postgres. Dua sumber
    // tanggal berbeda akan meleset tepat di tengah malam.
    const hari = await sql<{
      t: string;
    }>`select (now() AT TIME ZONE ${sql.lit(TZ_OPS)})::date::text as t`.execute(this.db);
    const tanggal = hari.rows[0]!.t;

    const total = rows.reduce((n, r) => n + Number(r.cost_usd), 0);
    return {
      total: total.toFixed(6),
      perModel: rows.map((r) => ({ model: r.model, cost_usd: r.cost_usd, jobs: Number(r.jobs) })),
      tanggal,
    };
  }

  /** Tujuh hari terakhir, termasuk hari ini — dasar pembanding lonjakan. */
  private async biayaTujuhHari(): Promise<{ date: string; cost_usd: string }[]> {
    const rows = await this.db
      .selectFrom('ai_jobs')
      .select([
        sql<string>`(created_at AT TIME ZONE ${sql.lit(TZ_OPS)})::date::text`.as('date'),
        sql<string>`coalesce(sum(cost_usd), 0)::text`.as('cost_usd'),
      ])
      .where('cost_usd', 'is not', null)
      .where(
        sql<boolean>`(created_at AT TIME ZONE ${sql.lit(TZ_OPS)})::date > (now() AT TIME ZONE ${sql.lit(TZ_OPS)})::date - 7`,
      )
      .groupBy(sql`(created_at AT TIME ZONE ${sql.lit(TZ_OPS)})::date`)
      .orderBy(sql`(created_at AT TIME ZONE ${sql.lit(TZ_OPS)})::date`)
      .execute();
    return rows;
  }

  private async scanHariIni(): Promise<{ today: number; by_status: Record<string, number> }> {
    const rows = await this.db
      .selectFrom('plagiarism_scans')
      .select(['status', sql<string>`count(*)`.as('n')])
      .where(
        sql<boolean>`(created_at AT TIME ZONE ${sql.lit(TZ_OPS)})::date = (now() AT TIME ZONE ${sql.lit(TZ_OPS)})::date`,
      )
      .groupBy('status')
      .execute();

    const by_status: Record<string, number> = {};
    let today = 0;
    for (const r of rows) {
      by_status[r.status] = Number(r.n);
      today += Number(r.n);
    }
    return { today, by_status };
  }
}

/**
 * Lonjakan: hari ini dibandingkan RATA-RATA hari sebelumnya.
 *
 * Satu angka sendirian tidak memperlihatkan lonjakan — "$4 hari ini" bisa
 * biasa saja atau sepuluh kali lipat, dan acceptance criteria menuntutnya
 * **terlihat**, bukan tersedia. Jadi yang dikirim bukan cuma angkanya
 * melainkan pembanding dan putusannya.
 *
 * Lantai `LANTAI_LONJAKAN_USD` menahan alarm palsu: dari $0,000001 ke
 * $0,000004 rasionya 4× dan artinya nol.
 */
export function lonjakan(
  hariIniUsd: string,
  tujuhHari: { date: string; cost_usd: string }[],
  tanggalHariIni: string,
): { baseline_usd: string; ratio: number | null; alert: boolean } {
  const hariIni = Number(hariIniUsd);

  // Hari TANPA baris berarti biaya NOL, dan nol itu harus ikut menurunkan
  // rata-rata. Versi pertama membagi dengan `sebelumnya.length` — jumlah hari
  // yang kebetulan punya baris — jadi hari sepi tidak pernah masuk hitungan
  // dan garis dasarnya melambung.
  //
  // Akibatnya persis kebalikan dari guna alarm ini, dan paling parah justru
  // sekarang, saat produknya masih sepi: lima hari nol + satu hari $6
  // menghasilkan dasar $6 (bukan $1), jadi hari ini $12 terbaca 2× dan
  // TIDAK berbunyi — padahal sebenarnya 12×.
  //
  // Hari ini juga disaring lewat TANGGALNYA, bukan `slice(0, -1)`. Kalau hari
  // ini belum punya biaya sama sekali, ia tidak ada di daftar, dan `slice`
  // akan membuang hari terakhir yang justru bagian dari dasar.
  const sebelumnya = tujuhHari.filter((d) => d.date !== tanggalHariIni);
  const total = sebelumnya.reduce((n, d) => n + Number(d.cost_usd), 0);
  const dasar = total / HARI_DASAR;
  if (dasar === 0) {
    return {
      baseline_usd: '0.000000',
      ratio: null,
      alert: hariIni >= LANTAI_LONJAKAN_USD,
    };
  }

  const ratio = hariIni / dasar;
  return {
    baseline_usd: dasar.toFixed(6),
    ratio: Number(ratio.toFixed(2)),
    alert: ratio >= AMBANG_LONJAKAN && hariIni >= LANTAI_LONJAKAN_USD,
  };
}
