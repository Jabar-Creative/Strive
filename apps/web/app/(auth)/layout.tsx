import { Nav } from '@/components/nav';

const LINKS = [
  { href: '/login', label: 'Masuk' },
  { href: '/register', label: 'Daftar' },
  { href: '/reset', label: 'Reset' },
  { href: '/verify', label: 'Verifikasi' },
] as const;

/** Layout (auth). Tanpa shell aplikasi — layar publik. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main>
      <Nav links={LINKS} />
      {children}
    </main>
  );
}
