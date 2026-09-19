import { loginRequestSchema, registerRequestSchema } from '@strive/contracts';

/**
 * Validasi form auth di sisi klien (A-03).
 *
 * Skema zod-nya milik `@strive/contracts` (F-08) — SATU definisi untuk dua
 * sisi. Yang hidup di sini hanya pemetaannya: issue zod menjadi pesan per
 * field yang dirender form. Server tetap memvalidasi ulang; validasi ini
 * untuk umpan balik cepat, bukan gerbang kebenaran (PRD §10.1).
 */

export interface LoginInput {
  email: string;
  password: string;
}

export interface RegisterInput {
  display_name: string;
  email: string;
  password: string;
  password_confirm: string;
}

/** Nama field yang diketahui form — field lain diabaikan pesannya. */
type LoginField = keyof LoginInput;
type RegisterField = 'display_name' | 'email' | 'password' | 'password_confirm';

export type LoginErrors = Partial<Record<LoginField, string>>;
export type RegisterErrors = Partial<Record<RegisterField, string>>;

/** Ambil pesan issue pertama untuk tiap field — issue kedua field yang sama tidak menambah apa pun. */
function pesanPerField(
  issues: readonly { path: (string | number)[]; message: string }[],
): Map<string, string> {
  const perField = new Map<string, string>();
  for (const issue of issues) {
    const field = String(issue.path[0] ?? '');
    if (field && !perField.has(field)) perField.set(field, issue.message);
  }
  return perField;
}

export function validateLogin(input: LoginInput): LoginErrors {
  const hasil = loginRequestSchema.safeParse(input);
  if (hasil.success) return {};
  return Object.fromEntries(pesanPerField(hasil.error.issues));
}

export function validateRegister(input: RegisterInput): RegisterErrors {
  const errors: RegisterErrors = {};

  // Konfirmasi dicek SEBELUM skema: skema tidak mengenal field ini, dan
  // pesannya lebih berguna daripada dua field password yang masing-masing valid.
  if (input.password !== input.password_confirm) {
    errors['password_confirm'] = 'Konfirmasi password tidak sama';
  }

  const hasil = registerRequestSchema.safeParse({
    display_name: input.display_name,
    email: input.email,
    password: input.password,
  });
  if (!hasil.success) {
    Object.assign(errors, Object.fromEntries(pesanPerField(hasil.error.issues)));
  }

  return errors;
}
