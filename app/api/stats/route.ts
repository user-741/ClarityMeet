import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: 'not_configured' }, { status: 503 });

  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const count = (table: string, col?: string, val?: string) => {
    let q = db.from(table).select('id', { count: 'exact', head: true });
    if (col && val) q = q.eq(col, val);
    return q.then(r => { if (r.error) throw r.error; return r.count ?? 0; });
  };

  try {
    const [meetings, tasks, completed, users, durations] = await Promise.all([
      count('meetings', 'status', 'complete'),
      count('tasks'),
      count('tasks', 'status', 'Completed'),
      count('users'),
      db.from('meetings').select('duration_secs').eq('status', 'complete').not('duration_secs', 'is', null).limit(5000),
    ]);
    const secs = (durations.data ?? []).reduce((s, r) => s + (r.duration_secs ?? 0), 0);

    return NextResponse.json(
      { meetings, tasks, completed, users, hours: Math.round((secs / 3600) * 10) / 10 },
      { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } },
    );
  } catch {
    return NextResponse.json({ error: 'unavailable' }, { status: 503 });
  }
}
