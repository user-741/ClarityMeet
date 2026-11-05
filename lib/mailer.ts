// Server-only email sending over SMTP (for example Gmail with an App Password).
// Settings come from environment variables only - see .env.local.example for
// the names (SMTP host, port, user, app password and the From address).
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
