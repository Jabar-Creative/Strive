import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buatPapanLive, type SoketLive } from './leaderboard-live';

/**
 * Test unit mesin papan squad (Q-05) — KEDUA acceptance criteria item:
 *
 * AC 1: "Papan tetap benar saat koneksi WS putus lalu pulih."
 * AC 2: "Tanpa WS sama sekali, papan tetap terisi lewat polling."
 *
 * Soket DIINJEKSI (palsu di sini, socket.io sungguhan di layar) supaya
 * mesinya — keputusan kapan polling hidup/mati — teruji dengan timer
 * palsu, bukan dengan server sungguhan yang tidak deterministik.
 */

class SoketPalsu implements SoketLive {
  handler: Record<string, Array<(...args: unknown[]) => void>> = {};
  /** Balasan emitAck berikutnya; default sukses. */
  balasanAck: unknown = { ok: true };
  permintaanAck: Array<{ event: string; payload: unknown }> = [];
  tertutup = false;

  on(event: string, fn: (...args: unknown[]) => void): void {
    (this.handler[event] ??= []).push(fn);
  }

  async emitAck(event: string, payload: unknown): Promise<unknown> {
    this.permintaanAck.push({ event, payload });
    return this.balasanAck;
  }

  close(): void {
    this.tertutup = true;
  }

  picu(event: string, ...args: unknown[]): void {
    for (const fn of this.handler[event] ?? []) fn(...args);
  }
}

const SQUAD = 'squad-111';
const INTERVAL = 30_000;

let ambil: ReturnType<typeof vi.fn>;
let mode: string[];
let soket: SoketPalsu;
/** Instance yang BENAR-BENAR diterima manajer — direkam pabriknya. */
let soketManajer: SoketPalsu | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  ambil = vi.fn(async () => undefined);
  mode = [];
  soket = new SoketPalsu();
  soketManajer = undefined;
});

afterEach(() => {
  vi.useRealTimers();
});

function pasang() {
  return buatPapanLive({
    squadId: SQUAD,
    ambil,
    buatSoket: () => {
      soketManajer = soket;
      return soket;
    },
    intervalMs: INTERVAL,
    saatModeBerubah: (m) => mode.push(m),
  });
}

/** Flush rantai promise async handler 'connect' (emitAck → stop polling). */
async function flush() {
  await vi.advanceTimersByTimeAsync(0);
}

describe('AC 2 — tanpa WS sama sekali, papan terisi lewat polling', () => {
  it('pengambilan pertama jalan LANGSUNG, menunggu apa pun tidak', () => {
    pasang();
    expect(ambil).toHaveBeenCalledTimes(1);
  });

  it('polling tiap 30 detik terus berjalan saat WS tidak pernah tersambung', async () => {
    pasang();
    await vi.advanceTimersByTimeAsync(INTERVAL * 3);
    expect(ambil).toHaveBeenCalledTimes(4); // 1 awal + 3 tick
    expect(mode[0]).toBe('polling');
  });

  it('ack subscribe gagal (RATE_LIMITED) → tetap mode polling', async () => {
    soket.balasanAck = { ok: false, error: { code: 'RATE_LIMITED' } };
    pasang();
    soket.picu('connect');
    await flush();
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(ambil).toHaveBeenCalledTimes(2);
    expect(mode).toContain('polling');
  });
});

describe('WS hidup — polling berhenti, event yang memperbarui', () => {
  it('subscribe ack ok → mode langsung, polling BERHENTI', async () => {
    pasang();
    soket.picu('connect');
    await flush();
    expect(mode).toContain('langsung');
    await vi.advanceTimersByTimeAsync(INTERVAL * 4);
    expect(ambil).toHaveBeenCalledTimes(1); // tak ada polling lagi
  });

  it('score.updated squad ini → papan diambil ulang', async () => {
    pasang();
    soket.picu('connect');
    await flush();
    soket.picu('score.updated', { squad_id: SQUAD, user_id: 'u-1' });
    await flush();
    expect(ambil).toHaveBeenCalledTimes(2);
  });

  it('score.updated squad LAIN diabaikan', async () => {
    pasang();
    soket.picu('connect');
    await flush();
    soket.picu('score.updated', { squad_id: 'squad-lain', user_id: 'u-1' });
    await flush();
    expect(ambil).toHaveBeenCalledTimes(1);
  });

  it('subscribe mengirim squad_id yang benar', async () => {
    pasang();
    soket.picu('connect');
    await flush();
    expect(soket.permintaanAck[0]).toEqual({ event: 'subscribe', payload: { squad_id: SQUAD } });
  });
});

describe('AC 1 — putus lalu pulih', () => {
  it('disconnect → polling menyala; reconnect → subscribe ulang, polling berhenti', async () => {
    const papan = pasang();
    // WS sehat dulu.
    soket.picu('connect');
    await flush();
    expect(mode).toEqual(['polling', 'langsung']);

    // Putus: papan harus tetap benar lewat polling.
    soket.picu('disconnect', 'transport close');
    expect(mode[2]).toBe('polling');
    await vi.advanceTimersByTimeAsync(INTERVAL * 2);
    expect(ambil).toHaveBeenCalledTimes(3); // 1 awal + 2 polling

    // Pulih: socket.io memicu 'connect' lagi — ruang hilang saat putus,
    // jadi subscribe WAJIB dikirim ulang.
    soket.picu('connect');
    await flush();
    expect(mode[3]).toBe('langsung');
    expect(soket.permintaanAck).toHaveLength(2); // subscribe dua kali
    await vi.advanceTimersByTimeAsync(INTERVAL * 3);
    expect(ambil).toHaveBeenCalledTimes(3); // polling berhenti lagi
    expect(papan.mode()).toBe('langsung');
    papan.lepas();
  });

  it('sesudah pulih, score.updated tetap memperbarui papan', async () => {
    pasang();
    soket.picu('connect');
    await flush();
    soket.picu('disconnect', 'ping timeout');
    soket.picu('connect');
    await flush();
    soket.picu('score.updated', { squad_id: SQUAD, user_id: 'u-2' });
    await flush();
    expect(ambil).toHaveBeenCalledTimes(2);
  });
});

describe('pembersihan', () => {
  it('lepas(): interval berhenti dan soket yang diterima manajer ditutup', async () => {
    const papan = pasang();
    expect(soketManajer).toBe(soket); // manajer memakai instance test ini
    papan.lepas();
    expect(soketManajer?.tertutup).toBe(true);
    await vi.advanceTimersByTimeAsync(INTERVAL * 2);
    expect(ambil).toHaveBeenCalledTimes(1);
  });
});
