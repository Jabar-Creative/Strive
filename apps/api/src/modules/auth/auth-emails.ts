/**
 * Template email auth — reset password & verifikasi (isu #65 poin 1).
 *
 * ── Kenapa terpisah dari `notification-templates.util.ts` ──
 *
 * Email di sini BUKAN notifikasi. Notifikasi punya baris di tabel
 * `notifications`, lonceng di UI, kuota harian (NO-5), dan tautan berhenti
 * berlangganan (NO-6). Email reset password tidak punya satu pun dari itu:
 * ia dikirim ke alamat yang mungkin tidak punya akun, tidak boleh muncul di
 * lonceng (kalau bisa melihat lonceng, kamu sudah masuk dan tidak butuh
 * reset), dan **tidak boleh punya tautan unsubscribe** — email transaksional
 * yang bisa dimatikan berarti akun yang tidak bisa dipulihkan.
 *
 * Konsekuensinya `escapeHtml` ditulis ulang di sini alih-alih diimpor dari
 * modul `notification`. Itu disengaja: barrel `notification` sengaja sempit
 * (hanya module + service), dan melebarkannya untuk satu fungsi string
 * berarti modul auth bergantung pada modul notifikasi selamanya, untuk
 * alasan yang tidak ada hubungannya dengan notifikasi.
 *
 * Layout tabel + inline style, sama alasannya dengan N-01: Outlook desktop
 * memakai mesin render Word (mengabaikan flex/grid) dan Gmail membuang
 * `<style>` di sebagian klien.
 *
 * GAP YANG DIKETAHUI, sama seperti N-01: render sungguhan di Gmail/Outlook
 * belum diverifikasi visual — tidak ada alat pratinjau email di lingkungan
 * kerja ini.
 */

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface AuthEmailInput {
  /** Nama tampilan penerima. Boleh kosong — sebagian pengguna tidak mengisinya. */
  displayName?: string | null;
  /** URL lengkap dari Better-Auth, sudah memuat tokennya. */
  url: string;
}

/** Kerangka bersama supaya kedua email terlihat berasal dari produk yang sama. */
function kerangka(judul: string, isi: string, tombol: { label: string; url: string }): string {
  const url = escapeHtml(tombol.url);
  return `<!doctype html>
<html lang="id">
<body style="margin:0;padding:0;background:#f5f5f4;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f4;padding:24px 0;">
<tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;padding:32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1c1917;">
<tr><td>
<h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;color:#1c1917;">${escapeHtml(judul)}</h1>
${isi}
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
<tr><td style="border-radius:8px;background:#1c1917;">
<a href="${url}" style="display:inline-block;padding:12px 24px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">${escapeHtml(tombol.label)}</a>
</td></tr>
</table>
<p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:#57534e;">Kalau tombolnya tidak bekerja, salin tautan ini ke peramban:</p>
<p style="margin:0;font-size:13px;line-height:1.6;word-break:break-all;"><a href="${url}" style="color:#57534e;">${url}</a></p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

/** Sapaan yang tetap sopan saat nama tidak ada — bukan "Halo null". */
function sapaan(displayName?: string | null): string {
  const nama = displayName?.trim();
  return nama ? `Halo ${escapeHtml(nama)},` : 'Halo,';
}

export const SUBJEK_RESET = 'Atur ulang password Strive Academy';
export const SUBJEK_VERIFIKASI = 'Verifikasi email Strive Academy';

export function renderResetPasswordEmail(input: AuthEmailInput): string {
  return kerangka(
    'Atur ulang password',
    `<p style="margin:0 0 12px;font-size:15px;line-height:1.6;">${sapaan(input.displayName)}</p>
<p style="margin:0 0 12px;font-size:15px;line-height:1.6;">Ada permintaan untuk mengatur ulang password akunmu. Klik tombol di bawah untuk memilih password baru.</p>
<p style="margin:0;font-size:15px;line-height:1.6;color:#57534e;"><strong>Kalau bukan kamu yang meminta, abaikan saja email ini.</strong> Password lamamu tetap berlaku dan tidak ada yang berubah.</p>`,
    { label: 'Atur ulang password', url: input.url },
  );
}

export function renderVerificationEmail(input: AuthEmailInput): string {
  return kerangka(
    'Verifikasi alamat email',
    `<p style="margin:0 0 12px;font-size:15px;line-height:1.6;">${sapaan(input.displayName)}</p>
<p style="margin:0 0 12px;font-size:15px;line-height:1.6;">Terima kasih sudah mendaftar. Satu langkah lagi: konfirmasi bahwa alamat email ini benar milikmu.</p>
<p style="margin:0;font-size:15px;line-height:1.6;color:#57534e;">Kamu sudah bisa langsung belajar tanpa menunggu ini. Verifikasi baru dibutuhkan saat kamu mau membeli koin (AU-8).</p>`,
    { label: 'Verifikasi email', url: input.url },
  );
}
