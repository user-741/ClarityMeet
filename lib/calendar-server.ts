import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createHmac, createHash, timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export function serviceClient(): SupabaseClient {
  return createClient(
    SUPABASE_URL,
    (process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY)!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

export async function requireUser(req: NextRequest) {
  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return null;
  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await anon.auth.getUser(token);
  return error || !data.user ? null : data.user;
}

export async function isMember(req: NextRequest, workspaceId: string, userId: string) {
  const authed = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: req.headers.get('authorization')! } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data } = await authed
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle();
  return !!data;
}


const JOIN_PATTERNS: { platform: string; re: RegExp }[] = [
  { platform: 'zoom',        re: /https?:\/\/[\w.-]*zoom\.us\/(?:j|my|w|s)\/[^\s"'<>\\]+/i },
  { platform: 'google_meet', re: /https?:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}[^\s"'<>\\]*/i },
  { platform: 'teams',       re: /https?:\/\/teams\.(?:microsoft|live)\.com\/[^\s"'<>\\]+/i },
  { platform: 'webex',       re: /https?:\/\/[\w.-]*webex\.com\/[^\s"'<>\\]+/i },
];

export function findJoinLink(...texts: (string | null | undefined)[]): { url: string | null; platform: string } {
  const hay = texts.filter(Boolean).join('\n').replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';');
  for (const p of JOIN_PATTERNS) {
    const m = hay.match(p.re);
    if (m) return { url: m[0].replace(/[).,;]+$/, ''), platform: p.platform };
  }
  const anyUrl = hay.match(/https?:\/\/[^\s"'<>\\]+/i);
  return { url: anyUrl ? anyUrl[0] : null, platform: 'other' };
}


export interface ImportEvent {
  uid: string;
  title: string;
  start: Date;
  end: Date | null;
  joinUrl: string | null;
  platform: string;
}

export async function importEvents(
  db: SupabaseClient, workspaceId: string, userId: string, events: ImportEvent[],
) {
  let inserted = 0, updated = 0, unchanged = 0;
  const errors: string[] = [];
  const now = new Date();

  const uids = events.map(e => e.uid);
  const existing = new Map<string, { id: string; title: string; started_at: string | null; ended_at: string | null; meeting_url: string | null; status: string | null }>();
  for (let i = 0; i < uids.length; i += 200) {
    const { data } = await db
      .from('meetings')
      .select('id, external_uid, title, started_at, ended_at, meeting_url, status')
      .eq('workspace_id', workspaceId)
      .in('external_uid', uids.slice(i, i + 200));
    for (const r of data ?? []) existing.set(r.external_uid as string, r);
  }

  for (const ev of events) {
    const row = {
      title:       ev.title,
      platform:    ev.platform,
      meeting_url: ev.joinUrl,
      started_at:  ev.start.toISOString(),
      ended_at:    ev.end?.toISOString() ?? null,
    };
    const prev = existing.get(ev.uid);

    if (!prev) {
      const { error } = await db.from('meetings').insert({
        ...row,
        workspace_id: workspaceId,
        owner_id:     userId,
        status:       ev.start < now ? 'complete' : 'scheduled',
        external_uid: ev.uid,
      });
      if (error) errors.push(`${ev.title}: ${error.message}`); else inserted++;
      continue;
    }

    // Only update upcoming meetings, never one that has already been recorded.
    if (prev.status !== 'scheduled') { unchanged++; continue; }
    const same = prev.title === row.title
      && sameTime(prev.started_at, row.started_at)
      && sameTime(prev.ended_at, row.ended_at)
      && (prev.meeting_url ?? null) === row.meeting_url;
    if (same) { unchanged++; continue; }

    const { error } = await db.from('meetings').update(row).eq('id', prev.id);
    if (error) errors.push(`${ev.title}: ${error.message}`); else updated++;
  }

  return { inserted, updated, unchanged, errors: errors.slice(0, 5) };
}

function sameTime(a: string | null, b: string | null) {
  if (!a || !b) return a === b;
  return new Date(a).getTime() === new Date(b).getTime();
}


function feedSecret() {
  const s = process.env.CALENDAR_FEED_SECRET
    || createHash('sha256').update(`claritymeet-feed:${process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''}`).digest('hex');
  return s;
}

export function signFeed(workspaceId: string, userId: string) {
  return createHmac('sha256', feedSecret()).update(`${workspaceId}.${userId}`).digest('base64url').slice(0, 32);
}

export function verifyFeed(workspaceId: string, userId: string, sig: string) {
  const expected = Buffer.from(signFeed(workspaceId, userId));
  const given = Buffer.from(sig || '');
  return expected.length === given.length && timingSafeEqual(expected, given);
}
