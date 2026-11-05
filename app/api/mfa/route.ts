import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  sessionFrom, emailEnabled, appEnabled, mfaEnabled, isVerified, setVerified, recentEmailCode, setEmailMfa,
} from '@/lib/mfa-server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const s = await sessionFrom(req);
  if (!s) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  return NextResponse.json({
    enabled: mfaEnabled(s.user),
    email: emailEnabled(s.user),
    app: appEnabled(s.user),
    verified: !mfaEnabled(s.user) || isVerified(req, s),
  });
}

export async function POST(req: NextRequest) {
  const s = await sessionFrom(req);
  if (!s) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const { action } = await req.json().catch(() => ({})) as { action?: string };

  try {
    // Called right after the user entered an email code (verifyOtp)
    if (action === 'confirm-email' || action === 'enable-email') {
      if (!recentEmailCode(s)) return NextResponse.json({ error: 'Enter the code from your email first.' }, { status: 400 });
      if (action === 'enable-email') await setEmailMfa(s.user, true);
      const res = NextResponse.json({ ok: true });
      setVerified(res, s);
      return res;
    }

    if (action === 'disable-email') {
      if (!isVerified(req, s)) return NextResponse.json({ error: 'Verify this sign-in first.' }, { status: 403 });
      await setEmailMfa(s.user, false);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Something went wrong' }, { status: 500 });
  }
}
