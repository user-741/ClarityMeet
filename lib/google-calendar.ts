const SCOPE = "https://www.googleapis.com/auth/calendar.events";
const KEY = "cm_gcal_token";

type TokenResponse = { access_token?: string; expires_in?: number; error?: string; error_description?: string };
type TokenClient = { requestAccessToken: (o?: { prompt?: string }) => void };
type GoogleAccounts = {
  oauth2: {
    initTokenClient: (cfg: {
      client_id: string;
      scope: string;
      callback: (r: TokenResponse) => void;
      error_callback?: (e: { type: string; message?: string }) => void;
    }) => TokenClient;
  };
};

export const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "544395491570-21qbtd8dmrja4f4pgf7k9mdfme7gkl6j.apps.googleusercontent.com";

function loadScript(): Promise<GoogleAccounts> {
  const w = window as unknown as { google?: { accounts?: GoogleAccounts } };
  if (w.google?.accounts?.oauth2) return Promise.resolve(w.google.accounts);
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = () => (w.google?.accounts ? resolve(w.google.accounts) : reject(new Error("Google sign-in did not load")));
    s.onerror = () => reject(new Error("Could not load Google sign-in"));
    document.head.appendChild(s);
  });
}

export function cachedGoogleToken(): string | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const { token, exp } = JSON.parse(raw) as { token: string; exp: number };
    return Date.now() < exp - 60_000 ? token : null;
  } catch {
    return null;
  }
}

export function clearGoogleToken() {
  try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
}

export async function getGoogleToken(forcePrompt = false): Promise<string> {
  if (!GOOGLE_CLIENT_ID) throw new Error("Google Calendar is not set up on this site yet.");
  if (!forcePrompt) {
    const cached = cachedGoogleToken();
    if (cached) return cached;
  }
  const accounts = await loadScript();
  return new Promise((resolve, reject) => {
    const client = accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: SCOPE,
      callback: (r) => {
        if (!r.access_token) { reject(new Error(r.error_description || r.error || "Google did not grant access")); return; }
        try {
          sessionStorage.setItem(KEY, JSON.stringify({ token: r.access_token, exp: Date.now() + (r.expires_in ?? 3600) * 1000 }));
        } catch { /* ignore */ }
        resolve(r.access_token);
      },
      error_callback: (e) => reject(new Error(e.type === "popup_closed" ? "Google window was closed" : e.message || "Google sign-in failed")),
    });
    client.requestAccessToken({ prompt: forcePrompt ? "consent" : "" });
  });
}
