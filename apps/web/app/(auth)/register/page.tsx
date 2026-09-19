'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Button } from '@strive/ui';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@strive/ui';

import { authClient } from '@/lib/auth-client';
import { validateRegister, type RegisterErrors } from '@/lib/auth-forms';

/**
 * Layar daftar (A-03). AU-1: email + password. AU-2: minimal 10 karakter
 * TANPA aturan komposisi — jangan tambah "wajib huruf besar" di sini; itu
 * keputusan produk yang terkunci (PRD §7 E1).
 *
 * Zona waktu TIDAK dikumpulkan di form: Better-Auth belum dikonfigurasi
 * additionalFields untuk menerimanya (isu untuk Dev A), dan menampilkan field
 * yang diam-diam dibuang server adalah UI yang berbohong. Sampai isunya
 * selesai, pendaftar baru memakai default Q8: Asia/Jakarta.
 */
export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    display_name: '',
    email: '',
    password: '',
    password_confirm: '',
  });
  const [errors, setErrors] = useState<RegisterErrors>({});
  const [gagal, setGagal] = useState<string | null>(null);
  const [mengirim, setMengirim] = useState(false);

  const { data: sesi } = authClient.useSession();
  useEffect(() => {
    if (sesi) router.replace('/hub');
  }, [sesi, router]);

  function ubah(field: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  async function kirim(e: React.FormEvent) {
    e.preventDefault();
    setGagal(null);
    const errors = validateRegister(form);
    setErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setMengirim(true);
    const hasil = await authClient.signUp.email({
      email: form.email,
      password: form.password,
      name: form.display_name,
    });
    setMengirim(false);
    if (hasil.error) {
      setGagal(pesanGagal(hasil.error.code ?? null));
      return;
    }
    router.replace('/hub');
  }

  const inputClass =
    'h-10 rounded-ctl border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

  return (
    <section className="mx-auto w-full max-w-sm px-6 py-12">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Daftar</CardTitle>
          <CardDescription>Gratis. Streak dimulai hari ini.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4" noValidate onSubmit={kirim}>
            <div className="grid gap-2">
              <label className="text-sm font-medium" htmlFor="display_name">
                Nama tampilan
              </label>
              <input
                autoComplete="name"
                className={inputClass}
                id="display_name"
                onChange={ubah('display_name')}
                value={form.display_name}
              />
              {errors['display_name'] && (
                <p className="text-sm text-destructive">{errors['display_name']}</p>
              )}
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-medium" htmlFor="email">
                Email
              </label>
              <input
                autoComplete="email"
                className={inputClass}
                id="email"
                onChange={ubah('email')}
                type="email"
                value={form.email}
              />
              {errors['email'] && <p className="text-sm text-destructive">{errors['email']}</p>}
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-medium" htmlFor="password">
                Password
              </label>
              <input
                autoComplete="new-password"
                className={inputClass}
                id="password"
                onChange={ubah('password')}
                type="password"
                value={form.password}
              />
              {errors['password'] && (
                <p className="text-sm text-destructive">{errors['password']}</p>
              )}
              <p className="text-xs text-muted-foreground">Minimal 10 karakter.</p>
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-medium" htmlFor="password_confirm">
                Ulangi password
              </label>
              <input
                autoComplete="new-password"
                className={inputClass}
                id="password_confirm"
                onChange={ubah('password_confirm')}
                type="password"
                value={form.password_confirm}
              />
              {errors['password_confirm'] && (
                <p className="text-sm text-destructive">{errors['password_confirm']}</p>
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
              {mengirim ? 'Membuat akun…' : 'Daftar'}
            </Button>

            <p className="text-center text-sm text-muted-foreground">
              Sudah punya akun?{' '}
              <Link
                className="font-medium text-primary underline-offset-4 hover:underline"
                href="/login"
              >
                Masuk
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </section>
  );
}

function pesanGagal(code: string | null): string {
  if (code === 'USER_ALREADY_EXISTS' || code === 'USER_EXISTS') {
    return 'Email ini sudah terdaftar. Masuk, atau reset password kalau lupa.';
  }
  if (code === 'WEAK_PASSWORD') {
    return 'Password minimal 10 karakter.';
  }
  return 'Gagal mendaftar. Coba lagi sebentar.';
}
