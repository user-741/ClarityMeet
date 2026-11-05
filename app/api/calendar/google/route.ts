import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireUser, isMember, serviceClient, importEvents, findJoinLink } from '@/lib/calendar-server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const API = 'https://www.googleapis.com/calendar/v3';

type GEvent = {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  hangoutLink?: string;
  htmlLink?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] };
};

function eventJoinLink(ev: GEvent) {
  const video = ev.conferenceData?.entryPoints?.find(p => p.entryPointType === 'video')?.uri;
  return findJoinLink(ev.hangoutLink, video, ev.location, ev.description);
}

function toDate(t?: { dateTime?: string; date?: string }) {
  if (!t) return null;
  if (t.dateTime) return new Date(t.dateTime);
  if (t.date) return new Date(`${t.date}T00:00:00`);
  return null;
}

async function google(token: string, path: string, init: RequestInit = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(20_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body?.error?.message || `Google Calendar error ${res.status}`;
    throw Object.assign(new Error(msg), { status: res.status });
  }
  return body;
}

export async function POST(request: NextRequest) {
  const user = await requireUser(request);
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const { action, accessToken, workspaceId } = body as { action?: string; accessToken?: string; workspaceId?: string };
  if (!accessToken || !workspaceId) return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  if (!(await isMember(request, workspaceId, user.id))) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const db = serviceClient();

  try {
    if (action === 'create') {
      const { title, start, end, addMeet } = body as { title?: string; start?: string; end?: string; addMeet?: boolean };
      if (!title || !start) return NextResponse.json({ error: 'Title and start time are required' }, { status: 400 });
      const startAt = new Date(start);
      const endAt = end ? new Date(end) : new Date(startAt.getTime() + 60 * 60 * 1000);

      const created: GEvent = await google(accessToken, `/calendars/primary/events?conferenceDataVersion=${addMeet ? 1 : 0}`, {
        method: 'POST',
        body: JSON.stringify({
          summary: title,
          start: { dateTime: startAt.toISOString() },
          end: { dateTime: endAt.toISOString() },
          ...(addMeet ? { conferenceData: { createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: 'hangoutsMeet' } } } } : {}),
        }),
      });

      const link = eventJoinLink(created);
      const result = await importEvents(db, workspaceId, user.id, [{
        uid: `google:${created.id}`,
        title,
        start: startAt,
        end: endAt,
        joinUrl: link.url,
        platform: link.platform,
      }]);
      return NextResponse.json({ ok: true, meetUrl: link.url, htmlLink: created.htmlLink, ...result });
    }

    // import
    const from = new Date(); from.setMonth(from.getMonth() - 3);
    const to = new Date(); to.setMonth(to.getMonth() + 6);
    const items: GEvent[] = [];
    let pageToken = '';
    for (let page = 0; page < 5; page++) {
      const qs = new URLSearchParams({
        timeMin: from.toISOString(),
        timeMax: to.toISOString(),
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: '250',
        ...(pageToken ? { pageToken } : {}),
      });
      const data = await google(accessToken, `/calendars/primary/events?${qs}`);
      items.push(...(data.items ?? []));
      if (!data.nextPageToken) break;
      pageToken = data.nextPageToken;
    }

    const events = items
      .filter(ev => ev.status !== 'cancelled')
      .map(ev => {
        const start = toDate(ev.start);
        if (!start) return null;
        const link = eventJoinLink(ev);
        return {
          uid: `google:${ev.id}`,
          title: (ev.summary || 'Untitled').trim(),
          start,
          end: toDate(ev.end),
          joinUrl: link.url,
          platform: link.platform,
        };
      })
      .filter((e): e is NonNullable<typeof e> => !!e);

    const result = await importEvents(db, workspaceId, user.id, events);
    return NextResponse.json({ ok: true, found: events.length, ...result });
  } catch (err: unknown) {
    const status = (err as { status?: number }).status;
    const msg = err instanceof Error ? err.message : 'Google Calendar request failed';
    return NextResponse.json({ error: msg, reconnect: status === 401 || status === 403 }, { status: status === 401 ? 401 : 502 });
  }
}
