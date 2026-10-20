'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { ApiError, createApiClient } from '@/lib/api-client';
import {
  bellGagal,
  bellTiba,
  dibacaBerhasil,
  dibacaGagal,
  mulaiBell,
  tandaiDibaca,
  type NotificationBellState,
} from '@/lib/notification-bell';

/**
 * Satu sumber kebenaran notifikasi untuk SELURUH layar student — N-02.
 *
 * Lonceng di navigasi dan banner peringatan streak hidup di subtree React
 * yang berbeda; tanpa context, keduanya meng-fetch sendiri dan saling
 * melenceng: menutup banner (menandai dibaca) tidak menggeser lencana
 * lonceng, dan sebaliknya. Kegagalan itu BUKAN hipotesis — ketemu persis
 * begitu saat verifikasi browser pertama.
 *
 * Mesin transisi tetap di `lib/notification-bell` (murni, teruji unit);
 * provider hanya menyimpan state, fetch, dan memanggil transisi.
 */

function useNotifier() {
  const api = useMemo(
    () => createApiClient({ baseUrl: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001' }),
    [],
  );

  const [state, setState] = useState<NotificationBellState>(mulaiBell);

  const muat = useCallback(
    (sinyal?: AbortSignal) => {
      api
        .listNotifications({ limit: 20 }, { signal: sinyal })
        .then((res) => setState(bellTiba(res)))
        .catch((e: unknown) => {
          if (e instanceof DOMException && e.name === 'AbortError') return;
          setState(bellGagal(e instanceof ApiError ? e.code : 'NETWORK'));
        });
    },
    [api],
  );

  useEffect(() => {
    const batal = new AbortController();
    muat(batal.signal);
    return () => batal.abort();
  }, [muat]);

  // Lencana harus jujur saat pengguna kembali ke tab — pola L-05/S-03.
  useEffect(() => {
    const ulang = () => {
      if (document.visibilityState === 'visible') muat();
    };
    window.addEventListener('focus', ulang);
    document.addEventListener('visibilitychange', ulang);
    return () => {
      window.removeEventListener('focus', ulang);
      document.removeEventListener('visibilitychange', ulang);
    };
  }, [muat]);

  const tandai = useCallback(
    (id: string) => {
      // Optimistik dulu (NO-7); PATCH menyusul; gagal → pulihkan.
      setState((s) => tandaiDibaca(s, id, new Date().toISOString()));
      api
        .markNotificationRead(id)
        .then((res) => setState((s) => dibacaBerhasil(s, id, res.read_at)))
        .catch(() => setState((s) => dibacaGagal(s, id)));
    },
    [api],
  );

  return { state, muat, tandai };
}

const NotifikasiKonteks = createContext<ReturnType<typeof useNotifier> | null>(null);

export function NotificationProvider({ children }: { children: ReactNode }) {
  const nilai = useNotifier();
  return <NotifikasiKonteks.Provider value={nilai}>{children}</NotifikasiKonteks.Provider>;
}

/** State + aksi notifikasi bersama. Wajib dipakai di bawah NotificationProvider. */
export function useNotifications() {
  const nilai = useContext(NotifikasiKonteks);
  if (!nilai) {
    throw new Error(
      'useNotifications tanpa NotificationProvider — lonceng/banner harus di dalam (student).',
    );
  }
  return nilai;
}
