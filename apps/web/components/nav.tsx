import Link from 'next/link';
import type { ReactNode } from 'react';

/** Navigasi sementara agar 12 rute stub benar-benar bisa diklik (F-09). */
export function Nav({
  links,
  aksi,
}: {
  links: ReadonlyArray<{ href: string; label: string }>;
  /** Slot kanan navigasi (mis. lonceng notifikasi N-02) — opsional. */
  aksi?: ReactNode;
}) {
  return (
    <nav className="border-b border-border">
      <ul className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-1 px-6 py-3 text-sm">
        {links.map((l) => (
          <li key={l.href}>
            <Link className="text-muted-foreground hover:text-foreground" href={l.href}>
              {l.label}
            </Link>
          </li>
        ))}
        {aksi ? (
          <li className="ml-auto flex items-center" data-testid="nav-aksi">
            {aksi}
          </li>
        ) : null}
      </ul>
    </nav>
  );
}
