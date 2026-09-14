/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Dipakai infra/Dockerfile.web — image runtime hanya membawa yang benar-benar dipakai.
  output: 'standalone',
  // Paket workspace dikompilasi dari sumber; tidak ada langkah build terpisah.
  transpilePackages: ['@strive/ui', '@strive/contracts'],
  outputFileTracingRoot: new URL('../../', import.meta.url).pathname,
  eslint: {
    // Lint dijalankan sekali untuk SELURUH workspace lewat `pnpm lint`
    // (satu eslint.config.mjs di root — F-01). `next build` tidak perlu
    // menjalankan pass kedua yang memakai konfigurasi berbeda.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
