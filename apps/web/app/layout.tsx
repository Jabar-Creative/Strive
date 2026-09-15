import type { Metadata } from 'next';
import { Bricolage_Grotesque, JetBrains_Mono, Plus_Jakarta_Sans } from 'next/font/google';
import './globals.css';

// Tiga peran font Strive — docs/PRD.md §14.2. Dimuat lewat next/font/google
// supaya file font di-self-host oleh Next.js (tidak ada request ke Google
// saat runtime, aman untuk CSP) dan tanpa layout shift (`display: 'swap'`
// + metrik fallback otomatis dari next/font). `weight: 'variable'` dipakai
// karena ketiganya font variable di Google Fonts: satu file mencakup seluruh
// bobot yang dibutuhkan lintas peran tipografi (400–800), jadi tidak perlu
// memuat beberapa file statis per bobot.
//
// Diekspos sebagai CSS variable lalu dipetakan ke theme.extend.fontFamily
// di tailwind.config.ts — dipakai lewat kelas `font-display`/`font-body`/
// `font-mono`, bukan langsung className dari next/font, supaya konsisten
// dengan cara Tailwind lain di proyek ini memakai token.
const fontDisplay = Bricolage_Grotesque({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
  weight: 'variable',
});

const fontBody = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
  weight: 'variable',
});

const fontMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
  weight: 'variable',
});

export const metadata: Metadata = {
  title: 'Strive Academy',
  description: 'Platform belajar-karir untuk mahasiswa Indonesia.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="id"
      suppressHydrationWarning
      className={`${fontDisplay.variable} ${fontBody.variable} ${fontMono.variable}`}
    >
      {/*
        `font-body text-body` di sini HANYA mengatur tipografi default
        (peran "Body" — PRD §14.2), bukan warna. Latar/warna teks default
        (bg-background/text-foreground, slate shadcn) sengaja TIDAK diganti
        ke token Strive (paper/ink-900) di sesi ini — itu akan mengubah
        tampilan seluruh layar stub yang ada secara diam-diam, padahal
        page-stub.tsx eksplisit "sengaja tanpa warna token" sampai F-07.
        Token warna Strive sudah tersedia dan terbukti di /_specimen;
        pemasangannya ke document root lebih tepat dilakukan bersamaan F-07.
      */}
      <body className="min-h-screen font-body text-body antialiased">{children}</body>
    </html>
  );
}
