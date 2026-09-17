import { describe, expect, it } from 'vitest';

import { validateLogin, validateRegister } from './auth-forms';

/**
 * Test unit untuk validasi form auth (A-03).
 *
 * Yang diuji di sini hanyalah glue code milik kita — pemetaan issue zod ke
 * pesan per field. Aturan bisnisnya sendiri (AU-2: minimal 10 karakter tanpa
 * aturan komposisi) hidup di skema `@strive/contracts` milik F-08 dan sudah
 * punya test-nya sendiri di sana; mengulang isinya di sini hanya membuat dua
 * tempat yang bisa saling berbohong.
 */
describe('validateLogin', () => {
  it('input valid menghasilkan nol error', () => {
    expect(validateLogin({ email: 'a@b.com', password: 'kataSandiPanjang123' })).toEqual({});
  });

  it('password kosong ditolak dengan pesan wajib isi', () => {
    const errors = validateLogin({ email: 'a@b.com', password: '' });
    expect(errors['password']).toBe('Password wajib diisi');
  });

  it('email tidak valid ditolak di field email, bukan di tempat lain', () => {
    const errors = validateLogin({ email: 'bukan-email', password: 'kataSandiPanjang123' });
    expect(Object.keys(errors)).toEqual(['email']);
  });
});

describe('validateRegister', () => {
  const valid = {
    display_name: 'Aika',
    email: 'a@b.com',
    password: 'kataSandiPanjang123',
    password_confirm: 'kataSandiPanjang123',
  };

  it('input valid menghasilkan nol error', () => {
    expect(validateRegister(valid)).toEqual({});
  });

  it('AU-2: password 9 karakter ditolak dengan pesan panjang minimal', () => {
    const errors = validateRegister({
      ...valid,
      password: 'sembilan1',
      password_confirm: 'sembilan1',
    });
    expect(errors['password']).toBe('Password minimal 10 karakter');
  });

  it('AU-2: password 10 karakter sederhana diterima — tidak ada aturan komposisi', () => {
    expect(
      validateRegister({ ...valid, password: 'angonkucing', password_confirm: 'angonkucing' }),
    ).toEqual({});
  });

  it('konfirmasi password yang beda ditolak', () => {
    const errors = validateRegister({ ...valid, password_confirm: 'bedaSekali123' });
    expect(errors['password_confirm']).toBeTruthy();
  });

  it('display_name kosong ditolak', () => {
    const errors = validateRegister({ ...valid, display_name: '' });
    expect(errors['display_name']).toBeTruthy();
  });
});
