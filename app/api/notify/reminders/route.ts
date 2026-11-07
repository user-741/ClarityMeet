import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireUser, serviceClient } from '@/lib/calendar-server';
import { mailerConfigured, sendMail, notifyEmail, siteUrl } from '@/lib/mailer';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Emails the signed-in user one reminder for tasks that are due soon or overdue.
export async function POST(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (!mailerConfigured()) return NextResponse.json({ ok: true, emailed: false });
  const { taskIds } = await req.json().catch(() => ({})) as { taskIds?: string[] };
  if (!Array.isArray(taskIds) || !taskIds.length) return NextResponse.json({ ok: true, emailed: false });

  const db = serviceClient();
  const [{ data: tasks }, { data: me }, { data: prefs }] = await Promise.all([
    db.from('tasks').select('id, title, due_date').in('id', taskIds.slice(0, 20)).eq('assignee_id', user.id).in('status', ['Open', 'In Progress']),
    db.from('users').select('email').eq('id', user.id).maybeSingle(),
    db.from('user_preferences').select('email_task_reminders').eq('user_id', user.id).maybeSingle(),
  ]);
  if (!tasks?.length || !me?.email || prefs?.email_task_reminders === false) return NextResponse.json({ ok: true, emailed: false });

  const today = new Date().toISOString().slice(0, 10);
  const lines = tasks.map(t => `${t.title} (${(t.due_date as string) < today ? 'overdue' : (t.due_date === today ? 'due today' : 'due tomorrow')})`);
  const mail = notifyEmail({ heading: `You have ${tasks.length} task${tasks.length === 1 ? '' : 's'} due`, lines, buttonText: 'Open tasks', url: `${siteUrl(req)}/tasks` });
  try {
    await sendMail({ to: me.email, subject: 'Task reminder from ClarityMeet', ...mail });
    return NextResponse.json({ ok: true, emailed: true });
  } catch {
    return NextResponse.json({ ok: true, emailed: false });
  }
}
