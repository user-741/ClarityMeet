"use client";
export const dynamic = "force-dynamic";

import { useState, useEffect, Suspense, useMemo } from "react";
import type React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Eye, EyeOff, ArrowRight } from "lucide-react";
import { supabase } from "@/lib/supabase";
import AuthSidePanel from "@/app/components/AuthSidePanel";
import "@/app/landing.css";
import { safeNextPath, provisionCurrentUser, authFetch, logLogin } from "@/lib/auth-fetch";
import { buildAppUrl } from "@/lib/app-url";

function GoogleIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

const MICROSOFT_ENABLED = process.env.NEXT_PUBLIC_ENABLE_MICROSOFT_LOGIN === "true";

function MicrosoftIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 23 23">
      <rect x="1" y="1" width="10" height="10" fill="#F25022" />
      <rect x="12" y="1" width="10" height="10" fill="#7FBA00" />
      <rect x="1" y="12" width="10" height="10" fill="#00A4EF" />
      <rect x="12" y="12" width="10" height="10" fill="#FFB900" />
    </svg>
  );
}


function safeNext(raw: string | null) {
  return safeNextPath(raw);
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh", background: "var(--bg-base)" }} />}>
      <LoginInner />
    </Suspense>
  );
}

function LoginInner() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [oauthLoading, setOAuthLoading] = useState<"google" | "azure" | null>(null);

  const router = useRouter();
  const searchParams = useSearchParams();

  const nextPath = useMemo(() => safeNext(searchParams.get("next")), [searchParams]);
  const callbackUrl = useMemo(
    () => buildAppUrl(`/auth/callback?next=${encodeURIComponent(nextPath)}`),
    [nextPath]
  );

  useEffect(() => {
    const urlError = searchParams.get("error");
    const confirmed = searchParams.get("confirmed");
    if (urlError) setError(decodeURIComponent(urlError));
    if (confirmed) setInfo("Email confirmed - you can sign in now.");
  }, [searchParams]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setInfo("");

    if (!email.trim() || !password) {
      setError("Please enter your email and password.");
      return;
    }

    setLoading(true);

    try {
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });

      if (authError) {
        const m = authError.message;
        if (m.includes("Invalid login credentials")) {
          setError("Incorrect email or password.");
        } else if (m.includes("Email not confirmed")) {
          setError("Please confirm your email first - check your inbox.");
        } else if (m.includes("Failed to fetch")) {
          setError("Connection error - check your internet and try again.");
        } else {
          setError(m);
        }
      } else {
        // Password logins skip /auth/callback, so create the default
        if (!nextPath.startsWith("/invite/accept")) await provisionCurrentUser();
        await logLogin();
        let dest = nextPath;
        try {
          const res = await authFetch("/api/mfa");
          if (res.ok) {
            const s = await res.json();
            if (s.enabled && !s.verified) dest = `/mfa?next=${encodeURIComponent(nextPath)}`;
          }
        } catch {
        }
        router.replace(dest);
      }
    } catch {
      setError("Connection error - check your internet and try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setError("");
    setOAuthLoading("google");

    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: callbackUrl,
          queryParams: { access_type: "offline", prompt: "consent" },
        },
      });

      if (error) {
        setError(error.message);
        setOAuthLoading(null);
      }
    } catch {
      setError("Could not start Google sign-in. Try again.");
      setOAuthLoading(null);
    }
  };

  const handleMicrosoft = async () => {
    setError("");
    setOAuthLoading("azure");

    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "azure",
        options: {
          redirectTo: callbackUrl,
          scopes: "openid profile email User.Read",
        },
      });

      if (error) {
        setError(error.message);
        setOAuthLoading(null);
      }
    } catch {
      setError("Could not start Microsoft sign-in. Try again.");
      setOAuthLoading(null);
    }
  };

  const handleForgot = async () => {
    if (!email.trim()) {
      setError("Enter your email above first.");
      return;
    }

    setLoading(true);

    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: buildAppUrl("/auth/reset-password"),
    });

    setLoading(false);

    if (error) setError(error.message);
    else setResetSent(true);
  };

  const registerHref = `/register?next=${encodeURIComponent(nextPath)}`;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--bg-base)",
        display: "flex",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div className="neural-bg">
        <div className="neural-bg-grid" />
      </div>

      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          padding: "48px 40px",
          position: "relative",
          zIndex: 1,
          maxWidth: "520px",
        }}
      >
        <div style={{ width: "100%", maxWidth: "380px" }}>
          <Link
            href="/"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "10px",
              textDecoration: "none",
              marginBottom: "48px",
            }}
          >
            <div className="logo-mark">C</div>
            <span
              style={{
                fontFamily: "var(--font-display)",
                fontWeight: 700,
                fontSize: "16px",
                color: "var(--text-primary)",
              }}
            >
              ClarityMeet
            </span>
          </Link>

          <h1
            style={{
              fontFamily: "var(--font-display)",
              fontSize: "30px",
              fontWeight: 800,
              color: "var(--text-primary)",
              marginBottom: "8px",
              letterSpacing: "-0.5px",
            }}
          >
            Welcome back
          </h1>

          <p
            style={{
              color: "var(--text-secondary)",
              fontSize: "15px",
              marginBottom: "32px",
            }}
          >
            Sign in to your workspace
          </p>

          {info && <div className="banner-success" style={{ marginBottom: "20px" }}>{info}</div>}

          {resetSent && (
            <div className="banner-success" style={{ marginBottom: "20px" }}>
              Password reset link sent - check your inbox.
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "20px" }}>
            <button
              onClick={handleGoogle}
              disabled={!!oauthLoading}
              className="oauth-btn"
              style={{ opacity: oauthLoading && oauthLoading !== "google" ? 0.5 : 1 }}
            >
              {oauthLoading === "google" ? (
                <span className="spin-ring" style={{ borderTopColor: "#4285F4" }} />
              ) : (
                <GoogleIcon />
              )}
              Continue with Google
            </button>

            {MICROSOFT_ENABLED && (
            <button
              onClick={handleMicrosoft}
              disabled={!!oauthLoading}
              className="oauth-btn"
              style={{ opacity: oauthLoading && oauthLoading !== "azure" ? 0.5 : 1 }}
            >
              {oauthLoading === "azure" ? (
                <span className="spin-ring" style={{ borderTopColor: "#0078D4" }} />
              ) : (
                <MicrosoftIcon />
              )}
              Continue with Microsoft
            </button>
            )}
          </div>

          <div className="divider-label" style={{ marginBottom: "20px" }}>
            or continue with email
          </div>

          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div>
              <label className="form-label">Email address</label>
              <input
                type="email"
                className="form-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                required
                autoComplete="email"
              />
            </div>

            <div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "8px",
                }}
              >
                <label className="form-label" style={{ margin: 0 }}>
                  Password
                </label>

                <button
                  type="button"
                  onClick={handleForgot}
                  style={{
                    fontSize: "12px",
                    color: "var(--electric-teal)",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    padding: 0,
                    fontFamily: "var(--font-body)",
                    fontWeight: 600,
                  }}
                >
                  Forgot?
                </button>
              </div>

              <div style={{ position: "relative" }}>
                <input
                  type={showPw ? "text" : "password"}
                  className="form-input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  style={{ paddingRight: "44px" }}
                  autoComplete="current-password"
                />

                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  style={{
                    position: "absolute",
                    right: "14px",
                    top: "50%",
                    transform: "translateY(-50%)",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "var(--text-muted)",
                    display: "flex",
                  }}
                >
                  {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            {error && <div className="banner-error">{error}</div>}

            <button
              type="submit"
              className="btn btn-primary"
              style={{ justifyContent: "center", padding: "13px", fontSize: "14px", opacity: loading ? 0.7 : 1 }}
              disabled={loading || !!oauthLoading}
            >
              {loading ? (
                <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span className="spin-ring" style={{ borderTopColor: "white" }} />
                  Signing in...
                </span>
              ) : (
                <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  Sign in <ArrowRight size={15} />
                </span>
              )}
            </button>
          </form>

          <p
            style={{
              textAlign: "center",
              marginTop: "24px",
              fontSize: "13px",
              color: "var(--text-muted)",
            }}
          >
            No account?{" "}
            <Link
              href={registerHref}
              style={{
                color: "var(--electric-teal)",
                textDecoration: "none",
                fontWeight: 600,
              }}
            >
              Start for free
            </Link>
          </p>
        </div>
      </div>

      <AuthSidePanel heading="Your meetings, already written up." />

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @media (max-width: 900px) { .hide-mobile { display: none !important; } }

        .oauth-btn {
          display: flex; align-items: center; justify-content: center; gap: 10px;
          padding: 11px 18px; border-radius: var(--radius-md); cursor: pointer;
          background: var(--oauth-bg); border: 1px solid var(--oauth-border);
          color: var(--text-primary); font-size: 14px; font-weight: 600;
          transition: background 200ms, border-color 200ms, box-shadow 200ms;
          font-family: var(--font-body); width: 100%;
        }
        .oauth-btn:hover:not(:disabled) {
          background: var(--oauth-bg-hover);
          border-color: var(--oauth-border-hover);
          box-shadow: var(--oauth-shadow);
        }
        .oauth-btn:disabled { cursor: not-allowed; }

        .spin-ring {
          display: inline-block; width: 16px; height: 16px; border-radius: 50%;
          border: 2px solid var(--spin-track);
          animation: spin 0.7s linear infinite; flex-shrink: 0;
        }

        .banner-success {
          background: var(--banner-success-bg); border: 1px solid var(--banner-success-border);
          border-radius: var(--radius-md); padding: 12px 14px;
          font-size: 13px; color: var(--banner-success-text); line-height: 1.5;
        }
        .banner-error {
          background: var(--banner-error-bg); border: 1px solid var(--banner-error-border);
          border-radius: var(--radius-md); padding: 12px 14px;
          font-size: 13px; color: var(--banner-error-text); line-height: 1.5;
        }

        .login-right-panel {
          flex: 1;
          background: var(--right-panel-bg);
          border-left: 1px solid var(--glass-border);
          display: flex; flex-direction: column; justify-content: center;
          padding: 64px 56px; position: relative; z-index: 1;
        }
        .login-info-box {
          padding: 20px;
          background: var(--info-box-bg);
          border: 1px solid var(--info-box-border);
          border-radius: var(--radius-md);
        }

        :root {
          --oauth-bg: rgba(255,255,255,0.05);
          --oauth-bg-hover: rgba(255,255,255,0.09);
          --oauth-border: rgba(255,255,255,0.12);
          --oauth-border-hover: rgba(255,255,255,0.22);
          --oauth-shadow: 0 4px 16px rgba(0,0,0,0.2);
          --spin-track: rgba(255,255,255,0.18);

          --banner-success-bg: rgba(16,185,129,0.08);
          --banner-success-border: rgba(16,185,129,0.25);
          --banner-success-text: #6EE7B7;
          --banner-error-bg: rgba(239,68,68,0.08);
          --banner-error-border: rgba(239,68,68,0.2);
          --banner-error-text: #FCA5A5;

          --right-panel-bg: rgba(14,21,37,0.7);
          --info-box-bg: rgba(14,165,233,0.06);
          --info-box-border: rgba(14,165,233,0.15);
        }

        html.light {
          --oauth-bg: #FFFFFF;
          --oauth-bg-hover: #F5F7FC;
          --oauth-border: rgba(0,0,0,0.12);
          --oauth-border-hover: rgba(14,165,233,0.4);
          --oauth-shadow: 0 4px 16px rgba(0,0,0,0.08);
          --spin-track: rgba(0,0,0,0.12);

          --banner-success-bg: rgba(16,185,129,0.08);
          --banner-success-border: rgba(16,185,129,0.3);
          --banner-success-text: #065F46;
          --banner-error-bg: rgba(239,68,68,0.06);
          --banner-error-border: rgba(239,68,68,0.25);
          --banner-error-text: #B91C1C;

          --right-panel-bg: rgba(238,241,248,0.85);
          --info-box-bg: rgba(14,165,233,0.06);
          --info-box-border: rgba(14,165,233,0.2);
        }
      `}</style>
    </div>
  );
}