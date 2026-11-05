"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Check, Mail, Smartphone } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { safeNextPath } from "@/lib/auth-fetch";
import { getMfaStatus, sendEmailCode, verifyEmailCode, verifyAppCode, type MfaStatus } from "@/lib/mfa-client";

function MfaInner() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNextPath(params.get("next"));

  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [method, setMethod] = useState<"app" | "email">("app");
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const autoSent = useRef(false);

  const send = useCallback(async (to: string) => {
    setError("");
    try {
      await sendEmailCode(to);
      setSent(true);
      setCooldown(60);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send a code");
    }
  }, []);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) { router.replace(`/login?next=${encodeURIComponent(next)}`); return; }
      const s = await getMfaStatus();
      if (!s || !s.enabled || s.verified) { router.replace(next); return; }
      const to = data.session.user.email ?? "";
      setEmail(to);
      setStatus(s);
      const m = s.app ? "app" : "email";
      setMethod(m);
      if (m === "email" && !autoSent.current) { autoSent.current = true; send(to); }
    })();
  }, [router, next, send]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (code.replace(/\D/g, "").length !== 6) { setError("Enter the 6-digit code."); return; }
    setBusy(true);
    setError("");
    try {
      if (method === "app") await verifyAppCode(code);
      else await verifyEmailCode(email, code, "confirm-email");
      setDone(true);
      setTimeout(() => router.replace(next), 600);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That code is not right.");
      setBusy(false);
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    router.replace("/login");
  };

  const masked = email.replace(/^(.{2})[^@]*/, "$1***");

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 16px", background: "var(--bg-base)" }}>
      <div className="neural-bg"><div className="neural-bg-grid" /></div>
      <div className="liquid-card" style={{ position: "relative", zIndex: 1, width: "100%", maxWidth: "400px", padding: "32px" }}>
        <Link href="/" style={{ display: "inline-flex", alignItems: "center", gap: "10px", textDecoration: "none", marginBottom: "28px" }}>
          <div className="logo-mark">C</div>
          <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "16px", color: "var(--text-primary)" }}>ClarityMeet</span>
        </Link>

        <h1 style={{ fontFamily: "var(--font-display)", fontSize: "24px", fontWeight: 800, color: "var(--text-primary)", marginBottom: "8px" }}>
          {method === "app" ? "Enter your app code" : "Check your email"}
        </h1>
        <p style={{ color: "var(--text-secondary)", fontSize: "14px", marginBottom: "24px", display: "flex", gap: "8px", lineHeight: 1.5 }}>
          {method === "app" ? <Smartphone size={16} style={{ marginTop: 2, flexShrink: 0 }} /> : <Mail size={16} style={{ marginTop: 2, flexShrink: 0 }} />}
          <span>
            {method === "app"
              ? "Open your authenticator app and enter the 6-digit code for ClarityMeet."
              : sent ? <>We sent a 6-digit code to <strong style={{ color: "var(--text-primary)" }}>{masked}</strong>.</> : "Sending your code..."}
          </span>
        </p>

        <form onSubmit={verify} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <input
            className="form-input"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={7}
            placeholder="123456"
            value={code}
            onChange={e => setCode(e.target.value.replace(/[^\d ]/g, ""))}
            style={{ fontSize: "22px", letterSpacing: "8px", textAlign: "center" }}
            autoFocus
          />
          {error && <p style={{ fontSize: "13px", color: "var(--crimson)" }}>{error}</p>}
          <button className="btn btn-primary" type="submit" disabled={busy || !status} style={{ justifyContent: "center" }}>
            {done ? <><Check size={15} /> Verified</> : busy ? "Checking..." : <>Continue <ArrowRight size={15} /></>}
          </button>
        </form>

        <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", marginTop: "18px", fontSize: "13px", flexWrap: "wrap" }}>
          {method === "email" ? (
            <button type="button" className="link-btn" onClick={() => send(email)} disabled={cooldown > 0}>
              {cooldown > 0 ? `Resend in ${cooldown}s` : "Send a new code"}
            </button>
          ) : status?.email ? (
            <button type="button" className="link-btn" onClick={() => { setMethod("email"); setCode(""); if (!sent) send(email); }}>
              Email me a code instead
            </button>
          ) : <span />}
          <button type="button" className="link-btn muted" onClick={signOut}>Use another account</button>
        </div>
      </div>
      <style>{`
        .link-btn { background: none; border: none; padding: 0; cursor: pointer; color: var(--electric-teal); font-weight: 600; font-size: 13px; }
        .link-btn:disabled { color: var(--text-muted); cursor: default; }
        .link-btn.muted { color: var(--text-muted); font-weight: 500; }
      `}</style>
    </div>
  );
}

export default function MfaPage() {
  return (
    <Suspense fallback={null}>
      <MfaInner />
    </Suspense>
  );
}
