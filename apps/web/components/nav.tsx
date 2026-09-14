import Link from 'next/link';

/** Navigasi sementara agar 12 rute stub benar-benar bisa diklik (F-09). */
export function Nav({ links }: { links: ReadonlyArray<{ href: string; label: string }> }) {
  return (
    <nav className="border-b border-border">
      <ul className="mx-auto flex max-w-5xl flex-wrap gap-x-4 gap-y-1 px-6 py-3 text-sm">
        {links.map((l) => (
          <li key={l.href}>
            <Link className="text-muted-foreground hover:text-foreground" href={l.href}>
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
