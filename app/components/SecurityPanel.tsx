"use client";

import { useCallback, useEffect, useState } from "react";
import { Mail, Smartphone, Check } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { authFetch } from "@/lib/auth-fetch";
import { getMfaStatus, sendEmailCode, verifyEmailCode, type MfaStatus } from "@/lib/mfa-client";

type Enroll = { factorId: string; qr: string; secret: string };

const row: React.CSSProperties = { display: "flex", alignItems: "flex-start", gap: "14px", padding: "18px 0", borderTop: "1px solid var(--glass-border)" };

export default function SecurityPanel() {
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const [emailStep, setEmailStep] = useState<"idle" | "sent">("idle");
  const [emailCode, setEmailCode] = useState("");

  const [enroll, setEnroll] = useState<Enroll | null>(null);
  const [appCode, setAppCode] = useState("");

  const load = useCallback(async () => {
    const { data } = await supabase.auth.getUser();
    setEmail(data.user?.email ?? "");
    setStatus(await getMfaStatus());
  }, []);

  useEffect(() => { load(); }, [load]);

  const run = async (fn: () => Promise<void>, done?: string) => {
    setBusy(true); setMsg(null);
    try { await fn(); if (done) setMsg({ ok: true, text: done }); }
    catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : "Something went wrong" }); }
    finally { setBusy(false); }
  };

  const startEmail = () => run(async () => { await sendEmailCode(email); setEmailStep("sent"); });
  const confirmEmail = () => run(async () => {
    await verifyEmailCode(email, emailCode, "enable-email");
    setEmailStep("idle"); setEmailCode("");
    await load();
  }, "Email codes are on.");
  const stopEmail = () => run(async () => {
    const res = await authFetch("/api/mfa", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "disable-email" }) });
    if (!res.ok) throw new Error((await res.json()).error || "Could not turn it off");
    await load();
  }, "Email codes are off.");

  const startApp = () => run(async () => {
    const { data: list } = await supabase.auth.mfa.listFactors();
    for (const f of list?.all ?? []) if (f.factor_type === "totp" && f.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: f.id });
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `ClarityMeet ${Date.now()}` });
    if (error) throw new Error(error.message);
    setEnroll({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
  });
  const confirmApp = () => run(async () => {
    if (!enroll) return;
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: enroll.factorId, code: appCode.replace(/\D/g, "") });
    if (error) throw new Error("That code is not right. Check the time on your phone and try again.");
    setEnroll(null); setAppCode("");
    await load();
  }, "Authenticator app is on.");
  const stopApp = () => run(async () => {
    const { data } = await supabase.auth.mfa.listFactors();
    for (const f of data?.totp ?? []) {
      const { error } = await supabase.auth.mfa.unenroll({ factorId: f.id });
      if (error) throw new Error(error.message);
    }
    await supabase.auth.refreshSession();
    await load();
  }, "Authenticator app removed.");

  if (!status) return <div className="liquid-card" style={{ padding: "28px" }}><div className="spinner" /></div>;

  const codeInput = (value: string, set: (v: string) => void) => (
    <input className="form-input" inputMode="numeric" autoComplete="one-time-code" maxLength={7} placeholder="123456"
      value={value} onChange={e => set(e.target.value.replace(/[^\d ]/g, ""))} style={{ maxWidth: "160px", letterSpacing: "4px" }} />
  );

  return (
    <div className="liquid-card" style={{ padding: "28px" }}>
      <h3 style={{ fontFamily: "var(--font-display)", fontSize: "15px", fontWeight: 700, color: "var(--text-primary)", marginBottom: "6px" }}>Two-step verification</h3>
      <p style={{ fontSize: "13px", color: "var(--text-muted)", lineHeight: 1.6, marginBottom: "10px", maxWidth: "56ch" }}>
        After you sign in with your password or Google, ClarityMeet asks for a one-time code.
      </p>

      <div style={row}>
        <Smartphone size={18} style={{ marginTop: 2, color: "var(--text-primary)" }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-primary)" }}>Authenticator app</div>
          <div style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "3px" }}>Google Authenticator, Microsoft Authenticator or similar. Works offline.</div>
          {enroll && (
            <div style={{ marginTop: "14px", display: "flex", gap: "18px", flexWrap: "wrap", alignItems: "flex-start" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={enroll.qr} alt="QR code for your authenticator app" width={160} height={160} style={{ background: "#fff", borderRadius: "8px", padding: "6px" }} />
              <div style={{ display: "flex", flexDirection: "column", gap: "10px", fontSize: "12px", color: "var(--text-secondary)" }}>
                <span>Scan the code in your app, then enter the 6-digit code it shows.</span>
                <span>Can&apos;t scan? Enter this key: <code style={{ color: "var(--text-primary)", wordBreak: "break-all" }}>{enroll.secret}</code></span>
                <div style={{ display: "flex", gap: "8px" }}>
                  {codeInput(appCode, setAppCode)}
                  <button className="btn btn-primary btn-sm" onClick={confirmApp} disabled={busy || appCode.replace(/\D/g, "").length !== 6}><Check size={13} /> Turn on</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setEnroll(null)}>Cancel</button>
                </div>
              </div>
            </div>
          )}
        </div>
        {!enroll && (status.app
          ? <button className="btn btn-ghost btn-sm" onClick={stopApp} disabled={busy} style={{ color: "var(--crimson)" }}>Remove</button>
          : <button className="btn btn-primary btn-sm" onClick={startApp} disabled={busy}>Set up</button>)}
      </div>

      <div style={row}>
        <Mail size={18} style={{ marginTop: 2, color: "var(--text-primary)" }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-primary)" }}>Email code</div>
          <div style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "3px" }}>A code is sent to {email || "your email"}.</div>
          {emailStep === "sent" && (
            <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
              {codeInput(emailCode, setEmailCode)}
              <button className="btn btn-primary btn-sm" onClick={confirmEmail} disabled={busy || emailCode.replace(/\D/g, "").length !== 6}><Check size={13} /> Turn on</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setEmailStep("idle")}>Cancel</button>
            </div>
          )}
        </div>
        {emailStep === "idle" && (status.email
          ? <button className="btn btn-ghost btn-sm" onClick={stopEmail} disabled={busy} style={{ color: "var(--crimson)" }}>Turn off</button>
          : <button className="btn btn-primary btn-sm" onClick={startEmail} disabled={busy}>Set up</button>)}
      </div>

      {msg && <p style={{ marginTop: "8px", fontSize: "13px", color: msg.ok ? "var(--emerald-pulse)" : "var(--crimson)" }}>{msg.text}</p>}
    </div>
  );
}
