// Proxy all /api/backend/* requests to the Express backend.
// Backend URL is fetched at runtime from Supabase app_config table (key='backend_url').
// This means you can update the tunnel URL in Supabase without redeploying.
//
// SETUP - when tunnel URL changes:
//   Option A: Update app_config row in Supabase dashboard
//     UPDATE app_config SET value = 'https://new-tunnel.trycloudflare.com' WHERE key = 'backend_url';
//   Option B: Update BACKEND_URL env var in Vercel (requires redeploy to take effect)

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sessionFrom, mfaEnabled, isVerified } from "@/lib/mfa-server";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SUPABASE_SERVICE_KEY = (process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY)!;

// Every request into this proxy must carry a valid Supabase session -
// otherwise this route is an open, unauthenticated door straight into
// the backend, bypassing all frontend/RLS checks entirely.
async function requireUser(req: NextRequest) {
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (token) {
    const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await anon.auth.getUser(token);
    return error || !data.user ? null : data.user;
  }

  return null;
}

// Cache the backend URL in-memory for 60s to avoid hitting Supabase on every request
let cachedBackend: string | null = null;
let cacheExpiry = 0;

async function getBackendUrl(): Promise<string> {
  const now = Date.now();

  // Return cached value if still fresh
  if (cachedBackend && now < cacheExpiry) {
    return cachedBackend;
  }

  // Try Supabase app_config first (runtime-updatable without redeploy)
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/app_config?key=eq.backend_url&select=value&limit=1`,
      {
        headers: {
          "apikey": SUPABASE_SERVICE_KEY,
          "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
        },
        signal: AbortSignal.timeout(3000),
      }
    );
    if (res.ok) {
      const rows = await res.json() as { value: string }[];
      if (rows.length > 0 && rows[0].value) {
        cachedBackend = rows[0].value.replace(/\/$/, "");
        cacheExpiry = now + 60_000; // cache for 60s
        return cachedBackend;
      }
    }
  } catch {
    // fall through to env var fallback
  }

  // Fallback to env var (baked at deploy time)
  const envUrl = (
    process.env.BACKEND_URL ??
    process.env.NEXT_PUBLIC_BACKEND_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    "http://localhost:3001"
  ).replace(/\/$/, "");

  cachedBackend = envUrl;
  cacheExpiry = now + 60_000;
  return envUrl;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { path: string[] } }
) {
  return proxy(req, params.path, "GET");
}

export async function POST(
  req: NextRequest,
  { params }: { params: { path: string[] } }
) {
  return proxy(req, params.path, "POST");
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { path: string[] } }
) {
  return proxy(req, params.path, "DELETE");
}

async function proxy(req: NextRequest, path: string[], method: string) {
  const user = await requireUser(req);
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const session = await sessionFrom(req);
  if (session && mfaEnabled(session.user) && !isVerified(req, session)) {
    return NextResponse.json({ error: "verification_required" }, { status: 403 });
  }

  const BACKEND = await getBackendUrl();
  const target = `${BACKEND}/${path.join("/")}${req.nextUrl.search}`;

  try {
    const init: RequestInit = {
      method,
      headers: {
        "Content-Type": "application/json",
        "ngrok-skip-browser-warning": "true", // skip ngrok interstitial page
        "x-claritymeet-proxy": "1",           // identify requests from proxy
        // Pass the user's token on so the backend can verify who is calling.
        "Authorization": req.headers.get("authorization") ?? "",
      },
      signal: AbortSignal.timeout(30_000), // 30s - transcription can take time
    };

    if (method === "POST") {
      try { init.body = await req.text(); } catch { /* no body */ }
    }

    const upstream = await fetch(target, init);
    const text = await upstream.text();

    return new NextResponse(text, {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("content-type") ?? "application/json" },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "proxy error";
    // Return a structured error so the frontend can detect backend-not-running
    return NextResponse.json(
      { error: msg, backend_url: BACKEND, hint: "Update backend_url in Supabase app_config table" },
      { status: 502 }
    );
  }
}
