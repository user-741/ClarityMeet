// Fetch wrapper that attaches the current Supabase access token.
// Every call to /api/backend/* and /api/calendar/* must go through this,
// because those routes reject requests without a valid bearer token.
import { supabase } from "./supabase";

export async function authFetch(input: string, init: RequestInit = {}) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}

// Only allow same-site relative paths ("/x"), never "//evil.com" or "/\evil.com",
// which browsers treat as links to another site.
export function safeNextPath(raw: string | null | undefined, fallback = "/dashboard") {
  if (!raw) return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return fallback;
  return raw;
}

// Make sure a freshly signed-in user has a profile row and a default workspace.
export async function provisionCurrentUser() {
  try {
    await authFetch("/api/auth/provision", { method: "POST" });
  } catch {
    // non-fatal
  }
}
