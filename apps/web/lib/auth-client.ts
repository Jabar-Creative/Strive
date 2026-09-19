'use client';

import { createAuthClient } from 'better-auth/react';

/**
 * Client Better-Auth untuk web (A-03).
 *
 * Sesi disimpan sebagai cookie httpOnly oleh API — browser yang menyimpannya,
 * bukan JavaScript. Itu sebabnya file ini TIDAK memegang token apa pun:
 * "penyimpanan sesi client" ditegakkan oleh cookie, dan refresh halaman tidak
 * melempar keluar karena cookie ikut terkirim ulang (AC A-03).
 *
 * Perpanjangan senyap: `refetchOnWindowFocus` bawaan membuat klien mengambil
 * ulang sesi saat tab kembali aktif; server memperbarui `expires_at` paling
 * sering sekali sehari (updateAge). Tidak ada JWT, tidak ada rotasi — PRD
 * §7 E1 AU-4 (isu #18).
 */
export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001',
  basePath: '/api/v1/auth',
});
