'use client';

import Link from 'next/link';
import { useState } from 'react';

import { Button } from '@strive/ui';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@strive/ui';

import { authClient } from '@/lib/auth-client';

/**
 * Layar reset langkah 1: minta tautan (A-03).
 *
 * Status pengiriman TIDAK membocorkan ada-tidaknya email (anti-enumeration).
 * Sampai callback `sendResetPassword` terpasang di config auth (isu untuk
 * Dev A), endpoint menjawab RESET_PASSWORD_DISABLED — pesannya mengatakan
 * apa adanya bahwa fitur belum aktif, bukan pura-pura berhasil.
 */
export default function ResetPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [mengirim, setMengirim] = useState(false);

  async function kirim(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setStatus(null);
    if (!email.includes('@')) {
      setError('Masukkan alamat email yang valid.');
      return;
    }

    setMengirim(true);
    const hasil = await authClient.requestPasswordReset({
      email,
      redirectTo: `${window.location.origin}/reset/finish`,
    });
    setMengirim(false);

    if (hasil.error) {
      if (hasil.error.code === 'RESET_PASSWORD_DISABLED') {
        setError(
          'Pengaturan ulang password lewat email belum diaktifkan. Hubungi admin bila terkunci.',
        );
      } else {
        setError('Gagal meminta tautan. Coba lagi sebentar.');
      }
      return;
    }
    setStatus('Kalau email itu terdaftar, tautan pengaturan ulang sudah dikirim.');
  }

  return (
    <section className="mx-auto w-full max-w-sm px-6 py-12">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Lupa password</CardTitle>
          <CardDescription>Kami kirim tautan pengaturan ulang ke emailmu.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4" noValidate onSubmit={kirim}>
            <div className="grid gap-2">
              <label className="text-sm font-medium" htmlFor="email">
                Email
              </label>
              <input
                autoComplete="email"
                className="h-10 rounded-ctl border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                id="email"
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                value={email}
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
            {status && (
              <p
                className="rounded-ctl border border-success/40 bg-success/10 px-3 py-2 text-sm text-foreground"
                role="status"
              >
                {status}
              </p>
            )}

            <Button disabled={mengirim} type="submit">
              {mengirim ? 'Mengirim…' : 'Kirim tautan'}
            </Button>

            <p className="text-center text-sm text-muted-foreground">
              <Link className="underline-offset-4 hover:underline" href="/login">
                Kembali ke layar masuk
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </section>
  );
}
