import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Helper standar shadcn/ui untuk menggabungkan className.
 *
 * Duplikat sengaja dari `apps/web/lib/utils.ts` — `packages/ui` tidak boleh
 * bergantung pada alias `@/` milik apps/web (alias itu di-scope per app di
 * tsconfig masing-masing, tidak resolve dari dalam workspace package). Kalau
 * implementasinya berubah, ubah juga pasangannya di apps/web/lib/utils.ts.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
