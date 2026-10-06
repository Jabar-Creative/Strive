/**
 * Mesin papan squad Q-05 (Dev B), PRD §7 E5 + RT-5.
 *
 * DUA acceptance criteria item ini tinggal di sini, teruji dengan soket
 * palsu (lihat leaderboard-live.spec.ts):
 *
 *   AC 1: "Papan tetap benar saat koneksi WS putus lalu pulih."
 *   AC 2: "Tanpa WS sama sekali, papan tetap terisi lewat polling."
 *
 * Bentuknya keputusan TRANSPORT, bukan keputusan data: `ambil` selalu
 * memanggil REST `GET /squads/:id/leaderboard` (Q-06). Event `score.updated`
 * hanya PEMBERITAHU refetch — tidak membawa angka, jadi papan tidak pernah
 * bisa "bernilai benar" dari jalur WS saja. Itu juga sebabnya polling
 * dinyalakan SEJAK AWAL dan baru berhenti saat subscribe WS di-ack: kondisi
 * "WS tidak pernah tersambung" tidak butuh event galat apa pun untuk tetap
 * terisi.
 */

import { io } from 'socket.io-client';

export type ModePapan = 'langsung' | 'polling';

/** Antarmuka soket yang dipakai mesin — socket.io sungguhan lewat pabrik. */
export interface SoketLive {
  on(event: string, fn: (...args: unknown[]) => void): void;
  emitAck(event: string, payload: unknown): Promise<unknown>;
  close(): void;
}

export interface ConfigPapan {
  squadId: string;
  /** Pengambilan ulang papan (REST). Dipanggil langsung saat dipasang. */
  ambil: () => Promise<void>;
  /** Pabrik soket — diinjeksi supaya mesin teruji tanpa jaringan. */
  buatSoket?: () => SoketLive;
  intervalMs?: number;
  saatModeBerubah?: (mode: ModePapan) => void;
}

export interface PapanLive {
  mode(): ModePapan;
  lepas(): void;
}

const INTERVAL_POLL_MS = 30_000;

/**
 * Memasang mesin: pengambilan awal + polling 30 dtk + langganan WS bila bisa.
 *
 * Polling MENYALA sejak detik pertama dan berhenti hanya selama WS
 * ter-ack. `score.updated` menyala pengambilan ulang segera. Saat soket
 * putus, interval dinyalakan lagi; saat `connect` berikutnya (socket.io
 * menyambung ulang sendiri), `subscribe` DIKIRIM ULANG — ruang hilang
 * saat putus, dan itulah bagian "pulih" dari AC 1.
 */
export function buatPapanLive(cfg: ConfigPapan): PapanLive {
  const interval = cfg.intervalMs ?? INTERVAL_POLL_MS;
  let mode: ModePapan = 'polling';
  let timer: ReturnType<typeof setInterval> | undefined;
  let soket: SoketLive | undefined;

  const setMode = (m: ModePapan) => {
    mode = m;
    cfg.saatModeBerubah?.(m);
  };

  const mulaiPolling = () => {
    if (timer !== undefined) return;
    timer = setInterval(() => void cfg.ambil(), interval);
    setMode('polling');
  };

  const hentiPolling = () => {
    if (timer === undefined) return;
    clearInterval(timer);
    timer = undefined;
  };

  void cfg.ambil();
  mulaiPolling();

  try {
    soket = cfg.buatSoket?.();
  } catch {
    // Pabrik melempar = WS mustahil hari ini; polling sudah menyala dan
    // papan sudah terisi — bukan halaman galat.
    soket = undefined;
  }

  if (soket) {
    soket.on('connect', () => {
      void (async () => {
        try {
          const ack = await soket?.emitAck('subscribe', { squad_id: cfg.squadId });
          if ((ack as { ok?: boolean } | undefined)?.ok === true) {
            hentiPolling();
            setMode('langsung');
          } else {
            // Ack galat (mis. RATE_LIMITED): coba lagi lewat reconnect
            // socket.io; selama itu polling yang melayani.
            mulaiPolling();
          }
        } catch {
          // emitAck timeout/lempar — sama: polling tetap hidup.
          mulaiPolling();
        }
      })();
    });

    soket.on('disconnect', () => {
      // AC 1 bagian "putus": papan tetap benar lewat polling. socket.io
      // akan menyambung ulang sendiri; 'connect' berikutnya subscribe ulang.
      mulaiPolling();
    });

    soket.on('score.updated', (...args: unknown[]) => {
      const muatan = args[0] as { squad_id?: unknown } | undefined;
      if (muatan?.squad_id !== cfg.squadId) return;
      void cfg.ambil();
    });
  }

  return {
    mode: () => mode,
    lepas() {
      hentiPolling();
      soket?.close();
      soket = undefined;
    },
  };
}

/**
 * Soket socket.io sungguhan ke gateway RT-01: path `/api/v1/ws`, sesi dari
 * COOKIE (dengan kredensial), tanpa token di JavaScript — keputusan #154.
 *
 * `emitAck` memakai `timeout()` socket.io: `emitWithAck` server bisa
 * menggantung selamanya (jebakan terdokumentari di gateway), dan mesin
 * tidak boleh menunggu tanpa batas hanya untuk memutuskan polling.
 */
export function buatSoketSquad(baseUrl: string): SoketLive {
  const s = io(baseUrl, {
    path: '/api/v1/ws',
    withCredentials: true,
    reconnectionDelayMax: 10_000,
  });
  // ── Kebijakan coba ulang sendiri (di luar backoff socket.io) ──
  //
  // Dua keadaan yang TIDAK dipulihkan otomatis oleh socket.io (dibuktikan
  // di verifikasi browser Q-05, bukan dibaca dari dokumentasi saja):
  //
  // 1. Server memutus dengan sengaja (alasan 'io server disconnect') —
  //    gateway RT-01 melakukan persis ini saat verifikasi ulang izin,
  //    dan pemutusannya bisa jadi sementara. Klien diam; pola resminya
  //    memang `socket.connect()` manual.
  // 2. Penolakan di TINGKAT NAMESPACE (middleware handshake menolak):
  //    engine.io tetap terbuka, jadi `Manager.onclose` — satu-satunya
  //    pintu ke backoff bawaan — tidak pernah terpanggil. Satu percobaan,
  //    lalu berhenti, PADAHAL penolakan seperti ini bisa pulih (sesi
  //    divalidasi ulang, stub menyalakan WS lagi).
  //
  // Ulang tiap 5 detik; `connect()` pada soket yang sudah sehat adalah
  // no-op, jadi tumpang tindih dengan backoff bawaan tidak merusak.
  // Selama semua ini, polling 30 dtk tetap menjaga papan benar (AC 2).
  let cobaUlang: ReturnType<typeof setTimeout> | undefined;
  const jadwalUlang = () => {
    if (cobaUlang !== undefined) return;
    cobaUlang = setTimeout(() => {
      cobaUlang = undefined;
      s.connect();
    }, 5_000);
  };
  s.on('disconnect', (reason: string) => {
    if (reason === 'io server disconnect') jadwalUlang();
  });
  s.on('connect_error', () => jadwalUlang());
  s.on('connect', () => {
    if (cobaUlang !== undefined) {
      clearTimeout(cobaUlang);
      cobaUlang = undefined;
    }
  });
  return {
    on: (event, fn) => {
      s.on(event, fn);
    },
    emitAck: (event, payload) =>
      new Promise((resolve, reject) => {
        s.timeout(5_000).emit(event, payload, (err: Error | undefined, ack?: unknown) => {
          if (err) reject(err);
          else resolve(ack);
        });
      }),
    close: () => {
      if (cobaUlang !== undefined) {
        clearTimeout(cobaUlang);
        cobaUlang = undefined;
      }
      s.disconnect();
    },
  };
}
