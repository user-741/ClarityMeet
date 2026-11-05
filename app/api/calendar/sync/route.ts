
import { NextResponse }    from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient }    from '@supabase/supabase-js';
import { lookup }          from 'node:dns/promises';
import { serviceClient, importEvents, findJoinLink } from '@/lib/calendar-server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

async function requireUser(req: NextRequest) {
  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return null;

  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await anon.auth.getUser(token);
  return error || !data.user ? null : data.user;
}

// Blocks requests to private/link-local/loopback address ranges to prevent
// this endpoint being used as an SSRF pivot into internal infrastructure
// (e.g. cloud metadata services at 169.254.169.254).
function isPrivateHost(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal') || h.endsWith('.local')) return true;
  const ipv4 = h.match(/^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = ipv4.slice(1).map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;   // carrier-grade NAT
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;            // cloud metadata
    return false;
  }
  if (h.includes(':')) {
    if (h === '::' || h === '::1') return true;
    if (h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')) return true;
  }
  return false;
}

// A public-looking name can still resolve to a private address (DNS
// rebinding), so check what it actually resolves to as well.
async function resolvesToPrivate(hostname: string): Promise<boolean> {
  if (isPrivateHost(hostname)) return true;
  try {
    const addrs = await lookup(hostname, { all: true });
    return addrs.length === 0 || addrs.some(a => isPrivateHost(a.address));
  } catch {
    return true; // can't resolve -> don't fetch
  }
}

// Types
interface ICSEvent {
  uid:       string;
  title:     string;
  start:     Date;
  end:       Date | null;
  location:  string | null;
  desc:      string | null;
  allDay:    boolean;
  rrule:     string | null;   // raw RRULE string, e.g. "FREQ=YEARLY"
  conf:      string | null;   // X-GOOGLE-CONFERENCE / URL
}

// Date parser
function parseICSDate(raw: string): { date: Date | null; allDay: boolean } {
  if (!raw) return { date: null, allDay: false };

  // Strip TZID= prefix: "TZID=America/New_York:20240415T093000" -> "20240415T093000"
  const val = raw.includes(':') ? raw.split(':').pop()! : raw;

  // All-day: exactly 8 digits e.g. "20260415"
  if (/^\d{8}$/.test(val)) {
    const y  = val.slice(0, 4);
    const mo = val.slice(4, 6);
    const d  = val.slice(6, 8);
    const date = new Date(`${y}-${mo}-${d}T00:00:00`);
    return { date: isNaN(date.getTime()) ? null : date, allDay: true };
  }

  // Date-time: 20240415T093000Z or 20240415T093000
  const clean  = val.replace(/Z$/i, '');
  const isUtc  = val.endsWith('Z');
  const y  = clean.slice(0, 4);
  const mo = clean.slice(4, 6);
  const d  = clean.slice(6, 8);
  const h  = clean.slice(9, 11)  || '00';
  const mi = clean.slice(11, 13) || '00';
  const ss = clean.slice(13, 15) || '00';
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${ss}${isUtc ? 'Z' : ''}`;
  const date = new Date(iso);
  return { date: isNaN(date.getTime()) ? null : date, allDay: false };
}

// ICS parser
function parseICS(text: string): ICSEvent[] {
  const events: ICSEvent[] = [];

  // RFC 5545 line unfolding: CRLF/CR/LF followed by whitespace = continuation
  const unfolded = text.replace(/\r\n|\r/g, '\n').replace(/\n[ \t]/g, '');
  const lines    = unfolded.split('\n');

  let inEvent  = false;
  let inAlarm  = false;   // skip VALARM sub-components
  let cur: Record<string, string> = {};

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (line === 'BEGIN:VALARM') { inAlarm = true;  continue; }
    if (line === 'END:VALARM')   { inAlarm = false; continue; }
    if (inAlarm) continue;

    if (line === 'BEGIN:VEVENT') { inEvent = true; cur = {}; continue; }

    if (line === 'END:VEVENT' && inEvent) {
      inEvent = false;

      // Find DTSTART key (may be DTSTART, DTSTART;VALUE=DATE, DTSTART;TZID=...)
      const dtStartKey = Object.keys(cur).find(k => k.startsWith('DTSTART')) ?? '';
      const dtEndKey   = Object.keys(cur).find(k => k.startsWith('DTEND'))   ?? '';
      const dtDueKey   = Object.keys(cur).find(k => k.startsWith('DUE'))     ?? '';

      const { date: start, allDay } = parseICSDate(cur[dtStartKey] ?? '');
      if (!start) { continue; }

      const { date: end } = parseICSDate(cur[dtEndKey] ?? cur[dtDueKey] ?? '');
      const uid   = cur['UID']         || `${start.toISOString()}-${Math.random()}`;
      const title = (cur['SUMMARY']    || 'Untitled').trim();
      const loc   = cur['LOCATION']    || null;
      const desc  = cur['DESCRIPTION'] || null;
      const rrule = cur['RRULE']       || null;
      const conf  = cur['X-GOOGLE-CONFERENCE'] || cur['X-MICROSOFT-SKYPETEAMSMEETINGURL'] || cur['URL'] || null;
      const status = (cur['STATUS'] || '').toUpperCase();
      if (status === 'CANCELLED') continue;

      events.push({ uid, title: unescapeText(title), start, end, location: loc, desc, allDay, rrule, conf });
      continue;
    }

    if (!inEvent) continue;

    // Parse "KEY;PARAMS:VALUE" - colon is the separator
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    let rawKey = line.slice(0, colon);
    if (!/^(DTSTART|DTEND|DUE)/.test(rawKey)) rawKey = rawKey.split(';')[0];
    const val    = line.slice(colon + 1);
    // Use the full key (including params like ;VALUE=DATE or ;TZID=...) as the map key
    cur[rawKey] = val;
  }

  return events;
}

function unescapeText(s: string) {
  return s.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim();
}

// RRULE expander (handles FREQ=YEARLY, FREQ=WEEKLY, etc.)
// For recurring events, we generate occurrences within the sync window.
function expandRecurring(ev: ICSEvent, from: Date, to: Date): ICSEvent[] {
  if (!ev.rrule) return [ev];

  const rule = ev.rrule.toUpperCase();
  const results: ICSEvent[] = [];

  // Parse FREQ
  const freqMatch = rule.match(/FREQ=(\w+)/);
  if (!freqMatch) return [ev];
  const freq = freqMatch[1];

  // Parse optional COUNT and UNTIL
  const countMatch = rule.match(/COUNT=(\d+)/);
  const untilMatch = rule.match(/UNTIL=(\d{8}(?:T\d{6}Z?)?)/);
  const maxCount   = countMatch ? parseInt(countMatch[1]) : 500;
  const until      = untilMatch ? parseICSDate(untilMatch[1]).date : null;

  const duration   = ev.end ? ev.end.getTime() - ev.start.getTime() : 0;
  let   current    = new Date(ev.start);
  let   count      = 0;

  const advance = (d: Date) => {
    const n = new Date(d);
    if (freq === 'DAILY')   n.setDate(n.getDate() + 1);
    else if (freq === 'WEEKLY')  n.setDate(n.getDate() + 7);
    else if (freq === 'MONTHLY') n.setMonth(n.getMonth() + 1);
    else if (freq === 'YEARLY')  n.setFullYear(n.getFullYear() + 1);
    else n.setFullYear(n.getFullYear() + 1); // default: yearly
    return n;
  };

  // Skip occurrences before the sync window
  while (current < from && count < maxCount) {
    current = advance(current);
    count++;
  }

  // Collect occurrences within window
  while (current <= to && count < maxCount) {
    if (until && current > until) break;
    if (current >= from) {
      results.push({
        ...ev,
        uid:   `${ev.uid}_${current.toISOString().slice(0, 10)}`, // unique per occurrence
        start: new Date(current),
        end:   duration > 0 ? new Date(current.getTime() + duration) : null,
        rrule: null, // mark as expanded - won't re-expand
      });
    }
    current = advance(current);
    count++;
  }

  return results.length > 0 ? results : [ev]; // fall back to base event
}


// POST /api/calendar/sync
export async function POST(request: NextRequest) {
  try {
    const user = await requireUser(request);
    if (!user) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    }

    const body = await request.json();
    const { feedId, feedUrl, workspaceId } = body as {
      feedId: string; feedUrl: string; workspaceId: string; userId?: string;
    };
    const userId = user.id; // never trust a client-supplied userId - use the verified session

    if (!feedUrl || !workspaceId) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Verify the caller is actually a member of the workspace they're
    // asking us to write meetings into - without this, any authenticated
    // user could sync events into any workspace by guessing its id.
    const authedSupabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: request.headers.get('authorization')! } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: membership } = await authedSupabase
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .maybeSingle();

    if (!membership) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    // Normalise webcal:// -> https://
    const fetchUrl = feedUrl
      .replace(/^webcal:\/\//i, 'https://')
      .replace(/^webcals:\/\//i, 'https://');

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(fetchUrl);
    } catch {
      return NextResponse.json({ error: 'Invalid calendar URL' }, { status: 400 });
    }
    if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
      return NextResponse.json({ error: 'Only http(s) calendar URLs are supported' }, { status: 400 });
    }
    if (await resolvesToPrivate(parsedUrl.hostname)) {
      return NextResponse.json({ error: 'This URL is not allowed' }, { status: 400 });
    }

    // follow redirects by hand so every hop gets the private-address check
    let icsText: string;
    try {
      let target = parsedUrl;
      let res: Response | null = null;
      for (let hop = 0; hop < 6; hop++) {
        res = await fetch(target.toString(), {
          headers: {
            'User-Agent': 'Mozilla/5.0 ClarityMeet/1.0 calendar-sync',
            'Accept':     'text/calendar,*/*',
          },
          signal: AbortSignal.timeout(20_000),
          redirect: 'manual',
        });
        if (res.status < 300 || res.status >= 400) break;
        const loc = res.headers.get('location');
        if (!loc || hop === 5) {
          return NextResponse.json({ error: 'Calendar URL redirected too many times' }, { status: 400 });
        }
        const next = new URL(loc.replace(/^webcals?:\/\//i, 'https://'), target);
        if ((next.protocol !== 'https:' && next.protocol !== 'http:') || await resolvesToPrivate(next.hostname)) {
          return NextResponse.json({ error: 'This URL is not allowed' }, { status: 400 });
        }
        target = next;
      }

      if (!res || !res.ok) {
        return NextResponse.json(
          { error: `Could not fetch calendar feed: HTTP ${res?.status ?? 0}` },
          { status: 502 }
        );
      }
      icsText = await res.text();
    } catch (fetchErr: unknown) {
      const msg = fetchErr instanceof Error ? fetchErr.message : 'Network error';
      return NextResponse.json({ error: `Fetch failed: ${msg}` }, { status: 502 });
    }

    if (!icsText.includes('BEGIN:VCALENDAR')) {
      return NextResponse.json(
        { error: 'URL did not return a valid calendar (.ics). Check the URL is correct and publicly accessible.' },
        { status: 422 }
      );
    }

    const rawEvents = parseICS(icsText);

    // Sync window: past 12 months -> next 24 months
    // Wide window catches yearly recurring events (e.g. birthdays) properly
    const syncFrom = new Date(); syncFrom.setMonth(syncFrom.getMonth() - 12);
    const syncTo   = new Date(); syncTo.setMonth(syncTo.getMonth() + 24);

    // Expand recurring events within the window
    const expanded: ICSEvent[] = [];
    for (const ev of rawEvents) {
      const occurrences = expandRecurring(ev, syncFrom, syncTo);
      expanded.push(...occurrences);
    }

    // Filter to sync window, deduplicate by uid, cap at 500
    const seen = new Set<string>();
    const relevant = expanded
      .filter(ev => ev.start >= syncFrom && ev.start <= syncTo)
      .filter(ev => { if (seen.has(ev.uid)) return false; seen.add(ev.uid); return true; })
      .slice(0, 500);

    const supabase = serviceClient();
    const result = await importEvents(supabase, workspaceId, userId, relevant.map(ev => {
      const link = findJoinLink(ev.conf, ev.location, ev.desc);
      return {
        uid:      ev.uid,
        title:    ev.title,
        start:    ev.start,
        end:      ev.end,
        joinUrl:  link.url,
        platform: link.platform,
      };
    }));

    // Update feed metadata
    if (feedId) {
      await supabase.from('calendar_feeds').update({
        last_synced: new Date().toISOString(),
        event_count: relevant.length,
        updated_at:  new Date().toISOString(),
      }).eq('id', feedId);
    }

    return NextResponse.json({
      ok:       true,
      raw:      rawEvents.length,
      expanded: expanded.length,
      relevant: relevant.length,
      ...result,
    });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
