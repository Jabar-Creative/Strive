'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

import { Button } from '@strive/ui';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@strive/ui';

import { authClient } from '@/lib/auth-client';

/**
 * Layar verifikasi email (A-03). AU-8: verifikasi TIDAK memblokir belajar,
 * hanya memblokir top-up — jadi layar ini memaparkan manfaat, bukan ancaman.
 *
 * Token datang dari tautan email (?token=). Sampai callback
 * `sendVerificationEmail` terpasang di config auth (isu untuk Dev A),
 * pengguna tidak akan menerima email; tombol kirim ulang tetap ada dan
 * menampilkan kegagalannya secara jujur.
 */
function IsiVerifikasi() {
  const params = useSearchParams();
  const token = params.get('token') ?? '';
  // Endpoint kirim-ulang meminta email secara eksplisit; ambil dari sesi —
  // verifikasi memang ditujukan bagi pengguna yang sudah punya akun.
  const { data: sesi } = authClient.useSession();

  const [status, setStatus] = useState<'memeriksa' | 'berhasil' | 'gagal' | 'menunggu'>(
    token ? 'memeriksa' : 'menunggu',
  );
  const [pesanKirim, setPesanKirim] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let hidup = true;
    (async () => {
      const hasil = await authClient.verifyEmail({ query: { token } });
      if (!hidup) return;
      setStatus(hasil.error ? 'gagal' : 'berhasil');
    })();
    return () => {
      hidup = false;
    };
  }, [token]);

  async function kirimUlang() {
    if (!sesi?.user.email) return;
    setPesanKirim(null);
    const hasil = await authClient.sendVerificationEmail({
      email: sesi.user.email,
      callbackURL: `${window.location.origin}/verify`,
    });
    setPesanKirim(
      hasil.error
        ? 'Pengiriman email verifikasi belum diaktifkan. Coba lagi nanti.'
        : 'Kalau email itu terdaftar, tautan verifikasi sudah dikirim.',
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">Verifikasi email</CardTitle>
        <CardDescription>
          Verifikasi membuka top-up Strive Coins. Belajar dan streak tetap bisa tanpa verifikasi.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {status === 'memeriksa' && (
          <p className="text-sm text-muted-foreground">Memeriksa tautan…</p>
        )}

        {status === 'berhasil' && (
          <p
            className="rounded-ctl border border-success/40 bg-success/10 px-3 py-2 text-sm"
            role="status"
          >
            Email terverifikasi. Selamat belajar!
          </p>
        )}

        {status === 'gagal' && (
          <p
            className="rounded-ctl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            role="alert"
          >
            Tautan tidak valid atau sudah kedaluwarsa.
          </p>
        )}

        {status === 'menunggu' && (
          <p className="text-sm text-muted-foreground">
            Buka tautan verifikasi dari email, atau minta yang baru di bawah.
          </p>
        )}

        {pesanKirim && <p className="text-sm text-muted-foreground">{pesanKirim}</p>}

        <div className="flex flex-wrap gap-2">
          {sesi && (status === 'gagal' || status === 'menunggu') && (
            <Button onClick={kirimUlang} variant="secondary">
              Kirim ulang email
            </Button>
          )}
          <Button asChild variant="ghost">
            <Link href="/hub">Ke Hub</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function VerifyPage() {
  return (
    <section className="mx-auto w-full max-w-sm px-6 py-12">
      <Suspense fallback={null}>
        <IsiVerifikasi />
      </Suspense>
    </section>
  );
}
