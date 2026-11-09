"use client";
export const dynamic = 'force-dynamic';
// User profile page, personal info, avatar, account details.


import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { User, Mail, Building2, Globe, Save, Check, Eye, EyeOff, ShieldCheck } from "lucide-react";
import { createClient } from "@supabase/supabase-js";
import { zoneOptions, isValidZone, browserZone, applyTimezone } from "@/lib/timezone";
import { checkPassword, isPwned } from "@/lib/password";
import { motion } from "framer-motion";
import { supabase } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/current-user";

type ProfileForm = {
  first_name: string;
  last_name: string;
  email: string;
  organisation: string;
  timezone: string;
};

export default function ProfilePage() {
  const router = useRouter();
  const [form, setForm] = useState<ProfileForm>({ first_name: "", last_name: "", email: "", organisation: "", timezone: "" });
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pwForm, setPwForm] = useState({ current: "", next: "", confirm: "" });
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSaved, setPwSaved] = useState(false);
  const [showPw, setShowPw] = useState(false);

  const load = useCallback(async () => {
    const user = await getCurrentUser();
    if (!user) { router.push("/login"); return; }
    setUserId(user.id);

    const { data: profileRaw } = await supabase
      .from("users")
      .select("first_name, last_name, email, timezone")
      .eq("id", user.id)
      .single();
    const profile = profileRaw;
    // timezone lives on public.users (user_preferences has no timezone column)
    const prefs = profileRaw ? { timezone: profileRaw.timezone } : null;

    // Try to get workspace name as "organisation"
    const { data: wm } = await supabase
      .from("workspace_members")
      .select("workspace_id, workspaces(name)")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle() as { data: { workspace_id: string; workspaces: { name: string } | null } | null };

    setForm({
      first_name: profile?.first_name ?? "",
      last_name: profile?.last_name ?? "",
      email: profile?.email ?? user.email ?? "",
      organisation: wm?.workspaces?.name ?? "",
      timezone: isValidZone(prefs?.timezone) ? prefs!.timezone! : "Australia/Melbourne",
    });
    setLoading(false);
  }, [router]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    if (!userId) return;
    setSaving(true); setError(null);
    const { error: e1 } = await supabase
      .from("users")
      .update({ first_name: form.first_name, last_name: form.last_name, timezone: form.timezone })
      .eq("id", userId);
    setSaving(false);
    if (e1) { setError("Failed to save. Please try again."); return; }
    applyTimezone(form.timezone);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const handlePasswordChange = async () => {
    setPwError(null);
    setPwSaved(false);
    const user = await getCurrentUser();
    if (!user?.email) { setPwError("Could not get current user."); return; }
    if (!pwForm.current) { setPwError("Enter your current password."); return; }
    const problems = checkPassword(pwForm.next, { email: user.email, name: `${form.first_name} ${form.last_name}` });
    if (problems.length) { setPwError(`New password needs: ${problems.join(", ")}.`); return; }
    if (pwForm.next === pwForm.current) { setPwError("New password must be different from your current one."); return; }
    if (pwForm.next !== pwForm.confirm) { setPwError("Passwords don't match."); return; }
    setPwSaving(true);
    try {
      if (await isPwned(pwForm.next)) { setPwError("This password has appeared in a data breach. Choose a different one."); return; }
      // Check the current password on a throwaway client so this session stays as it is.
      const verifier = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
        auth: { persistSession: false, autoRefreshToken: false, storageKey: "cm-verify" },
      });
      const { error: signInErr } = await verifier.auth.signInWithPassword({ email: user.email, password: pwForm.current });
      if (signInErr) { setPwError(/rate|too many/i.test(signInErr.message) ? "Too many attempts. Wait a few minutes and try again." : "Current password is incorrect."); return; }
      await verifier.auth.signOut({ scope: "local" });
      const { error: updateErr } = await supabase.auth.updateUser({ password: pwForm.next });
      if (updateErr) { setPwError(updateErr.message); return; }
      await supabase.auth.signOut({ scope: "others" });
      setPwSaved(true);
      setPwForm({ current: "", next: "", confirm: "" });
    } finally {
      setPwSaving(false);
    }
  };  const initials = [form.first_name[0], form.last_name[0]].filter(Boolean).join("").toUpperCase() || "??";
  const fullName  = [form.first_name, form.last_name].filter(Boolean).join(" ") || "Your Name";

  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "60vh" }}>
      <div className="spinner" />
    </div>
  );

  const FIELDS: { label: string; key: keyof ProfileForm; icon: React.ElementType; readOnly?: boolean }[] = [
    { label: "First name",   key: "first_name",   icon: User },
    { label: "Last name",    key: "last_name",    icon: User },
    { label: "Email",        key: "email",        icon: Mail,      readOnly: true },
    { label: "Organisation", key: "organisation", icon: Building2, readOnly: true },
  ];

  return (
    <div style={{ paddingBottom: "48px" }} className="page-enter">
      {/* Header */}
      <div className="page-header">
        <div>
          <div className="page-header-title">Profile</div>
          <div className="page-header-sub">Manage your personal account settings</div>
        </div>
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saved ? <><Check size={13} /> Saved!</> : saving ? "Saving..." : <><Save size={13} /> Save changes</>}
        </button>
      </div>

      {error && <div style={{ margin: "0 36px", padding: "12px 16px", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "8px", fontSize: "13px", color: "var(--crimson)" }}>{error}</div>}

      <div style={{ padding: "28px 36px", maxWidth: "680px" }} className="page-body">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          style={{ display: "flex", flexDirection: "column", gap: "20px" }}
        >
          {/* Avatar card */}
          <div
            className="liquid-card"
            style={{ padding: "28px", display: "flex", alignItems: "center", gap: "28px" }}
          >
            <div
              className="avatar"
              style={{
                width: "72px",
                height: "72px",
                fontSize: "22px",
                fontFamily: "var(--font-display)",
                fontWeight: 800,
                background: "var(--grad-neural)",
                border: "2px solid rgba(14,165,233,0.35)",
                boxShadow: "0 8px 32px var(--glow-teal)",
                flexShrink: 0,
              }}
            >
              {initials}
            </div>
            <div>
              <h2
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: "20px",
                  fontWeight: 700,
                  color: "var(--text-primary)",
                  marginBottom: "4px",
                }}
              >
                {fullName}
              </h2>
              <p style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "16px" }}>
                {form.organisation || "Your Workspace"}
              </p>
              <div style={{ display: "flex", gap: "8px" }}>
                <button className="btn btn-secondary btn-sm">Change avatar</button>
                <button className="btn btn-ghost btn-sm">Remove</button>
              </div>
            </div>
          </div>

          {/* Personal info form */}
          <div className="liquid-card" style={{ padding: "28px" }}>
            <h3
              style={{
                fontFamily: "var(--font-display)",
                fontSize: "14px",
                fontWeight: 700,
                color: "var(--text-primary)",
                marginBottom: "22px",
              }}
            >
              Personal Information
            </h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "18px" }} className="rg-2">
              {FIELDS.map((f) => {
                const Icon = f.icon;
                return (
                  <div key={f.label}>
                    <label className="form-label" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <Icon size={11} />
                      {f.label}
                    </label>
                    <input
                      type="text"
                      className="form-input"
                      value={form[f.key]}
                      readOnly={f.readOnly}
                      style={f.readOnly ? { opacity: 0.6, cursor: "not-allowed" } : undefined}
                      onChange={e => !f.readOnly && setForm(p => ({ ...p, [f.key]: e.target.value }))}
                    />
                  </div>
                );
              })}
              <div style={{ gridColumn: "1 / -1" }}>
                <label className="form-label" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <Globe size={11} />
                  Timezone
                </label>
                <div style={{ display: "flex", gap: "8px" }}>
                  <select className="form-input" value={form.timezone} onChange={e => setForm(p => ({ ...p, timezone: e.target.value }))}>
                    {zoneOptions().map(z => <option key={z.value} value={z.value}>{z.label}</option>)}
                  </select>
                  <button type="button" className="btn btn-secondary btn-sm" style={{ whiteSpace: "nowrap" }} onClick={() => setForm(p => ({ ...p, timezone: browserZone() }))}>Use this device</button>
                </div>
                <p style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "6px" }}>
                  Meeting times, due dates and reminders are shown in this timezone. Local time there now: {new Date().toLocaleTimeString("en-AU", { timeZone: form.timezone, hour: "2-digit", minute: "2-digit" })}
                </p>
              </div>
            </div>
          </div>

          {/* Change password */}
          <div className="liquid-card" style={{ padding: "28px" }}>
            <h3 style={{ fontFamily: "var(--font-display)", fontSize: "14px", fontWeight: 700, color: "var(--text-primary)", marginBottom: "22px" }}>
              Change Password
            </h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "16px", maxWidth: "400px" }}>
              {([
                { label: "Current password", key: "current" },
                { label: "New password",     key: "next" },
                { label: "Confirm new password", key: "confirm" },
              ] as { label: string; key: keyof typeof pwForm }[]).map(({ label, key }) => (
                <div key={key}>
                  <label className="form-label">{label}</label>
                  <div style={{ position: "relative" }}>
                    <input
                      type={showPw ? "text" : "password"}
                      className="form-input"
                      placeholder="••••••••"
                      value={pwForm[key]}
                      onChange={e => setPwForm(p => ({ ...p, [key]: e.target.value }))}
                      autoComplete={key === "current" ? "current-password" : "new-password"}
                      style={{ paddingRight: "42px" }}
                    />
                    {key === "current" && (
                      <button type="button" onClick={() => setShowPw(v => !v)} aria-label={showPw ? "Hide passwords" : "Show passwords"}
                        style={{ position: "absolute", right: "10px", top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: "4px" }}>
                        {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                      </button>
                    )}
                  </div>
                  {key === "next" && pwForm.next && <Strength value={pwForm.next} email={form.email} name={`${form.first_name} ${form.last_name}`} />}
                </div>
              ))}
              <p style={{ fontSize: "12px", color: "var(--text-muted)", margin: 0, display: "flex", gap: "6px", lineHeight: 1.5 }}>
                <ShieldCheck size={14} style={{ flexShrink: 0, marginTop: "1px" }} />
                At least 12 characters with upper and lower case letters, a number and a symbol. Changing it signs you out on every other device.
              </p>
              {pwError && <p style={{ color: "#ef4444", fontSize: "13px", margin: 0 }}>{pwError}</p>}
              {pwSaved && <p style={{ color: "#10b981", fontSize: "13px", margin: 0 }}>Password updated. Other devices have been signed out.</p>}
              <button
                className="btn btn-secondary btn-sm"
                style={{ alignSelf: "flex-start" }}
                onClick={handlePasswordChange}
                disabled={pwSaving}
              >
                {pwSaving ? "Updating..." : "Update password"}
              </button>
            </div>
          </div>

          {/* Danger zone */}
          <div
            className="liquid-card"
            style={{
              padding: "24px 28px",
              border: "1px solid rgba(239,68,68,0.18)",
              background: "rgba(239,68,68,0.04)",
            }}
          >
            <h3
              style={{
                fontFamily: "var(--font-display)",
                fontSize: "14px",
                fontWeight: 700,
                color: "var(--crimson)",
                marginBottom: "8px",
              }}
            >
              Danger Zone
            </h3>
            <p style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "16px" }}>
              Permanently delete your account and all associated data. This action cannot be undone.
            </p>
            <button className="btn btn-danger btn-sm">Delete account</button>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
function Strength({ value, email, name }: { value: string; email: string; name: string }) {
  const missing = checkPassword(value, { email, name });
  const score = Math.max(0, 5 - missing.length) + (value.length >= 16 ? 1 : 0);
  const pct = Math.min(100, (score / 6) * 100);
  const color = score <= 2 ? "var(--crimson)" : score <= 4 ? "#F59E0B" : "#10B981";
  const label = score <= 2 ? "Weak" : score <= 4 ? "Okay" : "Strong";
  return (
    <div style={{ marginTop: "8px" }}>
      <div style={{ height: "4px", borderRadius: "4px", background: "var(--glass-strong)", overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, transition: "width .25s ease" }} />
      </div>
      <p style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "6px" }}>
        <span style={{ color, fontWeight: 600 }}>{label}</span>{missing.length ? ` · needs ${missing.join(", ")}` : ""}
      </p>
    </div>
  );
}
