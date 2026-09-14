import { Nav } from '@/components/nav';

const LINKS = [
  { href: '/mentor', label: 'Antrean validasi' },
  { href: '/admin', label: 'Superadmin' },
] as const;

/**
 * Layout (console) — profil kepadatan "Console": radius 8px, tanpa maskot,
 * tanpa animasi perayaan (docs/PRD.md §14.3).
 * Mentor dan Superadmin adalah DUA peran berbeda: guard memeriksa peran yang
 * tepat, bukan "minimal" — docs/PRD.md §2.3.
 */
export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <main>
      <Nav links={LINKS} />
      {children}
    </main>
  );
}
