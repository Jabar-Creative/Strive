import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Strive Academy',
  description: 'Platform belajar-karir untuk mahasiswa Indonesia.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" suppressHydrationWarning>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
