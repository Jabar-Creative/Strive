import { createHmac } from 'node:crypto';
import type { NotificationKind } from '@strive/contracts';

/**
 * Template email notifikasi — docs/PRD.md §12.4 (Resend).
 *
 * Layout tabel + inline style, TANPA CSS eksternal/JS: subset HTML yang aman
 * untuk Outlook desktop (mesin render Word, mengabaikan flex/grid/position)
 * dan Gmail (menghapus `<style>` di beberapa klien). NO-3: "template diuji di
 * Gmail dan Outlook".
 *
 * GAP YANG DIKETAHUI (dilaporkan di laporan N-01, bukan disembunyikan):
 * verifikasi render sungguhan di Gmail/Outlook TIDAK dilakukan di sesi ini —
 * tidak ada alat pratinjau email di lingkungan kerja ini. Template ditulis
 * mengikuti praktik standar (table layout, inline style, tanpa web font),
 * tapi klaim "lulus uji" di acceptance criteria BELUM dibuktikan visual.
 */

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Tautan unsubscribe (NO-6: "setiap email punya tautan berhenti berlangganan
 * yang BERFUNGSI"). Endpoint `/unsubscribe` belum ada di docs/PRD.md §10.3 —
 * GAP YANG DIKETAHUI, dicatat di laporan N-01. Tautannya benar-benar
 * dirender (bukan `#`/placeholder kosong), tapi belum resolve ke halaman apa
 * pun sampai endpoint itu dibangun.
 *
 * Token ditandatangani (HMAC-SHA256 atas userId, kunci AUTH_SECRET) supaya
 * saat endpoint sungguhan dibangun nanti ia tidak lahir sebagai IDOR
 * (menebak userId lalu unsubscribe-kan akun orang lain).
 */
export function buildUnsubscribeUrl(userId: string): string {
  const appUrl = process.env['APP_URL'] ?? 'http://localhost:3000';
  const secret = process.env['AUTH_SECRET'];
  const signature = secret
    ? createHmac('sha256', secret).update(userId).digest('hex')
    : 'dev-unsigned-auth-secret-kosong';
  const token = `${userId}.${signature}`;
  return `${appUrl}/unsubscribe?token=${encodeURIComponent(token)}`;
}

/** Header `List-Unsubscribe` standar (RFC 2369) — dukungan tombol unsubscribe bawaan Gmail/Outlook. */
export function buildListUnsubscribeHeader(userId: string): string {
  return `<${buildUnsubscribeUrl(userId)}>`;
}

export interface EmailTemplateInput {
  userId: string;
  title: string;
  body: string;
}

function layout(preheader: string, contentHtml: string, unsubscribeUrl: string): string {
  return `<!doctype html>
<html lang="id">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Strive Academy</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f4f4f5;font-family:Arial,Helvetica,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;">${escapeHtml(preheader)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;">
            <tr>
              <td style="background-color:#111827;padding:20px 24px;">
                <span style="color:#ffffff;font-size:18px;font-weight:bold;">Strive Academy</span>
              </td>
            </tr>
            <tr>
              <td style="padding:24px;color:#111827;font-size:14px;line-height:1.6;">
                ${contentHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:16px 24px;background-color:#f9fafb;border-top:1px solid #e5e7eb;">
                <p style="margin:0;color:#6b7280;font-size:12px;line-height:1.5;">
                  Anda menerima email ini karena terdaftar di Strive Academy.
                  <a href="${unsubscribeUrl}" style="color:#6b7280;">Berhenti berlangganan</a>.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/** Satu-satunya template konkret yang diminta N-01 sebagai bukti (selain generik). */
export function renderStreakWarningEmail(input: EmailTemplateInput): string {
  const appUrl = process.env['APP_URL'] ?? 'http://localhost:3000';
  const content = `
    <p style="margin:0 0 12px;font-size:16px;font-weight:bold;">🔥 ${escapeHtml(input.title)}</p>
    <p style="margin:0 0 16px;">${escapeHtml(input.body)}</p>
    <table role="presentation" cellpadding="0" cellspacing="0">
      <tr>
        <td style="border-radius:6px;background-color:#ea580c;">
          <a href="${appUrl}/hub"
             style="display:inline-block;padding:10px 20px;color:#ffffff;text-decoration:none;font-weight:bold;font-size:14px;">
            Lanjutkan streak sekarang
          </a>
        </td>
      </tr>
    </table>
  `;
  return layout(input.title, content, buildUnsubscribeUrl(input.userId));
}

/** Fallback generik untuk kind lain yang mengirim email (`job_done`) — belum punya AC visual sendiri di N-01. */
export function renderGenericNotificationEmail(input: EmailTemplateInput): string {
  const content = `
    <p style="margin:0 0 12px;font-size:16px;font-weight:bold;">${escapeHtml(input.title)}</p>
    <p style="margin:0;">${escapeHtml(input.body)}</p>
  `;
  return layout(input.title, content, buildUnsubscribeUrl(input.userId));
}

export function renderNotificationEmail(kind: NotificationKind, input: EmailTemplateInput): string {
  if (kind === 'streak_warning') {
    return renderStreakWarningEmail(input);
  }
  return renderGenericNotificationEmail(input);
}
