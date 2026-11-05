"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { safeNextPath } from "@/lib/auth-fetch";
import { zoneOptions, browserZone, isValidZone, applyTimezone } from "@/lib/timezone";
import { getMfaStatus } from "@/lib/mfa-client";

function WelcomeInner() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNextPath(params.get("next"));

  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [tz, setTz] = useState("Australia/Melbourne");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      const user = data.session?.user;
      if (!user) { router.replace(`/login?next=${encodeURIComponent(next)}`); return; }
      const mfa = await getMfaStatus();
      if (mfa?.enabled && !mfa.verified) { router.replace(`/mfa?next=${encodeURIComponent(`/welcome?next=${next}`)}`); return; }
      setUserId(user.id);
      setEmail(user.email ?? "");
      const meta = user.user_metadata ?? {};
      const { data: row } = await supabase.from("users").select("first_name, last_name, timezone").eq("id", user.id).maybeSingle();
      const local = (user.email ?? "").split("@")[0].toLowerCase();
      const full = String(meta.full_name ?? meta.name ?? "").trim().split(/\s+/);
      const rowFirst = row?.first_name && row.first_name.toLowerCase() !== local ? row.first_name : "";
      setFirst(rowFirst || meta.given_name || meta.first_name || (full.length > 1 ? full[0] : ""));
      setLast(row?.last_name || meta.family_name || meta.last_name || (full.length > 1 ? full.slice(1).join(" ") : ""));
      const guess = isValidZone(row?.timezone) ? row!.timezone! : browserZone();
      setTz(isValidZone(guess) ? guess : "Australia/Melbourne");
    })();
  }, [router, next]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const f = first.trim(), l = last.trim();
    if (!f || !l) { setError("Please enter your first and last name."); return; }
    if (f.length > 60 || l.length > 60) { setError("Names must be 60 characters or fewer."); return; }
    if (!userId) return;
    setBusy(true);
    setError("");
    const { error: err } = await supabase.from("users").update({ first_name: f, last_name: l, timezone: tz }).eq("id", userId);
    if (err) { setError("Could not save your details. Please try again."); setBusy(false); return; }
    await supabase.auth.updateUser({ data: { first_name: f, last_name: l } });
    applyTimezone(tz);
    router.replace(next);
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 16px", background: "var(--bg-base)" }}>
      <div className="neural-bg"><div className="neural-bg-grid" /></div>
      <div className="liquid-card" style={{ position: "relative", zIndex: 1, width: "100%", maxWidth: "440px", padding: "32px" }}>
        <Link href="/" style={{ display: "inline-flex", alignItems: "center", gap: "10px", textDecoration: "none", marginBottom: "28px" }}>
          <div className="logo-mark">C</div>
          <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "16px", color: "var(--text-primary)" }}>ClarityMeet</span>
        </Link>
        <h1 style={{ fontFamily: "var(--font-display)", fontSize: "24px", fontWeight: 800, color: "var(--text-primary)", marginBottom: "8px" }}>Finish setting up</h1>
        <p style={{ color: "var(--text-secondary)", fontSize: "14px", marginBottom: "24px", lineHeight: 1.5 }}>
          Check your name so teammates can find you and tasks are assigned to the right person.
        </p>
        <form onSubmit={save} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <div>
              <label className="form-label" htmlFor="wf">First name</label>
              <input id="wf" className="form-input" value={first} onChange={e => setFirst(e.target.value)} placeholder="John" autoComplete="given-name" autoFocus />
            </div>
            <div>
              <label className="form-label" htmlFor="wl">Last name</label>
              <input id="wl" className="form-input" value={last} onChange={e => setLast(e.target.value)} placeholder="Doe" autoComplete="family-name" />
            </div>
          </div>
          <div>
            <label className="form-label" htmlFor="we">Email</label>
            <input id="we" className="form-input" value={email} readOnly style={{ opacity: 0.6 }} />
          </div>
          <div>
            <label className="form-label" htmlFor="wt">Timezone</label>
            <select id="wt" className="form-input" value={tz} onChange={e => setTz(e.target.value)}>
              {zoneOptions().map(z => <option key={z.value} value={z.value}>{z.label}</option>)}
            </select>
          </div>
          {error && <p style={{ fontSize: "13px", color: "var(--crimson)" }}>{error}</p>}
          <button className="btn btn-primary" type="submit" disabled={busy || !userId} style={{ justifyContent: "center" }}>
            {busy ? "Saving..." : <>Continue <ArrowRight size={15} /></>}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function WelcomePage() {
  return (
    <Suspense fallback={null}>
      <WelcomeInner />
    </Suspense>
  );
}
