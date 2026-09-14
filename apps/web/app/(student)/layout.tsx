import { Nav } from '@/components/nav';

const LINKS = [
  { href: '/hub', label: 'Hub' },
  { href: '/learn', label: 'Belajar' },
  { href: '/squad', label: 'Squad' },
  { href: '/clinic', label: 'Klinik' },
  { href: '/career', label: 'Karir' },
  { href: '/mastery', label: 'Mastery' },
  { href: '/store', label: 'Store' },
  { href: '/wallet', label: 'Dompet' },
] as const;

/**
 * Layout (student) — profil kepadatan "Student" (docs/PRD.md §14.3).
 * Proteksi rute (student vs console) adalah item A-04 milik Dev B.
 */
export default function StudentLayout({ children }: { children: React.ReactNode }) {
  return (
    <main>
      <Nav links={LINKS} />
      {children}
    </main>
  );
}
