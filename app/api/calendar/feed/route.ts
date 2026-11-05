import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireUser, isMember, serviceClient, signFeed, verifyFeed } from '@/lib/calendar-server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function publicOrigin(req: NextRequest) {
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
  const proto = req.headers.get('x-forwarded-proto') || req.nextUrl.protocol.replace(':', '') || 'https';
  return host ? `${proto}://${host}` : req.nextUrl.origin;
}

function icsDate(iso: string) {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function esc(s: string) {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

function fold(line: string) {
  const out: string[] = [];
  let rest = line;
  while (rest.length > 74) { out.push(rest.slice(0, 74)); rest = ' ' + rest.slice(74); }
  out.push(rest);
  return out.join('\r\n');
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const w = sp.get('w') || '';
  const u = sp.get('u') || '';
  const sig = sp.get('sig') || '';
  if (!w || !u || !verifyFeed(w, u, sig)) return new NextResponse('Not found', { status: 404 });

  const db = serviceClient();
  const { data: member } = await db.from('workspace_members').select('user_id').eq('workspace_id', w).eq('user_id', u).maybeSingle();
  if (!member) return new NextResponse('Not found', { status: 404 });

  const { data: ws } = await db.from('workspaces').select('name').eq('id', w).maybeSingle();
  const from = new Date(); from.setMonth(from.getMonth() - 3);
  const { data: meetings } = await db
    .from('meetings')
    .select('id, title, started_at, ended_at, meeting_url, platform, status, updated_at, external_uid')
    .eq('workspace_id', w)
    .gte('started_at', from.toISOString())
    .order('started_at', { ascending: true })
    .limit(1000);

  const origin = publicOrigin(request);
  const stamp = icsDate(new Date().toISOString());
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ClarityMeet//Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(`ClarityMeet${ws?.name ? ` - ${ws.name}` : ''}`)}`,
    'X-PUBLISHED-TTL:PT15M',
    'REFRESH-INTERVAL;VALUE=DURATION:PT15M',
  ];

  for (const m of meetings ?? []) {
    if (!m.started_at) continue;
    if (m.external_uid && !String(m.external_uid).startsWith('google:')) continue;
    const end = m.ended_at ?? new Date(new Date(m.started_at).getTime() + 60 * 60 * 1000).toISOString();
    const summaryLink = `${origin}/meeting-summary?id=${m.id}`;
    const desc = [
      m.meeting_url ? `Join: ${m.meeting_url}` : '',
      m.status === 'complete' ? `Summary and tasks: ${summaryLink}` : `Open in ClarityMeet: ${summaryLink}`,
    ].filter(Boolean).join('\n');
    lines.push(
      'BEGIN:VEVENT',
      `UID:${m.id}@claritymeet`,
      `DTSTAMP:${stamp}`,
      `LAST-MODIFIED:${icsDate(m.updated_at ?? m.started_at)}`,
      `DTSTART:${icsDate(m.started_at)}`,
      `DTEND:${icsDate(end)}`,
      fold(`SUMMARY:${esc(m.title || 'Meeting')}`),
      fold(`DESCRIPTION:${esc(desc)}`),
      ...(m.meeting_url ? [fold(`LOCATION:${esc(m.meeting_url)}`), fold(`URL:${m.meeting_url}`)] : []),
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');

  return new NextResponse(lines.join('\r\n') + '\r\n', {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="claritymeet.ics"',
      'Cache-Control': 'private, max-age=300',
    },
  });
}

export async function POST(request: NextRequest) {
  const user = await requireUser(request);
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const { workspaceId } = await request.json().catch(() => ({})) as { workspaceId?: string };
  if (!workspaceId) return NextResponse.json({ error: 'Missing workspaceId' }, { status: 400 });
  if (!(await isMember(request, workspaceId, user.id))) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const origin = publicOrigin(request);
  const qs = new URLSearchParams({ w: workspaceId, u: user.id, sig: signFeed(workspaceId, user.id) });
  const https = `${origin}/api/calendar/feed?${qs}`;
  return NextResponse.json({ https, webcal: https.replace(/^https?:\/\//, 'webcal://') });
}
