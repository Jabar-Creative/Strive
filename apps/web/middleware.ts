import { NextResponse, type NextRequest } from 'next/server';

import { HALAMAN_TERLARANG, putusAksesConsole } from '@/lib/console-guard';

/**
 * Middleware rute (student) vs (console) — A-04 (Dev B), PRD §2.3 dan §8.1.
 *
 * Menjaga URL milik route group (console): /mentor dan /admin. Keputusan
 * selalu diambil di sisi server dari GET /api/v1/me (A-05) dengan cookie
 * permintaan diteruskan apa adanya; middleware tidak pernah memercayai
 * klaim peran dari client (CLAUDE.md aturan 9). Halaman data di balik rute
 * ini tetap dijaga guard API A-02 — middleware adalah lapis pertama, bukan
 * satu-satunya.
 *
 * Tiga keluaran, semuanya jelas bagi pengguna:
 *  - belum masuk        → redirect /login (bukan 403: belum ada yang ditolak)
 *  - masuk sebagai student → 403 + HALAMAN_TERLARANG (AC A-04)
 *  - mentor/superadmin  → lewat
 */

const API_URL = process.env.API_URL || 'http://localhost:3001';

export async function middleware(req: NextRequest) {
  const cookie = req.headers.get('cookie');
  if (!cookie) {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  let statusMe = 0;
  let peran: string | undefined;
  try {
    const jawaban = await fetch(`${API_URL}/api/v1/me`, {
      headers: { cookie },
      cache: 'no-store',
      signal: AbortSignal.timeout(3000),
    });
    statusMe = jawaban.status;
    if (jawaban.ok) {
      peran = (await jawaban.json())?.role;
    }
  } catch {
    // Timeout atau API tak terjangkau: statusMe tetap 0, keputusan
    // gagal-tertutup di console-guard. Jangan buka pintu hanya karena
    // penjaganya tidak menjawab.
  }

  switch (putusAksesConsole(statusMe, peran)) {
    case 'lewat':
      return NextResponse.next();
    case 'login':
      return NextResponse.redirect(new URL('/login', req.url));
    case 'terlarang':
      return new NextResponse(HALAMAN_TERLARANG, {
        status: 403,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
  }
}

export const config = {
  matcher: ['/mentor/:path*', '/admin/:path*'],
};
