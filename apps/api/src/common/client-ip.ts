import { isIP } from 'node:net';

/**
 * Alamat klien di belakang reverse proxy — satu aturan untuk pembatas Nest
 * dan untuk Better-Auth.
 *
 * `TRUST_PROXY_HOPS` adalah jumlah proxy milik kita. Dihitung dari KANAN:
 * proxy menambahkan alamat yang dilihatnya di ujung kanan, dan entri di
 * kirinya boleh dikirim klien. `1` berarti entri paling kanan adalah alamat
 * yang ditulis proxy itu. `0` mengabaikan header sama sekali.
 *
 * Better-Auth 1.7.5 (`getIP` di `@better-auth/core`) tidak mengenal jumlah
 * hop. Tanpa `advanced.ipAddress.trustedProxies`, header berantai (lebih
 * dari satu entri) dianggap tidak tepercaya dan pembatasnya jatuh ke SATU
 * ember per path untuk semua pengguna. `trustedProxies` berjalan dengan
 * mencocokkan CIDR proxy, bukan jumlah hop — dan daftar IP edge Railway
 * tidak kita pegang. Karena itu rantai tidak diserahkan apa adanya: sebelum
 * `toNodeHandler`, header ditimpa menjadi SATU alamat hasil fungsi ini.
 * Better-Auth lalu memakai jalur "satu nilai", yang tidak membaca entri kiri.
 *
 * Asumsi: container hanya bisa dihubungi lewat tepat sejumlah hop itu.
 * Staging: peramban → edge Railway → container, satu hop. Kalau origin
 * terbuka langsung, `TRUST_PROXY_HOPS=1` mempercayai header yang dikirim
 * klien. `0` tetap aman tanpa proxy, dan semua orang di belakang soket yang
 * sama berbagi ember.
 */

export interface SumberIp {
  ip?: string;
  headers: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string | null };
}

/** Berapa proxy tepercaya di depan API. Bukan angka bulat positif = 0. */
export function hopProxyTepercaya(): number {
  const n = Number.parseInt(process.env['TRUST_PROXY_HOPS'] ?? '0', 10);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

/** Entri `X-Forwarded-For`, urutan asli. Bukan header utuhnya. */
export function entriXff(headers: SumberIp['headers']): string[] {
  const xff = headers['x-forwarded-for'];
  const mentah = Array.isArray(xff) ? xff.join(',') : xff;
  if (typeof mentah !== 'string') return [];
  return mentah
    .split(',')
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

/**
 * Alamat yang dipakai pembatas. Soket kalau hop 0 atau rantainya lebih
 * pendek daripada hop yang diklaim — jangan menebak entri yang tidak ada.
 */
export function alamatKlien(req: SumberIp, hop = hopProxyTepercaya()): string {
  const langsung = req.ip || req.socket?.remoteAddress || 'tak-dikenal';
  if (hop === 0) return langsung;

  const daftar = entriXff(req.headers);
  return daftar.length >= hop ? (daftar[daftar.length - hop] ?? langsung) : langsung;
}

export interface RingkasanIp {
  /** Hanya diisi kalau hasilnya IP yang sah. Selain itu null — bukan rantai. */
  clientIp: string | null;
  xffCount: number;
  hops: number;
  ipSah: boolean;
}

export function ringkasanIp(req: SumberIp, hop = hopProxyTepercaya()): RingkasanIp {
  const mentah = alamatKlien(req, hop);
  const ipSah = isIP(mentah) !== 0;
  return {
    clientIp: ipSah ? mentah : null,
    xffCount: entriXff(req.headers).length,
    hops: hop,
    ipSah,
  };
}

/**
 * Menimpa `X-Forwarded-For` menjadi satu IP, atau menghapusnya.
 *
 * Menghapus — bukan membiarkan nilai klien — saat alamatnya tidak sah:
 * Better-Auth mempercayai header bernilai tunggal tanpa `trustedProxies`.
 * Membiarkan `9.9.9.9` yang dikirim klien saat hop 0 membuat pembatasnya
 * bisa dilewati, sementara pembatas Nest sudah mengabaikan header itu.
 */
export function pasangIpBetterAuth(req: SumberIp, hop = hopProxyTepercaya()): RingkasanIp {
  const ringkas = ringkasanIp(req, hop);
  if (ringkas.ipSah && ringkas.clientIp) req.headers['x-forwarded-for'] = ringkas.clientIp;
  else delete req.headers['x-forwarded-for'];
  return ringkas;
}
