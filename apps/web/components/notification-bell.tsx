'use client';

import { useState } from 'react';

import { useNotifications } from '@/components/notification-provider';
import { labelJenis, waktuRelatif } from '@/lib/notification-bell';

/**
 * Lonceng notifikasi — N-02 (PRD §7 E16 NO-2 kanal in-app). Hanya RENDER:
 * state dan aksi datang dari NotificationProvider bersama (satu sumber untuk
 * lonceng + banner), mesin transisinya teruji di `lib/notification-bell`.
 * Tamu (`UNAUTHENTICATED`) tidak melihat lonceng sama sekali — bukan error.
 */

const KINI = () => new Date().toISOString();

export function NotificationBell() {
  const { state, tandai, muat } = useNotifications();
  const [terbuka, setTerbuka] = useState(false);

  // Tamu dan saat memuat pertama: tidak ada lonceng yang perlu dilihat.
  if (state.fase === 'tanpaSesi' || state.fase === 'memuat') return null;
  if (state.fase === 'gagal') {
    // Jaringan galat bukan alasan menyembunyikan selamanya: tampil versi
    // bisu yang bisa dicoba lagi, bukan error merah di navigasi.
    return (
      <button
        type="button"
        className="text-sm text-ink-500 hover:text-foreground"
        aria-label="Notifikasi gagal dimuat, coba lagi"
        onClick={() => muat()}
      >
        🔔?
      </button>
    );
  }

  // Kegagalan PATCH tidak butuh pesan terpisah: pemulihan NO-7 sudah
  // terlihat apa adanya — item kembali "Belum dibaca" dan lencana naik
  // kembali. Layar tidak pernah berbohong, dan itu cukup.
  const klikItem = (id: string) => tandai(id);

  return (
    <div className="relative">
      <button
        type="button"
        className="rounded-ctl border border-line px-2 py-1 text-sm hover:bg-line"
        aria-expanded={terbuka}
        aria-haspopup="dialog"
        aria-label={
          state.belumDibaca > 0 ? `Notifikasi, ${state.belumDibaca} belum dibaca` : 'Notifikasi'
        }
        onClick={() => setTerbuka((v) => !v)}
        data-testid="tombol-lonceng"
      >
        🔔
        {state.belumDibaca > 0 ? (
          <span
            className="ml-1 rounded-full bg-primary px-1.5 font-mono text-label tabular-nums text-primary-foreground"
            data-testid="lencana-belum-dibaca"
          >
            {state.belumDibaca > 99 ? '99+' : state.belumDibaca}
          </span>
        ) : null}
      </button>

      {terbuka ? (
        <div
          role="dialog"
          aria-label="Daftar notifikasi"
          className="absolute right-0 z-10 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-card border border-line bg-background p-2 shadow-lg"
          data-testid="panel-notifikasi"
        >
          {state.notifikasi.length === 0 ? (
            <p className="px-2 py-3 text-sm text-ink-500">
              Belum ada notifikasi. Selesaikan lesson pertamamu untuk memulai.
            </p>
          ) : (
            <ul className="flex max-h-80 flex-col gap-1 overflow-y-auto">
              {state.notifikasi.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    className="w-full rounded-ctl px-2 py-2 text-left hover:bg-line disabled:opacity-60"
                    onClick={() => klikItem(n.id)}
                    disabled={n.read_at !== null || state.sedangDitandai.includes(n.id)}
                    data-testid={`notifikasi-${n.id}`}
                    data-belum-dibaca={n.read_at === null}
                  >
                    <span className="text-label text-ink-500">{labelJenis[n.kind]}</span>
                    <span className="block font-medium">{n.title}</span>
                    <span className="block text-sm text-ink-500">{n.body}</span>
                    <span className="block text-label text-ink-500">
                      {n.read_at === null
                        ? 'Belum dibaca'
                        : `Dibaca ${waktuRelatif(n.read_at, KINI())}`}
                      {' · '}
                      {waktuRelatif(n.created_at, KINI())}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
