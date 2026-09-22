import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { type Kysely, type Transaction, sql } from 'kysely';

import { DATABASE, type DB } from '../infra/kysely';

export type Tier = 'bronze' | 'silver' | 'gold';
export type Outcome = 'promoted' | 'relegated' | 'stayed';

/** Urutan tier dari terendah. Promosi naik satu, degradasi turun satu. */
export const TIER_URUT: readonly Tier[] = ['bronze', 'silver', 'gold'];

/** `SQ-8`: 20% teratas promosi, 20% terbawah degradasi. */
export const PROPORSI = 0.2;

export interface RollupResult {
  seasonId: string;
  seasonCode: string;
  /** `false` kalau musimnya memang sudah ditutup sebelumnya (SQ-9). */
  closed: boolean;
  promoted: number;
  relegated: number;
  stayed: number;
}

/**
 * Penutupan musim liga — `Q-04`, PRD §7 E5 aturan `SQ-8` & `SQ-9`.
 *
 * > **SQ-8:** 20% teratas promosi, 20% terbawah degradasi. Gold tidak bisa
 * > promosi, Bronze tidak bisa degradasi.
 * > **SQ-9:** Rollup bersifat idempoten — dijalankan dua kali tidak menggeser
 * > tier dua langkah.
 *
 * ── Peringkat dihitung PER TIER, bukan seluruh liga ──
 *
 * "20% teratas" dari campuran Bronze dan Gold tidak berarti apa-apa: squad
 * Gold bermain melawan squad Gold. Jadi setiap tier diberi peringkatnya
 * sendiri, dan 20%-nya diambil dari jumlah squad di tier ITU.
 *
 * ── Idempoten ditegakkan DATABASE, bukan dengan memeriksa dulu ──
 *
 * `league_seasons.closed_at` diklaim lewat `UPDATE … WHERE closed_at IS NULL`
 * yang mengembalikan baris. Dua proses yang menutup musim yang sama secara
 * bersamaan: hanya satu yang mendapat barisnya, yang lain melihat nol dan
 * berhenti. Memeriksa `closed_at` lebih dulu lalu menutup akan membiarkan
 * keduanya lolos di celah antara baca dan tulis — dan akibatnya **tier bergeser
 * dua langkah**, persis yang dilarang SQ-9.
 *
 * ── Kenapa poin dibaca dari POSTGRES, bukan dari ZSET ──
 *
 * `SQ-4` menulisnya lurus: papan dilayani Redis, **Postgres tetap sumber
 * kebenaran**. Penutupan musim memindahkan squad antar-tier untuk seterusnya;
 * mendasarkannya pada cache yang boleh hilang kapan saja (`SQ-6`) berarti
 * hasil permanen yang bergantung pada data sementara.
 *
 * ── Yang TIDAK dikerjakan di sini ──
 *
 * Musim berikutnya tidak dibuat, dan `squad_members.weekly_points` tidak
 * di-reset. Keduanya milik pembentukan squad mingguan (`Q-01`), dan
 * menggabungkannya membuat "tutup musim" tidak bisa dijalankan ulang dengan
 * aman — padahal justru itu yang diminta SQ-9.
 *
 * ── Peringatan: promosi belum berpengaruh pada apa pun (isu #111) ──
 *
 * `SQ-8` mengatakan squad promosi; §5 Q4 mengatakan squad **dibentuk ulang
 * setiap minggu**, dan `formSquads()` membuat baris baru bertier `bronze`.
 * Keduanya tidak bisa sama-sama benar: squad yang naik ke Gold hari Minggu
 * tidak ada lagi hari Senin.
 *
 * Yang ditulis di sini sengaja berhenti pada yang bisa dipertanggungjawabkan:
 * `league_standings` mencatat peringkat dan nasibnya, dan `squads.league_tier`
 * mencatat di mana squad itu BERAKHIR. Mekanisme membawa tier ke musim
 * berikutnya TIDAK dikarang di sini — ia butuh keputusan (dan kemungkinan
 * kolom baru), dan itu isu #111.
 */
@Injectable()
export class LeagueRollupService {
  private readonly log = new Logger(LeagueRollupService.name);

  constructor(@Inject(DATABASE) private readonly db: Kysely<DB>) {}

  /**
   * Menutup satu musim dan memindahkan tier.
   *
   * Aman dijalankan berkali-kali: panggilan kedua mengembalikan
   * `closed: false` tanpa menyentuh satu pun tier.
   */
  async closeSeason(seasonCode: string): Promise<RollupResult> {
    return this.db.transaction().execute(async (trx) => {
      const season = await trx
        .selectFrom('league_seasons')
        .select(['id', 'code', 'closed_at'])
        .where('code', '=', seasonCode)
        .executeTakeFirst();

      if (!season) {
        throw new NotFoundException({
          error: {
            code: 'NOT_FOUND',
            message: 'Musim tidak ditemukan',
            details: { season_code: seasonCode },
          },
        });
      }

      // Klaim penutupannya DI SINI, sebagai satu perintah yang mengembalikan
      // baris. Inilah yang membuat SQ-9 benar terhadap dua proses paralel,
      // bukan komentar "jangan jalankan dua kali".
      const klaim = await trx
        .updateTable('league_seasons')
        .set({ closed_at: new Date() })
        .where('id', '=', season.id)
        .where('closed_at', 'is', null)
        .returning('id')
        .executeTakeFirst();

      if (!klaim) {
        const sudah = await this.hitungOutcome(trx, season.id);
        this.log.log(`Musim ${seasonCode} sudah ditutup sebelumnya — tier tidak disentuh.`);
        return { seasonId: season.id, seasonCode, closed: false, ...sudah };
      }

      const hasil = { promoted: 0, relegated: 0, stayed: 0 };

      // Seluruh squad dibaca SEKALI, sebelum satu pun tier diubah.
      //
      // Versi pertama membaca per tier di dalam loop yang juga MENULIS tier.
      // Urutannya bronze → silver → gold, jadi squad yang baru dipromosikan
      // dari bronze ikut terbaca lagi saat giliran silver — dan bisa naik
      // DUA KALI dalam satu panggilan. Persis pergeseran dua langkah yang
      // dilarang SQ-9, hanya sumbernya bukan pemanggilan kedua melainkan
      // loop-nya sendiri. Ditangkap test, bukan review.
      //
      // Poin squad = jumlah poin mingguan ANGGOTA AKTIFNYA. Anggota yang
      // keluar tengah musim tidak membawa poinnya (SQ-10), dan `left_at`
      // itulah yang menyatakannya.
      const semua = await trx
        .selectFrom('squads as s')
        .leftJoin('squad_members as m', (j) =>
          j.onRef('m.squad_id', '=', 's.id').on('m.left_at', 'is', null),
        )
        .select([
          's.id as squad_id',
          's.league_tier as tier',
          sql<string>`COALESCE(SUM(m.weekly_points), 0)::text`.as('points'),
        ])
        .where('s.season_id', '=', season.id)
        .groupBy(['s.id', 's.league_tier'])
        // Seri diputus `s.id` supaya peringkatnya tidak berubah antar
        // pemanggilan — hasil permanen tidak boleh bergantung urutan baca.
        .orderBy(sql`COALESCE(SUM(m.weekly_points), 0)`, 'desc')
        .orderBy('s.id')
        .execute();

      for (const tier of TIER_URUT) {
        // Sudah terurut poin menurun dari query di atas; menyaring tidak
        // mengubah urutannya.
        const squads = semua.filter((x) => x.tier === tier);
        if (squads.length === 0) continue;

        const n = squads.length;
        // `floor`: dengan 4 squad, 20% = 0,8 → NOL yang promosi. Membulatkan
        // ke atas membuat liga kecil memindahkan satu squad setiap minggu,
        // dan tier berhenti berarti apa-apa.
        const kuota = Math.floor(n * PROPORSI);

        const bisaNaik = tier !== 'gold';
        const bisaTurun = tier !== 'bronze';

        for (const [i, squad] of squads.entries()) {
          const diAtas = i < kuota;
          const diBawah = i >= n - kuota;

          // Di liga sangat kecil satu squad bisa masuk KEDUA himpunan.
          // Dijaga eksplisit: naik menang, dan squad tidak pernah diturunkan
          // karena kebetulan juga jadi juara.
          let outcome: Outcome = 'stayed';
          if (diAtas && bisaNaik) outcome = 'promoted';
          else if (diBawah && !diAtas && bisaTurun) outcome = 'relegated';

          const tierBaru = geser(tier, outcome);
          hasil[outcome] += 1;

          await trx
            .insertInto('league_standings')
            .values({
              season_id: season.id,
              squad_id: squad.squad_id,
              tier, // tier SAAT musim itu berjalan, bukan hasilnya
              points: Number(squad.points),
              rank: i + 1,
              outcome,
              closed_at: new Date(),
            })
            .onConflict((oc) =>
              oc.columns(['season_id', 'squad_id']).doUpdateSet({
                tier,
                points: Number(squad.points),
                rank: i + 1,
                outcome,
                closed_at: new Date(),
              }),
            )
            .execute();

          if (tierBaru !== tier) {
            await trx
              .updateTable('squads')
              .set({ league_tier: tierBaru })
              .where('id', '=', squad.squad_id)
              .execute();
          }
        }
      }

      this.log.log(
        `Musim ${seasonCode} ditutup: ${hasil.promoted} promosi, ` +
          `${hasil.relegated} degradasi, ${hasil.stayed} bertahan.`,
      );
      return { seasonId: season.id, seasonCode, closed: true, ...hasil };
    });
  }

  /**
   * Musim yang sudah lewat `ends_at` tapi belum ditutup.
   *
   * Dipakai penjadwal. Mengembalikan daftar, bukan satu: kalau job-nya mati
   * dua minggu, dua musim menunggu — dan yang tertua harus ditutup lebih dulu.
   */
  async seasonsSiapDitutup(): Promise<string[]> {
    const rows = await this.db
      .selectFrom('league_seasons')
      .select('code')
      .where('closed_at', 'is', null)
      .where('ends_at', '<=', new Date())
      .orderBy('ends_at')
      .execute();
    return rows.map((r) => r.code);
  }

  /** Menutup semua yang siap, tertua dulu. */
  async run(): Promise<RollupResult[]> {
    const kode = await this.seasonsSiapDitutup();
    if (kode.length === 0) return [];
    if (kode.length > 1) {
      // Tidak fatal — tapi berarti penjadwalnya sempat mati, dan itu pantas
      // terlihat di log tanpa harus membandingkan tanggal sendiri.
      this.log.warn(`${kode.length} musim menunggu ditutup: ${kode.join(', ')}`);
    }
    const out: RollupResult[] = [];
    for (const c of kode) out.push(await this.closeSeason(c));
    return out;
  }

  private async hitungOutcome(
    trx: Transaction<DB>,
    seasonId: string,
  ): Promise<{ promoted: number; relegated: number; stayed: number }> {
    const rows = await trx
      .selectFrom('league_standings')
      .select(['outcome', (eb) => eb.fn.countAll<string>().as('n')])
      .where('season_id', '=', seasonId)
      .groupBy('outcome')
      .execute();

    const out = { promoted: 0, relegated: 0, stayed: 0 };
    for (const r of rows) {
      if (r.outcome === 'promoted' || r.outcome === 'relegated' || r.outcome === 'stayed') {
        out[r.outcome] = Number(r.n);
      }
    }
    return out;
  }
}

/**
 * Tier sesudah `outcome`, dijepit di ujungnya.
 *
 * `SQ-8` melarang Gold promosi dan Bronze degradasi. Penjepitan ini lapis
 * KEDUA — pemanggilnya sudah tidak pernah memberi `promoted` pada Gold. Dua
 * lapis karena kesalahannya tidak terlihat: squad yang "promosi" dari Gold
 * akan diam-diam tetap Gold kalau hanya dijepit, dan diam-diam keluar dari
 * enum kalau tidak dijepit sama sekali.
 */
export function geser(tier: Tier, outcome: Outcome): Tier {
  const i = TIER_URUT.indexOf(tier);
  if (outcome === 'promoted') return TIER_URUT[Math.min(i + 1, TIER_URUT.length - 1)]!;
  if (outcome === 'relegated') return TIER_URUT[Math.max(i - 1, 0)]!;
  return tier;
}
