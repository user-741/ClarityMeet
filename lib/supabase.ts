import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error("Missing Supabase environment variables. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.");
}

// Singleton - reuse across the app.
export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession:     true,
    // IMPORTANT: false, not true. app/auth/callback/page.tsx already handles
    // both the PKCE (?code=) and magic-link (#access_token) flows manually.
    // If this is true, the SDK auto-detects + strips the URL hash the
    // instant ANY code calls into this client (e.g. ClientLayout's
    // getSession() on mount) - which races the callback page's own manual
    // hash parsing and can consume/clear the tokens before it gets a turn,
    // producing a false "sign-in link expired" error on a fresh link.
    detectSessionInUrl: false,
    autoRefreshToken:   true,
    storageKey:         "cm-auth",
  },
});
