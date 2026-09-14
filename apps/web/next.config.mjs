import { fileURLToPath } from 'node:url';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // `standalone` HANYA saat build Docker — keputusan 2 dari review PR #3 (R6).
  //
  // Satu-satunya yang memakainya adalah infra/Dockerfile.web, dan itu berjalan
  // di Linux. Mengaktifkannya di build biasa menuntut Next.js menelusuri
  // seluruh pohon workspace, dan di situlah R6 muncul: outputFileTracingRoot
  // ditulis dari `new URL(...).pathname`, yang mengembalikan pathname URL —
  // bukan path filesystem. Di path yang mengandung spasi, `%20` tidak pernah
  // ter-decode, dan Next.js menulis pohon standalone ke tempat yang salah:
  //
  //   pathname      /C:/Users/Nama%20Ada%20Spasi/projects/strive/
  //   fileURLToPath C:\Users\Nama Ada Spasi\projects\strive\
  //
  // Itu bukan bug khusus Windows — path macOS/Linux yang mengandung spasi
  // rusak dengan cara yang sama. Windows cuma yang pertama menabraknya.
  //
  // Jalan yang TIDAK diambil: memperbaiki outputFileTracingRoot dengan
  // fileURLToPath. Perbaikannya benar, tapi menargetkan tempat yang benar
  // membuat pnpm harus membuat symlink, dan Windows menolaknya tanpa Developer
  // Mode — menukar bug yang diam dengan gate `pnpm build` yang MERAH untuk
  // Dev B. Yang diambil: matikan `standalone` di luar Docker, jadi tidak ada
  // penelusuran workspace sama sekali dan tidak ada path yang perlu ditebak.
  ...(process.env['DOCKER_BUILD'] === '1'
    ? {
        output: 'standalone',
        outputFileTracingRoot: fileURLToPath(new URL('../../', import.meta.url)),
      }
    : {}),

  // Paket workspace dikompilasi dari sumber; tidak ada langkah build terpisah.
  transpilePackages: ['@strive/ui', '@strive/contracts'],
  eslint: {
    // Lint dijalankan sekali untuk SELURUH workspace lewat `pnpm lint`
    // (satu eslint.config.mjs di root — F-01). `next build` tidak perlu
    // menjalankan pass kedua yang memakai konfigurasi berbeda.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
