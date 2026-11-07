import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireUser, isMember, serviceClient } from '@/lib/calendar-server';
import { mailerConfigured, sendMail, notifyEmail, siteUrl } from '@/lib/mailer';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Emails the signed-in user the summary of a meeting once it has been processed.
export async function POST(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (!mailerConfigured()) return NextResponse.json({ ok: true, emailed: false });
  const { meetingId } = await req.json().catch(() => ({})) as { meetingId?: string };
  if (!meetingId) return NextResponse.json({ error: 'Missing meetingId' }, { status: 400 });

  const db = serviceClient();
  const { data: m } = await db.from('meetings').select('id, title, summary, task_count, workspace_id, status').eq('id', meetingId).maybeSingle();
  if (!m || m.status !== 'complete' || !m.workspace_id) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!(await isMember(req, m.workspace_id, user.id))) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const [{ data: me }, { data: prefs }] = await Promise.all([
    db.from('users').select('email').eq('id', user.id).maybeSingle(),
    db.from('user_preferences').select('email_summaries').eq('user_id', user.id).maybeSingle(),
  ]);
  if (!me?.email || prefs?.email_summaries === false) return NextResponse.json({ ok: true, emailed: false });

  const summary = (m.summary ?? '').slice(0, 700);
  const mail = notifyEmail({
    heading: `Summary ready: ${m.title ?? 'Meeting'}`,
    lines: [summary, `${m.task_count ?? 0} action item${m.task_count === 1 ? '' : 's'} found.`],
    buttonText: 'Open summary',
    url: `${siteUrl(req)}/meeting-summary?id=${m.id}`,
  });
  try {
    await sendMail({ to: me.email, subject: `Meeting summary: ${m.title ?? 'Meeting'}`, ...mail });
    return NextResponse.json({ ok: true, emailed: true });
  } catch {
    return NextResponse.json({ ok: true, emailed: false });
  }
}
