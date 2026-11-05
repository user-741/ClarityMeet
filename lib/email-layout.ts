// Shared HTML layout for ClarityMeet emails (matches supabase/templates/*.html).
// Table-based with inline styles so it renders in Gmail, Outlook and Apple Mail.
import { escapeHtml } from "./mailer";

export function renderEmail(o: {
  heading: string; bodyHtml: string; button: string; url: string;
  note: string; preheader: string; recipient: string;
}) {
  const font = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
  const url = escapeHtml(o.url);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHtml(o.heading)}</title></head>
<body style="margin:0;padding:0;background:#f4f5f7;">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(o.preheader)}</span>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f4f5f7;"><tr><td align="center" style="padding:40px 16px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:520px;">
<tr><td style="padding:0 4px 20px 4px;font-family:${font};font-size:15px;font-weight:700;color:#0b1220;">
<span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:#0e7490;margin-right:8px;vertical-align:middle;"></span>ClarityMeet</td></tr>
<tr><td style="background:#ffffff;border:1px solid #e3e6eb;border-radius:12px;padding:36px 32px;font-family:${font};color:#0b1220;">
<h1 style="margin:0 0 12px 0;font-size:22px;line-height:1.3;font-weight:700;color:#0b1220;">${escapeHtml(o.heading)}</h1>
<p style="margin:0 0 28px 0;font-size:15px;line-height:1.6;color:#3d4757;">${o.bodyHtml}</p>
<table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td style="border-radius:8px;background:#0b1220;">
<a href="${url}" style="display:inline-block;padding:13px 22px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">${escapeHtml(o.button)}</a></td></tr></table>
<p style="margin:28px 0 0 0;font-size:13px;line-height:1.6;color:#6b7383;">${escapeHtml(o.note)}</p>
<p style="margin:16px 0 0 0;font-size:12px;line-height:1.6;color:#8a91a0;word-break:break-all;">Button not working? Copy this link into your browser:<br><a href="${url}" style="color:#0e7490;">${url}</a></p>
</td></tr>
<tr><td style="padding:20px 4px 0 4px;font-family:${font};font-size:12px;line-height:1.6;color:#8a91a0;">ClarityMeet turns your meetings into summaries and action items.<br>This email was sent to ${escapeHtml(o.recipient)}.</td></tr>
</table></td></tr></table></body></html>`;
}
