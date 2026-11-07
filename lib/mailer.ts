// Server-only email sending over SMTP (for example Gmail with an App Password).
import nodemailer from "nodemailer";

export function mailerConfigured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

export async function sendMail(opts: { to: string; subject: string; html: string; text: string; replyTo?: string }) {
  const port = Number(process.env.SMTP_PORT || 465);
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USER!, pass: process.env.SMTP_PASS! },
  });
  return transport.sendMail({
    from: process.env.MAIL_FROM || `ClarityMeet <${process.env.SMTP_USER}>`,
    ...opts,
  });
}

export function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

// Simple branded email used for notifications.
export function notifyEmail(opts: { heading: string; lines: string[]; buttonText: string; url: string }) {
  const items = opts.lines.map(l => `<p style="margin:0 0 10px;color:#334155;font-size:15px;line-height:1.5">${escapeHtml(l)}</p>`).join("");
  const html = `<div style="font-family:Inter,Arial,sans-serif;background:#f1f5f9;padding:32px 16px">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:14px;padding:28px;border:1px solid #e2e8f0">
<div style="font-weight:800;font-size:18px;color:#0f172a;margin-bottom:18px">ClarityMeet</div>
<h1 style="font-size:20px;color:#0f172a;margin:0 0 14px">${escapeHtml(opts.heading)}</h1>${items}
<a href="${opts.url}" style="display:inline-block;margin-top:12px;background:#2563eb;color:#fff;text-decoration:none;padding:11px 20px;border-radius:9px;font-weight:600">${escapeHtml(opts.buttonText)}</a>
<p style="margin:22px 0 0;color:#94a3b8;font-size:12px">You can turn these emails off in Settings, Notifications.</p></div></div>`;
  const text = `${opts.heading}\n\n${opts.lines.join("\n")}\n\n${opts.buttonText}: ${opts.url}`;
  return { html, text };
}

export function siteUrl(req: { nextUrl: { origin: string } }) {
  return process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin;
}
