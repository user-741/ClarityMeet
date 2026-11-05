"use client";
export const dynamic = 'force-dynamic';
// Registration - light/dark mode safe, checks duplicate email before signUp.


import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Eye, EyeOff, ArrowRight, CheckCircle2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import AuthSidePanel from "@/app/components/AuthSidePanel";
import "@/app/landing.css";
import { provisionCurrentUser } from "@/lib/auth-fetch";
import { buildAppUrl } from "@/lib/app-url";

export default function RegisterPage() {
  const [firstName, setFirstName] = useState("");
  const [lastName,  setLastName]  = useState("");
  const [email,     setEmail]     = useState("");
  const [password,  setPassword]  = useState("");
  const [confirm,   setConfirm]   = useState("");
  const [showPw,    setShowPw]    = useState(false);
  const [error,     setError]     = useState("");
  const [loading,   setLoading]   = useState(false);
  const [done,      setDone]      = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!firstName.trim() || !lastName.trim()) { setError("Please enter your full name."); return; }
    if (password !== confirm) { setError("Passwords do not match."); return; }
    if (password.length < 8)  { setError("Password must be at least 8 characters."); return; }
    setLoading(true);

    // Check duplicate email in public.users
    const { data: existing } = await supabase
      .from("users").select("id").eq("email", email.toLowerCase().trim()).maybeSingle();
    if (existing) {
      setError("An account with this email already exists. Try signing in instead.");
      setLoading(false);
      return;
    }

    const { data, error: authError } = await supabase.auth.signUp({
      email: email.toLowerCase().trim(),
      password,
      options: {
        data: { first_name: firstName.trim(), last_name: lastName.trim() },
        emailRedirectTo: buildAppUrl("/login?confirmed=1"),
      },
    });

    if (authError) {
      const m = authError.message?.toLowerCase() ?? "";
      if (m.includes("already registered") || m.includes("already exists") || m.includes("duplicate") || m.includes("unique"))
        setError("An account with this email already exists. Try signing in instead.");
      else if (m.includes("failed to fetch"))
        setError("Connection error - check your internet and try again.");
      else
        setError(authError.message);
      setLoading(false);
      return;
    }

    if (data.session) { await provisionCurrentUser(); router.push("/dashboard"); }
    else setDone(true);
    setLoading(false);
  };

  // "Check your inbox" screen
  if (done) {
    return (
      <div style={{ minHeight: "100vh", background: "var(--bg-base)", display: "flex", alignItems: "center", justifyContent: "center", position: "relative", overflow: "hidden" }}>
        <div className="neural-bg"><div className="neural-bg-grid" /></div>
        <div className="liquid-card" style={{ padding: "48px 40px", maxWidth: "420px", width: "100%", textAlign: "center", position: "relative", zIndex: 1 }}>
          <div style={{ width: "72px", height: "72px", borderRadius: "50%", background: "rgba(16,185,129,0.12)", border: "2px solid rgba(16,185,129,0.3)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 24px" }}>
            <CheckCircle2 size={34} color="var(--emerald-pulse)" />
          </div>
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: "26px", fontWeight: 800, color: "var(--text-primary)", marginBottom: "12px" }}>
            Confirm your email
          </h1>
          <p style={{ color: "var(--text-secondary)", fontSize: "14px", lineHeight: 1.75, marginBottom: "12px" }}>
            We sent a confirmation link to
          </p>
          <div style={{ background: "var(--glass-white)", border: "1px solid var(--glass-border)", borderRadius: "var(--radius-md)", padding: "12px 18px", marginBottom: "24px" }}>
            <strong style={{ color: "var(--electric-teal)", fontSize: "14px", wordBreak: "break-all" }}>{email}</strong>
          </div>
          <p style={{ color: "var(--text-muted)", fontSize: "13px", lineHeight: 1.7, marginBottom: "32px" }}>
            Click the link in the email to activate your account. Check spam if you don&apos;t see it within a minute.
          </p>
          <Link href="/login" className="btn btn-primary" style={{ justifyContent: "center", padding: "12px 28px", textDecoration: "none", display: "inline-flex" }}>
            Go to sign in <ArrowRight size={15} style={{ marginLeft: "8px" }} />
          </Link>
          <p style={{ color: "var(--text-muted)", fontSize: "12px", marginTop: "20px" }}>
            Didn&apos;t receive it?{" "}
            <button
              onClick={() => supabase.auth.resend({ type: "signup", email })}
              style={{ background: "none", border: "none", color: "var(--electric-teal)", cursor: "pointer", fontSize: "12px", fontWeight: 600, fontFamily: "var(--font-body)" }}
            >
              Resend email
            </button>
          </p>
        </div>
      </div>
    );
  }

  // Registration form
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-base)", display: "flex", position: "relative", overflow: "hidden" }}>
      <div className="neural-bg"><div className="neural-bg-grid" /></div>

      {/* Left: Form */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", padding: "48px 40px", position: "relative", zIndex: 1, maxWidth: "520px" }}>
        <div style={{ width: "100%", maxWidth: "380px" }}>
          <Link href="/" style={{ display: "inline-flex", alignItems: "center", gap: "10px", textDecoration: "none", marginBottom: "48px" }}>
            <div className="logo-mark">C</div>
            <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "16px", color: "var(--text-primary)" }}>ClarityMeet</span>
          </Link>

          <h1 style={{ fontFamily: "var(--font-display)", fontSize: "30px", fontWeight: 800, color: "var(--text-primary)", marginBottom: "8px", letterSpacing: "-0.5px" }}>
            Create account
          </h1>
          <p style={{ color: "var(--text-secondary)", fontSize: "15px", marginBottom: "32px" }}>
            Start your free workspace today
          </p>

          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div style={{ display: "flex", gap: "12px" }}>
              <div style={{ flex: 1 }}>
                <label className="form-label">First name</label>
                <input className="form-input" value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="John" required autoFocus />
              </div>
              <div style={{ flex: 1 }}>
                <label className="form-label">Last name</label>
                <input className="form-input" value={lastName} onChange={e => setLastName(e.target.value)} placeholder="Doe" required />
              </div>
            </div>

            <div>
              <label className="form-label">Email address</label>
              <input type="email" className="form-input" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" required autoComplete="email" />
            </div>

            <div>
              <label className="form-label">Password</label>
              <div style={{ position: "relative" }}>
                <input
                  type={showPw ? "text" : "password"} className="form-input"
                  value={password} onChange={e => setPassword(e.target.value)}
                  placeholder="Min. 8 characters" required style={{ paddingRight: "44px" }}
                  autoComplete="new-password"
                />
                <button type="button" onClick={() => setShowPw(!showPw)}
                  style={{ position: "absolute", right: "14px", top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", display: "flex" }}>
                  {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              {password.length > 0 && (
                <div style={{ display: "flex", gap: "4px", marginTop: "8px" }}>
                  {[1,2,3,4].map(i => (
                    <div key={i} style={{
                      flex: 1, height: "3px", borderRadius: "2px",
                      background: i <= Math.min(Math.floor(password.length / 3), 4)
                        ? i <= 1 ? "#ef4444" : i <= 2 ? "#f59e0b" : i <= 3 ? "#3b82f6" : "#10b981"
                        : "var(--glass-border)",
                      transition: "background 200ms",
                    }} />
                  ))}
                </div>
              )}
            </div>

            <div>
              <label className="form-label">Confirm password</label>
              <input
                type={showPw ? "text" : "password"} className="form-input"
                value={confirm} onChange={e => setConfirm(e.target.value)}
                placeholder="Repeat password" required autoComplete="new-password"
                style={{ borderColor: confirm.length > 0 && confirm !== password ? "#ef4444" : undefined }}
              />
              {confirm.length > 0 && confirm !== password && (
                <p style={{ fontSize: "12px", color: "#ef4444", marginTop: "5px" }}>Passwords don&apos;t match</p>
              )}
            </div>

            {error && (
              <div className="banner-error">
                {error}
                {error.includes("already exists") && (
                  <> {" "}<Link href="/login" style={{ color: "var(--electric-teal)", fontWeight: 600 }}>Sign in instead <ArrowRight size={13} style={{ verticalAlign: "-2px" }} /></Link></>
                )}
              </div>
            )}

            <button
              type="submit" className="btn btn-primary"
              style={{ justifyContent: "center", padding: "13px", fontSize: "14px", marginTop: "4px", opacity: loading ? 0.7 : 1 }}
              disabled={loading}
            >
              {loading ? (
                <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span className="spin-ring" style={{ borderTopColor: "white" }} />
                  Creating account...
                </span>
              ) : (
                <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  Create account <ArrowRight size={15} />
                </span>
              )}
            </button>
          </form>

          <p style={{ textAlign: "center", marginTop: "24px", fontSize: "13px", color: "var(--text-muted)" }}>
            Already have an account?{" "}
            <Link href="/login" style={{ color: "var(--electric-teal)", textDecoration: "none", fontWeight: 600 }}>Sign in</Link>
          </p>
        </div>
      </div>

      <AuthSidePanel heading="Stop taking notes in meetings." />

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @media (max-width: 900px) { .hide-mobile { display: none !important; } }

        .spin-ring {
          display: inline-block; width: 16px; height: 16px; border-radius: 50%;
          border: 2px solid var(--spin-track); animation: spin 0.7s linear infinite; flex-shrink: 0;
        }
        .banner-error {
          background: var(--banner-error-bg); border: 1px solid var(--banner-error-border);
          border-radius: var(--radius-md); padding: 12px 14px;
          font-size: 13px; color: var(--banner-error-text); line-height: 1.5;
        }
        .login-right-panel {
          flex: 1; background: var(--right-panel-bg);
          border-left: 1px solid var(--glass-border);
          display: flex; flex-direction: column; justify-content: center;
          padding: 64px 56px; position: relative; z-index: 1;
        }
      `}</style>
    </div>
  );
}
