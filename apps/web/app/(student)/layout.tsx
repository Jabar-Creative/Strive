import { Nav } from '@/components/nav';
import { NotificationBell } from '@/components/notification-bell';
import { NotificationProvider } from '@/components/notification-provider';

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
      {/* Provider notifikasi membungkus Nav (lonceng) DAN children (banner
          streak di Hub) — satu state untuk keduanya, N-02. */}
      <NotificationProvider>
        <Nav links={LINKS} aksi={<NotificationBell />} />
        {children}
      </NotificationProvider>
    </main>
  );
}
