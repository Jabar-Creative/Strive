'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Button } from '@strive/ui';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@strive/ui';

import { authClient } from '@/lib/auth-client';
import { validateLogin, type LoginErrors } from '@/lib/auth-forms';

/**
 * Layar masuk (A-03). PRD §7 E1 + §10.3.
 *
 * Sesi berupa cookie httpOnly: setelah berhasil, TIDAK ada token yang perlu
 * disimpan JavaScript — reload halaman tetap terautentikasi (AC A-03).
 */
export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<LoginErrors>({});
  const [gagal, setGagal] = useState<string | null>(null);
  const [mengirim, setMengirim] = useState(false);

  // Sudah punya sesi? Layar masuk tidak untuk dia — AC "refresh halaman tidak
  // melempar keluar": pengguna yang sudah masuk DIARAHKAN ke depan, bukan
  // diminta kredensial ulang.
  const { data: sesi } = authClient.useSession();
  useEffect(() => {
    if (sesi) router.replace('/hub');
  }, [sesi, router]);

  async function kirim(e: React.FormEvent) {
    e.preventDefault();
    setGagal(null);
    const errors = validateLogin({ email, password });
    setErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setMengirim(true);
    // Cabang pada `code`, bukan `message` — kode adalah kontrak (PRD §10.1).
    const hasil = await authClient.signIn.email({ email, password });
    setMengirim(false);
    if (hasil.error) {
      setGagal(pesanGagal(hasil.error.code ?? null));
      return;
    }
    router.replace('/hub');
  }

  return (
    <section className="mx-auto w-full max-w-sm px-6 py-12">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Masuk</CardTitle>
          <CardDescription>Lanjutkan streak dan misi harianmu.</CardDescription>
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
              {errors['email'] && <p className="text-sm text-destructive">{errors['email']}</p>}
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-medium" htmlFor="password">
                Password
              </label>
              <input
                autoComplete="current-password"
                className="h-10 rounded-ctl border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                id="password"
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                value={password}
              />
              {errors['password'] && (
                <p className="text-sm text-destructive">{errors['password']}</p>
              )}
            </div>

            {gagal && (
              <p
                className="rounded-ctl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                role="alert"
              >
                {gagal}
              </p>
            )}

            <Button disabled={mengirim} type="submit">
              {mengirim ? 'Memeriksa…' : 'Masuk'}
            </Button>

            <p className="text-center text-sm text-muted-foreground">
              Belum punya akun?{' '}
              <Link
                className="font-medium text-primary underline-offset-4 hover:underline"
                href="/register"
              >
                Daftar
              </Link>
            </p>
            <p className="text-center text-sm text-muted-foreground">
              <Link className="underline-offset-4 hover:underline" href="/reset">
                Lupa password?
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </section>
  );
}

/** Peta kode error kontrak → bahasa manusia. `message` server tidak dipakai. */
function pesanGagal(code: string | null): string {
  if (code === 'INVALID_EMAIL_OR_PASSWORD' || code === 'INVALID_PASSWORD') {
    return 'Email atau password salah.';
  }
  if (code === 'EMAIL_NOT_VERIFIED') {
    return 'Email belum diverifikasi. Cek kotak masukmu atau buka /verify.';
  }
  return 'Gagal masuk. Coba lagi sebentar.';
}
