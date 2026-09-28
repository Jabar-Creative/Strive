import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type Redis from 'ioredis';
import { CompiledQuery } from 'kysely';

import { DATABASE, type DB } from '../../infra/kysely';
import { REDIS } from '../../infra/redis';

/**
 * Probe KESIAPAN — isu #155.
 *
 * ── Kenapa terpisah dari `/health` ──
 *
 * `HealthService.check()` tidak menyentuh apa pun. Itu benar untuk probe
 * KEAKTIFAN: pertanyaannya "proses ini masih hidup?", dan jawabannya tidak
 * boleh bergantung pada Postgres — kalau bergantung, database yang tersendat
 * lima detik akan me-restart proses yang sehat, dan restart itu justru
 * memperburuk keadaan.
 *
 * Yang hilang karenanya nyata, dan itu yang ditutup berkas ini: healthcheck
 * orkestrator yang hijau hanya berarti **proses Node hidup**. Postgres mati
 * total meninggalkan seluruh probe hijau, deployment dinyatakan sukses, dan
 * yang pertama tahu adalah pengguna yang gagal login.
 *
 * ── Kenapa BATAS_MS ada, dan kenapa kecil ──
 *
 * Probe yang menggantung lebih buruk daripada probe yang gagal: orkestrator
 * menunggu sampai timeout-nya sendiri, dan selama itu ia tidak tahu apa-apa.
 * Dependensi yang tidak menjawab dalam dua detik SUDAH tidak bisa melayani
 * request pengguna, jadi memanggilnya "siap" tidak membantu siapa pun.
 *
 * ── Yang sengaja TIDAK dilaporkan ──
 *
 * Tidak ada host, tidak ada versi, tidak ada pesan galat mentah. `/health`
 * tidak boleh jadi jalan membocorkan keadaan kredensial — komentar yang sama
 * sudah tertulis di `services/ai/app/main.py`. Yang keluar hanya `ok` atau
 * `gagal` per dependensi; sebabnya ada di log terstruktur, yang butuh akses.
 */
export const BATAS_MS = 2_000;

/** Satu dependensi: `ok` atau `gagal`. Tidak ada keadaan ketiga. */
export type StatusDependensi = 'ok' | 'gagal';

export interface Kesiapan {
  status: 'siap' | 'belum';
  checks: { database: StatusDependensi; redis: StatusDependensi };
}

/**
 * Menjalankan `kerja` dengan batas waktu. Menolak — bukan menggantung —
 * saat lewat, dan tidak membiarkan timer-nya menahan proses tetap hidup.
 */
export async function dalamBatas<T>(kerja: () => Promise<T>, batasMs = BATAS_MS): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      kerja(),
      new Promise<never>((_, tolak) => {
        timer = setTimeout(() => tolak(new Error(`lewat ${batasMs} ms`)), batasMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

@Injectable()
export class ReadinessService {
  constructor(
    @Inject(DATABASE) private readonly db: Kysely<DB>,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async check(): Promise<Kesiapan> {
    // Keduanya ditembak BERSAMAAN, bukan berurutan: probe yang menunggu
    // Postgres dulu memakan dua kali batas waktunya saat keduanya sakit.
    const [database, redis] = await Promise.all([this.periksaDatabase(), this.periksaRedis()]);
    const siap = database === 'ok' && redis === 'ok';
    return { status: siap ? 'siap' : 'belum', checks: { database, redis } };
  }

  private async periksaDatabase(): Promise<StatusDependensi> {
    try {
      // `executeQuery(CompiledQuery.raw(...))` — API PUBLIK Kysely, bukan
      // `sql\`…\`.execute(db)` yang lewat `getExecutor()` internal. Bedanya
      // bukan gaya: yang kedua membuat probe ini hanya bisa diuji dengan
      // tiruan yang meniru isi perut Kysely, dan tiruan seperti itu berhenti
      // benar diam-diam saat pustakanya berubah.
      await dalamBatas(() => this.db.executeQuery(CompiledQuery.raw('select 1')));
      return 'ok';
    } catch {
      return 'gagal';
    }
  }

  private async periksaRedis(): Promise<StatusDependensi> {
    try {
      // `enableOfflineQueue: false` di `createRedis()` membuat PING MENOLAK
      // saat koneksi belum siap atau sudah putus, alih-alih mengantre. Untuk
      // probe kesiapan itu justru yang diinginkan: "belum siap" adalah
      // jawaban yang benar saat Redis belum siap.
      await dalamBatas(() => this.redis.ping());
      return 'ok';
    } catch {
      return 'gagal';
    }
  }
}
