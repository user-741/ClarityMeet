import { createClient, type User } from '@supabase/supabase-js';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { NextRequest, NextResponse } from 'next/server';

export const COOKIE = 'cm_mfa';
const OTP_WINDOW_MS = 15 * 60 * 1000;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

type Amr = { method: string; timestamp: number };
export type Session = { user: User; sessionId: string; aal: string; amr: Amr[] };

export function admin() {
  return createClient(SUPABASE_URL, (process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY)!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function secret() {
  return process.env.MFA_SECRET
    || createHash('sha256').update(`claritymeet-mfa:${process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''}`).digest('hex');
}

export async function sessionFrom(req: NextRequest): Promise<Session | null> {
  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;
  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await anon.auth.getUser(token);
  if (error || !data.user) return null;
  try {
    const p = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    if (!p.session_id) return null;
    return { user: data.user, sessionId: String(p.session_id), aal: String(p.aal || 'aal1'), amr: Array.isArray(p.amr) ? p.amr : [] };
  } catch {
    return null;
  }
}

export function emailEnabled(user: User) {
  return (user.app_metadata as Record<string, unknown> | undefined)?.mfa_email === true;
}

export function appEnabled(user: User) {
  return (user.factors ?? []).some(f => f.factor_type === 'totp' && f.status === 'verified');
}

export function mfaEnabled(user: User) {
  return emailEnabled(user) || appEnabled(user);
}

export function recentEmailCode(s: Session) {
  return s.amr.some(m => m.method === 'otp' && Date.now() - m.timestamp * 1000 < OTP_WINDOW_MS);
}

function sign(userId: string, sessionId: string) {
  return `${sessionId}.${createHmac('sha256', secret()).update(`${userId}.${sessionId}`).digest('base64url')}`;
}

export function isVerified(req: NextRequest, s: Session) {
  if (s.aal === 'aal2') return true;
  const given = Buffer.from(req.cookies.get(COOKIE)?.value || '');
  const want = Buffer.from(sign(s.user.id, s.sessionId));
  return given.length === want.length && timingSafeEqual(given, want);
}

export function setVerified(res: NextResponse, s: Session) {
  res.cookies.set(COOKIE, sign(s.user.id, s.sessionId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function setEmailMfa(user: User, on: boolean) {
  const meta = (user.app_metadata ?? {}) as Record<string, unknown>;
  const { error } = await admin().auth.admin.updateUserById(user.id, { app_metadata: { ...meta, mfa_email: on } });
  if (error) throw new Error(error.message);
}
