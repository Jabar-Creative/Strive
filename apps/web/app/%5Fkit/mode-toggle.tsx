'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * Toggle mode terang/gelap LOKAL untuk halaman ini saja — pola sama persis
 * dengan `apps/web/app/%5Fspecimen/mode-preview.tsx` (F-06): `.dark` dipasang
 * di wrapper lokal, bukan `document.documentElement`, supaya berpindah
 * halaman lain tidak diam-diam mengubah mode gelap seluruh aplikasi.
 */
export function ModeToggle({ children }: { children: React.ReactNode }) {
  const [isDark, setIsDark] = useState(false);

  return (
    <div className="space-y-6">
      <button
        type="button"
        aria-pressed={isDark}
        onClick={() => setIsDark((prev) => !prev)}
        className="rounded-ctl border border-line bg-surface px-4 py-2 font-mono text-label uppercase text-ink-900 transition-colors duration-base ease-base hover:border-indigo-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
      >
        {isDark ? 'Mode gelap aktif — beralih ke terang' : 'Mode terang aktif — beralih ke gelap'}
      </button>
      <div
        className={cn('space-y-10 rounded-card border border-line bg-paper p-6', isDark && 'dark')}
      >
        {children}
      </div>
    </div>
  );
}
