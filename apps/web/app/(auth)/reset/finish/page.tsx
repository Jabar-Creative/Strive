'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';

import { Button } from '@strive/ui';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@strive/ui';

import { authClient } from '@/lib/auth-client';
import { registerRequestSchema } from '@strive/contracts';

/**
 * Layar reset langkah 2: password baru (A-03).
 *
 * Token datang dari tautan email: Better-Auth mengarahkan pelengkap tautan
 * ke sini dengan `?token=`. AU-2 berlaku sama seperti pendaftaran — minimal
 * 10 karakter, tanpa aturan komposisi.
 */
function FormulirReset() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [ulangi, setUlangi] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [mengirim, setMengirim] = useState(false);

  async function kirim(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Aturan panjang dari skema kontrak — bukan ditulis ulang di sini.
    const cek = registerRequestSchema.pick({ password: true }).safeParse({ password });
    if (!cek.success) {
      setError('Password minimal 10 karakter.');
      return;
    }
    if (password !== ulangi) {
      setError('Konfirmasi password tidak sama.');
      return;
    }

    setMengirim(true);
    const hasil = await authClient.resetPassword({ newPassword: password, token });
    setMengirim(false);

    if (hasil.error) {
      setError('Tautan tidak valid atau sudah kedaluwarsa. Minta tautan baru.');
      return;
    }
    router.replace('/login');
  }

  if (!token) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Tautan tidak lengkap</CardTitle>
          <CardDescription>Buka tautan dari email, atau minta yang baru.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="secondary">
            <Link href="/reset">Minta tautan baru</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">Password baru</CardTitle>
        <CardDescription>Sesi di perangkat lain akan dicabut demi keamanan.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4" noValidate onSubmit={kirim}>
          <div className="grid gap-2">
            <label className="text-sm font-medium" htmlFor="password">
              Password baru
            </label>
            <input
              autoComplete="new-password"
              className="h-10 rounded-ctl border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              id="password"
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              value={password}
            />
            <p className="text-xs text-muted-foreground">Minimal 10 karakter.</p>
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-medium" htmlFor="ulangi">
              Ulangi password
            </label>
            <input
              autoComplete="new-password"
              className="h-10 rounded-ctl border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              id="ulangi"
              onChange={(e) => setUlangi(e.target.value)}
              type="password"
              value={ulangi}
            />
          </div>

          {error && (
            <p
              className="rounded-ctl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              role="alert"
            >
              {error}
            </p>
          )}

          <Button disabled={mengirim} type="submit">
            {mengirim ? 'Menyimpan…' : 'Simpan password baru'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export default function ResetFinishPage() {
  return (
    <section className="mx-auto w-full max-w-sm px-6 py-12">
      <Suspense fallback={null}>
        <FormulirReset />
      </Suspense>
    </section>
  );
}
