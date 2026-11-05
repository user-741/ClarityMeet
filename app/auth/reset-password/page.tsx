"use client";
export const dynamic = "force-dynamic";

// Landing page for the "Forgot password?" email link (see app/login/page.tsx).
// Establishes the recovery session from the link, then lets the user set a new password.

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader, AlertCircle, CheckCircle2 } from "lucide-react";
import { supabase } from "@/lib/supabase";

type Stage = "verifying" | "ready" | "saving" | "done" | "error";

function ResetInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const ran = useRef(false);
  const [stage, setStage] = useState<Stage>("verifying");
  const [error, setError] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const run = async () => {
      const code = searchParams.get("code");
      if (code) {
        const { error: e } = await supabase.auth.exchangeCodeForSession(code);
        if (e) { setError(e.message); setStage("error"); return; }
      } else {
        const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
        const access_token = hash.get("access_token");
        const refresh_token = hash.get("refresh_token");
        if (access_token && refresh_token) {
          const { error: e } = await supabase.auth.setSession({ access_token, refresh_token });
          if (e) { setError(e.message); setStage("error"); return; }
          window.history.replaceState({}, "", window.location.pathname);
        }
      }
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        setError("This reset link is missing or has expired. Request a new one from the login page.");
        setStage("error");
        return;
      }
      setStage("ready");
    };
    run().catch(() => { setError("Something went wrong opening the reset link."); setStage("error"); });
  }, [searchParams]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (password !== confirm) { setError("Passwords do not match."); return; }
    setStage("saving");
    const { error: e2 } = await supabase.auth.updateUser({ password });
    if (e2) { setError(e2.message); setStage("ready"); return; }
    setStage("done");
    setTimeout(() => router.replace("/dashboard"), 1500);
  };

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-base)", display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 20px" }}>
      <div className="liquid-card" style={{ width: "100%", maxWidth: "420px", padding: "40px" }}>
        {stage === "verifying" && (
          <div style={{ textAlign: "center" }}>
            <Loader size={24} style={{ animation: "spin 1s linear infinite", margin: "0 auto 16px" }} />
            <p style={{ color: "var(--text-muted)", fontSize: "14px" }}>Checking your reset link...</p>
          </div>
        )}

        {stage === "error" && (
          <div style={{ textAlign: "center" }}>
            <AlertCircle size={28} color="#ef4444" style={{ margin: "0 auto 16px" }} />
            <h2 style={{ fontSize: "18px", fontWeight: 600, marginBottom: "8px" }}>Reset failed</h2>
            <p style={{ color: "var(--text-muted)", fontSize: "14px", marginBottom: "20px" }}>{error}</p>
            <button className="btn btn-primary" style={{ width: "100%" }} onClick={() => router.push("/login")}>Back to login</button>
          </div>
        )}

        {stage === "done" && (
          <div style={{ textAlign: "center" }}>
            <CheckCircle2 size={28} color="#10b981" style={{ margin: "0 auto 16px" }} />
            <h2 style={{ fontSize: "18px", fontWeight: 600, marginBottom: "8px" }}>Password updated</h2>
            <p style={{ color: "var(--text-muted)", fontSize: "14px" }}>Taking you to your dashboard...</p>
          </div>
        )}

        {(stage === "ready" || stage === "saving") && (
          <form onSubmit={submit}>
            <h2 style={{ fontSize: "20px", fontWeight: 600, marginBottom: "20px" }}>Choose a new password</h2>
            <label className="form-label">New password</label>
            <input type="password" className="form-input" value={password} onChange={e => setPassword(e.target.value)}
              autoComplete="new-password" required style={{ marginBottom: "14px" }} />
            <label className="form-label">Confirm password</label>
            <input type="password" className="form-input" value={confirm} onChange={e => setConfirm(e.target.value)}
              autoComplete="new-password" required style={{ marginBottom: "14px" }} />
            {error && <p style={{ color: "#ef4444", fontSize: "13px", marginBottom: "14px" }}>{error}</p>}
            <button type="submit" className="btn btn-primary" style={{ width: "100%" }} disabled={stage === "saving"}>
              {stage === "saving" ? "Saving..." : "Update password"}
            </button>
          </form>
        )}
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetInner />
    </Suspense>
  );
}
