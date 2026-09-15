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
 * `data-density="student"` mengaktifkan `--r-card`/`--r-ctl`/`--t-base`/
 * `--t-cel` versi Student dari app/globals.css untuk seluruh turunan
 * elemen ini (lihat komentar profil kepadatan di globals.css).
 * Proteksi rute (student vs console) adalah item A-04 milik Dev B.
 */
export default function StudentLayout({ children }: { children: React.ReactNode }) {
  return (
    <main data-density="student">
      <Nav links={LINKS} />
      {children}
    </main>
  );
}
