import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireUser, isMember, serviceClient } from '@/lib/calendar-server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Tells a teammate they were given a task.
export async function POST(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const { taskId, userId } = await req.json().catch(() => ({})) as { taskId?: string; userId?: string };
  if (!taskId || !userId) return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
  if (userId === user.id) return NextResponse.json({ ok: true });

  const db = serviceClient();
  const { data: task } = await db.from('tasks').select('id, title, workspace_id, meeting_id, assignee_id').eq('id', taskId).maybeSingle();
  if (!task || task.assignee_id !== userId) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!(await isMember(req, task.workspace_id, user.id))) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const { data: from } = await db.from('users').select('first_name, last_name, email').eq('id', user.id).maybeSingle();
  const name = [from?.first_name, from?.last_name].filter(Boolean).join(' ') || from?.email || 'A teammate';

  const { error } = await db.from('notifications').insert({
    user_id: userId,
    workspace_id: task.workspace_id,
    type: 'info',
    title: `${name} gave you a task`,
    body: task.title,
    link: task.meeting_id ? `/meeting-summary?id=${task.meeting_id}` : '/tasks',
    read: false,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
