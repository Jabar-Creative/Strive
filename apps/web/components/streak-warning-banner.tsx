'use client';

import { useNotifications } from '@/components/notification-provider';
import { peringatanStreakTerbaru } from '@/lib/notification-bell';

/**
 * Banner peringatan streak di Hub — N-02. Sumbernya notifikasi
 * `streak_warning` belum dibaca yang TERBARU (dibuat scheduler S-04 pukul
 * 20.00 zona waktu pengguna). Menutup banner = menandai dibaca lewat STATE
 * BERSAMA (NotificationProvider): lencana lonceng ikut turun di saat yang
 * sama, dan kalau PATCH gagal keduanya pulih bersama (NO-7) — banner
 * muncul kembali apa adanya, bukan menghilang diam-diam.
 */
export function StreakWarningBanner() {
  const { state, tandai } = useNotifications();

  // Banner bukan konten wajib Hub: saat memuat/tamu/galat jaringan ia cukup
  // tidak tampil — tidak boleh menjatuhkan layar.
  const peringatan = state.fase === 'siap' ? peringatanStreakTerbaru(state) : null;
  if (!peringatan) return null;

  return (
    <section
      className="rounded-card border border-line bg-background p-4"
      role="status"
      data-testid="banner-streak"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium">{peringatan.title}</p>
          <p className="mt-1 text-sm text-ink-500">{peringatan.body}</p>
        </div>
        <button
          type="button"
          className="rounded-ctl border border-line px-2 py-1 text-sm hover:bg-line"
          onClick={() => tandai(peringatan.id)}
          aria-label="Tutup peringatan streak"
          data-testid="tutup-banner-streak"
        >
          Mengerti
        </button>
      </div>
    </section>
  );
}
