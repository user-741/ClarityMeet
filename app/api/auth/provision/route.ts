// Called by the client immediately after a session is established
// (see app/auth/callback/page.tsx). Verifies the bearer token belongs
// to a real Supabase user, then uses the service-role key to ensure a
// public.users row + a default workspace/membership exist.
//
// This is only for the "default workspace on first login" case.
// Invite acceptance (joining an *existing* workspace) is handled
// separately in app/invite/accept/page.tsx using the user's own
// session, since that path is RLS-safe by design (a user inserting
// their own workspace_members row for a workspace_id they were invited to).

import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return NextResponse.json({ error: 'missing_token' }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const serviceKey = (process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY);

  // 1. Verify the token is a real, current session - never trust the
  //    client's claimed user id.
  const anonClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userErr } = await anonClient.auth.getUser(token);
  if (userErr || !userData?.user) {
    return NextResponse.json({ error: 'invalid_token' }, { status: 401 });
  }
  const user = userData.user;

  if (!serviceKey) {
    // No service key configured - nothing to provision, but don't fail the
    // whole login over it.
    return NextResponse.json({ ok: true, skipped: 'no_service_key' });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const nameParts = (user.user_metadata?.full_name || '').split(' ');
  // Register page stores first_name/last_name; Google/Microsoft use given_name/family_name.
  const firstName = user.user_metadata?.first_name || user.user_metadata?.given_name || nameParts[0] || '';
  const lastName = user.user_metadata?.last_name || user.user_metadata?.family_name || nameParts.slice(1).join(' ') || '';
  const avatarUrl = user.user_metadata?.avatar_url || null;

  // Upsert user row (idempotent)
  const { data: existingUser } = await admin
    .from('users').select('id').eq('id', user.id).maybeSingle();

  if (!existingUser) {
    const { error: uErr } = await admin.from('users').insert({
      id: user.id,
      email: user.email!,
      first_name: firstName,
      last_name: lastName,
      avatar_url: avatarUrl,
    });
    if (uErr) console.error('[api/auth/provision] users insert:', uErr.message);
  } else {
    // The auth trigger already created a bare row (id + email only), so
    // fill in the name/avatar here instead of leaving them blank forever.
    const { data: current } = await admin
      .from('users').select('first_name, last_name').eq('id', user.id).maybeSingle();
    const patch: { first_name?: string; last_name?: string; avatar_url?: string } = {};
    if (!current?.first_name && firstName) patch.first_name = firstName;
    if (!current?.last_name && lastName) patch.last_name = lastName;
    if (avatarUrl) patch.avatar_url = avatarUrl;
    if (Object.keys(patch).length) await admin.from('users').update(patch).eq('id', user.id);
  }

  // Ensure the user has at least one workspace. If this login came via an
  // invite, the caller should skip this route (see app/invite/accept),
  // so this only fires for fresh/self signups.
  const { data: wm } = await admin
    .from('workspace_members').select('workspace_id')
    .eq('user_id', user.id).limit(1).maybeSingle();

  if (!wm) {
    const wsName = firstName
      ? `${firstName}'s Workspace`
      : `${user.email!.split('@')[0]}'s Workspace`;

    const { data: ws, error: wsErr } = await admin
      .from('workspaces').insert({ name: wsName, owner_id: user.id, plan: 'free' })
      .select('id').single();

    if (wsErr) {
      console.error('[api/auth/provision] workspace insert:', wsErr.message);
    } else if (ws?.id) {
      await admin.from('workspace_members').insert({
        workspace_id: ws.id,
        user_id: user.id,
        role: 'admin',
      });
      await admin.from('user_preferences').insert({ user_id: user.id });
    }
  }

  return NextResponse.json({ ok: true });
}
