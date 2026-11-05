// POST /api/invite/send
// Creates a workspace invite (via the create_workspace_invite RPC, run as the
// signed-in user so the database's own admin checks apply) and emails the
// invite link. If SMTP isn't configured, the invite is still created and the
// link is returned so it can be copied and shared by hand.

import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import type { Database } from "@/lib/database.types";
import { mailerConfigured, sendMail, escapeHtml } from "@/lib/mailer";
import { renderEmail } from "@/lib/email-layout";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const ROLES = ["admin", "member", "viewer"] as const;
type Role = (typeof ROLES)[number];

function baseUrl(req: NextRequest) {
  // Prefer the address the inviter is actually using (e.g. the public
  // trycloudflare URL) so the emailed link works for someone else.
  const origin = req.headers.get("origin");
  if (origin && !/localhost|127\.0\.0\.1/.test(origin)) return origin;
  const env = process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL;
  return (env || origin || "http://localhost:3000").replace(/\/+$/, "");
}

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as { email?: string; role?: string; workspaceId?: string } | null;
  const email = (body?.email || "").trim().toLowerCase();
  const role = (body?.role || "member") as Role;
  const workspaceId = body?.workspaceId || "";

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }
  if (!ROLES.includes(role) || !workspaceId) {
    return NextResponse.json({ error: "Invalid role or workspace." }, { status: 400 });
  }

  // Client that acts as the signed-in user (RLS + RPC permission checks apply).
  const db = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userErr } = await db.auth.getUser(auth.slice(7));
  if (userErr || !userData.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const inviter = userData.user;
  if ((inviter.email || "").toLowerCase() === email) {
    return NextResponse.json({ error: "You can't invite your own email address." }, { status: 400 });
  }

  const { data: invite, error: inviteErr } = await db.rpc("create_workspace_invite", {
    p_workspace_id: workspaceId,
    p_email: email,
    p_role: role,
  });
  if (inviteErr || !invite) {
    return NextResponse.json({ error: inviteErr?.message || "Could not create invite." }, { status: 400 });
  }

  const { data: ws } = await db.from("workspaces").select("name").eq("id", workspaceId).maybeSingle();
  const wsName = ws?.name || "a workspace";
  const meta = inviter.user_metadata || {};
  const inviterName =
    [meta.first_name, meta.last_name].filter(Boolean).join(" ") || meta.full_name || inviter.email || "A teammate";

  const link = `${baseUrl(req)}/invite/accept?workspace_id=${encodeURIComponent(workspaceId)}`;

  if (!mailerConfigured()) {
    return NextResponse.json({ ok: true, emailed: false, link, reason: "Email sending is not configured (SMTP_* env vars)." });
  }

  const safeWs = escapeHtml(wsName);
  const safeInviter = escapeHtml(String(inviterName));
  try {
    await sendMail({
      to: email,
      replyTo: inviter.email || undefined,
      subject: `${inviterName} invited you to ${wsName} on ClarityMeet`,
      text:
        `${inviterName} invited you to join ${wsName} on ClarityMeet as a ${role}.\n\n` +
        `Accept the invite: ${link}\n\n` +
        `Sign in or create an account with this email address (${email}) and you'll be added automatically.`,
      html: renderEmail({
        heading: `Join ${wsName} on ClarityMeet`,
        bodyHtml: `<strong style="color:#0b1220;">${safeInviter}</strong> invited you to the <strong style="color:#0b1220;">${safeWs}</strong> workspace as a ${role}. Meetings recorded there get a summary and a list of action items automatically, and you'll see them as soon as you join.`,
        button: "Accept invite",
        url: link,
        note: `Sign in or create an account with ${email} and you'll join automatically. Weren't expecting this? You can ignore this email.`,
        preheader: `${inviterName} invited you to ${wsName}.`,
        recipient: email,
      }),
    });
  } catch (err) {
    console.error("[api/invite/send] email failed:", err);
    return NextResponse.json({ ok: true, emailed: false, link, reason: "The invite was created but the email could not be sent." });
  }

  return NextResponse.json({ ok: true, emailed: true, link });
}
