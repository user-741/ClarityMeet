"use client";
export const dynamic = "force-dynamic";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader, AlertCircle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { logLogin } from "@/lib/auth-fetch";

function sanitizeNext(nextParam: string | null) {
  const fallback = "/dashboard";
  if (!nextParam) return fallback;

  try {
    if (nextParam.startsWith("http://") || nextParam.startsWith("https://")) {
      const url = new URL(nextParam);
      if (typeof window !== "undefined" && url.origin === window.location.origin) {
        return `${url.pathname}${url.search}${url.hash}`;
      }
      return fallback;
    }

    if (!nextParam.startsWith("/") || nextParam.startsWith("//") || nextParam.startsWith("/\\")) return fallback;
    return nextParam;
  } catch {
    return fallback;
  }
}

function readHashTokens() {
  if (typeof window === "undefined") {
    return { access_token: null, refresh_token: null, raw: "" };
  }

  const raw = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;

  const hashParams = new URLSearchParams(raw);

  return {
    access_token: hashParams.get("access_token"),
    refresh_token: hashParams.get("refresh_token"),
    raw,
  };
}

async function waitForStableSession(timeoutMs = 4000) {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const { data, error } = await supabase.auth.getSession();
    if (!error && data.session?.user) {
      return data.session;
    }
    await new Promise((r) => setTimeout(r, 120));
  }

  return null;
}

function CallbackInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const run = async () => {
      const errorParam = searchParams.get("error");
      if (errorParam) {
        const desc = searchParams.get("error_description") || errorParam;
        router.replace(`/login?error=${encodeURIComponent(desc)}`);
        return;
      }

      const next = sanitizeNext(searchParams.get("next"));
      const code = searchParams.get("code");

      let accessToken: string | null = null;

      if (code) {
        const { data, error: exchangeError } =
          await supabase.auth.exchangeCodeForSession(code);

        if (exchangeError || !data.session) {
          setError(exchangeError?.message || "Could not complete sign-in.");
          return;
        }

        accessToken = data.session.access_token;
      } else {
        let { access_token, refresh_token, raw } = readHashTokens();

        if (!access_token || !refresh_token) {
          await new Promise((r) => setTimeout(r, 200));
          ({ access_token, refresh_token, raw } = readHashTokens());
        }

        if (!access_token || !refresh_token) {
          console.error("[auth/callback] no usable hash tokens", {
            href: typeof window !== "undefined" ? window.location.href : "",
            hash_raw: raw,
            has_access_token: !!access_token,
            has_refresh_token: !!refresh_token,
          });
          setError("This sign-in link is missing or has expired. Please request a new one.");
          return;
        }

        const { data, error: setSessionError } = await supabase.auth.setSession({
          access_token,
          refresh_token,
        });

        if (setSessionError || !data.session) {
          console.error("[auth/callback] setSession failed", setSessionError);
          setError(setSessionError?.message || "Could not complete sign-in.");
          return;
        }

        accessToken = data.session.access_token;

        window.history.replaceState(
          {},
          "",
          `${window.location.pathname}${window.location.search}`
        );
      }

      const stableSession = await waitForStableSession();

      if (!stableSession?.user || !accessToken) {
        setError("Could not establish a session.");
        return;
      }

      const isInviteFlow = next.startsWith("/invite/accept");

      if (!isInviteFlow) {
        try {
          await fetch("/api/auth/provision", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          });
        } catch {
          // non-fatal
        }
      }

      await logLogin();
      window.location.assign(next);
    };

    run().catch((err) => {
      console.error("[auth/callback] unexpected error", err);
      setError("Something went wrong finishing sign-in.");
    });
  }, [router, searchParams]);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--bg-base)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "40px 20px",
      }}
    >
      <div style={{ width: "100%", maxWidth: "420px", textAlign: "center" }}>
        {error ? (
          <>
            <div
              style={{
                width: "56px",
                height: "56px",
                borderRadius: "50%",
                background: "rgba(239,68,68,0.12)",
                border: "1px solid rgba(239,68,68,0.25)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                margin: "0 auto 20px",
              }}
            >
              <AlertCircle size={24} color="#ef4444" />
            </div>

            <h2 style={{ fontSize: "18px", fontWeight: 600, marginBottom: "8px" }}>
              Sign-in failed
            </h2>
            <p
              style={{
                color: "var(--text-muted)",
                fontSize: "14px",
                marginBottom: "20px",
              }}
            >
              {error}
            </p>
            <button className="btn btn-primary" onClick={() => router.push("/login")}>
              Go to Login
            </button>
          </>
        ) : (
          <>
            <Loader
              size={24}
              style={{ animation: "spin 1s linear infinite", margin: "0 auto 16px" }}
            />
            <p style={{ color: "var(--text-muted)", fontSize: "14px" }}>
              Signing you in...
            </p>
          </>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={null}>
      <CallbackInner />
    </Suspense>
  );
}