'use client';

/**
 * Hook useRealtime + fallback polling otomatis — RT-02 (Dev B), PRD §7 E15
 * + §11, AC: "Mematikan WS server tidak membuat layar mana pun kosong atau
 * error — hanya lebih lambat diperbarui."
 *
 * Ini generalisasi mesin Q-05 (`leaderboard-live.ts` — teruji unit dengan
 * soket palsu): seluruh keputusan TRANSPORT tetap di mesin itu; hook hanya
 * memasang/melepas mesin seumur hidup komponen dan menyiapkan penjaga
 * refetch supaya tiap layar tidak menulis closure penjaga sendiri.
 *
 * Dua mode pemakaian:
 *  - `squadId` terisi: WS kanal squad (RT-1) + polling 30 dtk cadangan;
 *    indikator mode ("Langsung"/"per 30 dtk") jujur ke pengguna.
 *  - `squadId` null: polling-murni — kanal `user:`/`league:` memang TIDAK
 *    dibangun di v0.1 (PRD E15: tetap polling), dan layar semacam itu
 *    memakai hook yang sama tanpa soket.
 */

import { useEffect, useState } from 'react';

import { buatPapanLive, buatSoketSquad, type ModePapan } from './leaderboard-live';
import { buatPenjagaRefetch } from './refetch-guard';

export interface OpsiRealtime {
  /** Kanal squad; null = polling-murni tanpa soket. */
  squadId: string | null;
  /** Pengambilan data via REST — dipanggil mesin (awal + poll + event WS). */
  ambil: () => Promise<unknown>;
  /** Dasar URL API untuk soket (mis. http://localhost:3001). */
  apiBase: string;
  intervalMs?: number;
}

export interface Realtime {
  mode: ModePapan;
}

export function useRealtime({ squadId, ambil, apiBase, intervalMs }: OpsiRealtime): Realtime {
  const [mode, setMode] = useState<ModePapan>('polling');

  useEffect(() => {
    // Penjaga dipasang SEKALI per hidup mesin: identitas `ambil` boleh
    // berubah antar-render tanpa memasang ulang mesin (interval/subscribe
    // tidak boleh restart hanya karena komponen induk re-render).
    const penjaga = buatPenjagaRefetch(ambil);
    const live = buatPapanLive({
      squadId: squadId ?? '',
      // Mesin menunggu Promise; penjaga sinkron (catat-atau-jalan) — bungkus
      // jadi Promise.resolve() supaya signature mesin tidak berubah.
      ambil: () => {
        penjaga.ambil();
        return Promise.resolve();
      },
      // squadId null → TIDAK membuat soket sama sekali (mode polling murni).
      buatSoket: squadId ? () => buatSoketSquad(apiBase) : undefined,
      intervalMs,
      saatModeBerubah: setMode,
    });
    return () => live.lepas();
    // `ambil` sengaja TIDAK di daftar dependensi — lihat komentar penjaga.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [squadId, apiBase, intervalMs]);

  return { mode };
}
