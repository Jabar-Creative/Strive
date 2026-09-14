import Link from 'next/link';

const ROUTES = [
  {
    group: '(auth)',
    items: [
      { href: '/login', label: 'Masuk' },
      { href: '/register', label: 'Daftar' },
      { href: '/reset', label: 'Reset password' },
      { href: '/verify', label: 'Verifikasi email' },
    ],
  },
  {
    group: '(student)',
    items: [
      { href: '/hub', label: 'Hub' },
      { href: '/learn', label: 'Belajar' },
      { href: '/squad', label: 'Squad' },
      { href: '/clinic', label: 'Klinik' },
      { href: '/career', label: 'Karir' },
      { href: '/mastery', label: 'Mastery' },
      { href: '/store', label: 'Store' },
      { href: '/wallet', label: 'Dompet' },
    ],
  },
  {
    group: '(console)',
    items: [
      { href: '/mentor', label: 'Konsol mentor' },
      { href: '/admin', label: 'Konsol superadmin' },
    ],
  },
] as const;

export default function IndexPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <p className="text-xs uppercase tracking-widest text-muted-foreground">Strive Academy</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">Peta rute</h1>
      <p className="mt-4 text-sm text-muted-foreground">
        Dua belas layar inti (item <code>F-09</code>) plus dua konsol. Semuanya masih placeholder —
        belum ada satu pun fitur bisnis.
      </p>

      {ROUTES.map((g) => (
        <div key={g.group} className="mt-8">
          <h2 className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            {g.group}
          </h2>
          <ul className="mt-2 space-y-1">
            {g.items.map((r) => (
              <li key={r.href}>
                <Link className="underline underline-offset-4" href={r.href}>
                  {r.href}
                </Link>{' '}
                <span className="text-muted-foreground">— {r.label}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </main>
  );
}
