
// Imports meetings from an iCal link (Outlook, iCloud or Google secret link).

import { NextResponse }    from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient }    from '@supabase/supabase-js';
import { lookup }          from 'node:dns/promises';
import { serviceClient, importEvents, findJoinLink } from '@/lib/calendar-server';
import { parseICS } from '@/lib/ics';

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
async function resolvesToPrivate(hostname: string): Promise<boolean> {
  if (isPrivateHost(hostname)) return true;
  try {
    const addrs = await lookup(hostname, { all: true });
    return addrs.length === 0 || addrs.some(a => isPrivateHost(a.address));
  } catch {
    return true; // can't resolve -> don't fetch
  }
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

    // Sync window: past 12 months -> next 24 months
    const syncFrom = new Date(); syncFrom.setMonth(syncFrom.getMonth() - 12);
    const syncTo   = new Date(); syncTo.setMonth(syncTo.getMonth() + 24);

    // Repeating events are expanded inside parseICS. Deduplicate by uid, cap at 500.
    const seen = new Set<string>();
    const now = new Date();
    const events = parseICS(icsText, syncFrom, syncTo)
      .filter(ev => { if (seen.has(ev.uid)) return false; seen.add(ev.uid); return true; });
    // Upcoming meetings first, then the most recent past ones.
    const relevant = [...events.filter(ev => ev.start >= now), ...events.filter(ev => ev.start < now).reverse()].slice(0, 500);

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
      relevant: relevant.length,
      ...result,
    });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
