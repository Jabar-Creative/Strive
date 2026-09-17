import { SetMetadata } from '@nestjs/common';

export type UserRole = 'student' | 'mentor' | 'superadmin';

export const ROLES_KEY = 'strive:roles';

/**
 * Menandai peran yang BOLEH masuk sebuah rute.
 *
 * Daftarnya eksplisit, bukan "minimal peran X". Tidak ada urutan peran di
 * produk ini: superadmin bukan mentor tingkat lanjut, dan mentor bukan student
 * tingkat lanjut. Begitu guard menulis `role >= required`, panel admin berubah
 * jadi pintu belakang ke seluruh rute student — dan itu persis yang PRD §2.4
 * larang.
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
