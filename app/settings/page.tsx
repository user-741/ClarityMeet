"use client";
export const dynamic = 'force-dynamic';
// Settings: general, security (two-step verification), team and roles, integrations and notifications.


import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Users, Bell, ShieldCheck, Plug, Check, Save, Video, Monitor, MessageCircle, Calendar, Smartphone, Lock, History, Info } from "lucide-react";
import SecurityPanel from "@/app/components/SecurityPanel";
import ActivityLog from "@/app/components/ActivityLog";
import { motion } from "framer-motion";
import { supabase } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/current-user";
import { getFirstWorkspaceId } from "@/lib/workspace";
import { useWorkspace } from "@/app/components/WorkspaceContext";

const TABS = [
  { id: "general",       label: "General",       icon: ShieldCheck },
  { id: "security",      label: "Security",      icon: Lock },
  { id: "team",          label: "Team & Roles",  icon: Users },
  { id: "integrations",  label: "Integrations",  icon: Plug },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "activity",      label: "Activity log",  icon: History },
];

// "calendar" ones connect from the Calendar page; "platform" ones are meeting apps the bot can join.
const INTEGRATIONS = [
  { key: "zoom",    kind: "platform", name: "Zoom",            icon: Video,         desc: "ClarityMeet joins in the Zoom desktop app and records the meeting.", href: "/bot",      action: "Open bot" },
  { key: "meet",    kind: "platform", name: "Google Meet",     icon: Monitor,       desc: "Record Meet calls, and create meetings with a Meet link from the calendar.", href: "/calendar", action: "Open calendar" },
  { key: "teams",   kind: "platform", name: "Microsoft Teams", icon: MessageCircle, desc: "ClarityMeet joins in the Teams desktop app from a meeting link.", href: "/bot",      action: "Open bot" },
  { key: "gcal",    kind: "calendar", name: "Google Calendar", icon: Calendar,      desc: "Sign in with Google to import events and add new meetings to your calendar.", href: "/calendar", action: "Connect" },
  { key: "outlook", kind: "calendar", name: "Outlook",         icon: Calendar,      desc: "Paste your published Outlook calendar link to keep meetings in sync.", href: "/calendar", action: "Connect" },
  { key: "iphone",  kind: "calendar", name: "iPhone / iCloud", icon: Smartphone,    desc: "Sync your iCloud calendar in, and subscribe on your iPhone to see ClarityMeet meetings.", href: "/calendar", action: "Connect" },
];

type TeamMember = {
  id: string;
  user_id: string;
  role: string;
  joined_at: string | null;
  name: string;
  email: string;
};

// Maps UI toggle keys -> actual user_preferences columns
type NotifKey = "email_summaries" | "email_task_reminders" | "email_weekly_digest" | "email_mentions" | "email_bot_status";

const NOTIF_LABELS: Record<NotifKey, { label: string; desc: string }> = {
  email_summaries:      { label: "Meeting summaries",   desc: "Receive AI summary after each meeting" },
  email_task_reminders: { label: "Task reminders",      desc: "Get notified when tasks are due" },
  email_weekly_digest:  { label: "Weekly digest",       desc: "Weekly overview of your team's activity" },
  email_mentions:       { label: "Mentions",            desc: "When someone assigns a task to you" },
  email_bot_status:     { label: "Bot status updates",  desc: "When the meeting bot joins or leaves" },
};

// Bot behaviour maps -> user_preferences bool columns
type BotKey = "bot_auto_join" | "bot_auto_summarise" | "bot_email_participants";
const BOT_LABELS: Record<BotKey, { label: string; desc: string }> = {
  bot_auto_join:         { label: "Join scheduled meetings automatically", desc: "The bot joins Zoom and Teams meetings on the Calendar when they start. Everyone in the call will see it." },
  bot_auto_summarise:    { label: "Summarise as soon as a meeting ends", desc: "Writes the summary and tasks straight away. Turn off to start it yourself from the meeting." },
  bot_email_participants:{ label: "Email the summary to participants", desc: "Sends the summary to everyone in the meeting who has an email address on file." },
};

const Toggle = ({ on, onToggle }: { on: boolean; onToggle: () => void }) => (
  <button className={`toggle ${on ? "toggle-on" : "toggle-off"}`} onClick={onToggle} role="switch" aria-checked={on} style={{ flexShrink: 0 }}>
    <div className="toggle-thumb" />
  </button>
);

export default function SettingsPage() {
  const { activeWorkspace } = useWorkspace();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState("general");
  useEffect(() => {
    const tab = new URLSearchParams(window.location.search).get("tab");
    if (tab && TABS.some(x => x.id === tab)) setActiveTab(tab);
  }, []);
  const [connected, setConnected] = useState<Record<string, boolean>>({});
  const [lastSync, setLastSync]   = useState<Record<string, string | null>>({});

  useEffect(() => {
    (async () => {
      const user = await getCurrentUser();
      if (!user) return;
      const { data } = await supabase.from("calendar_feeds").select("provider").eq("user_id", user.id);
      const providers = new Set((data ?? []).map(r => r.provider as string));
      let google = providers.has("google");
      try { google = google || localStorage.getItem("cm_gcal_connected") === "1"; } catch { /* ignore */ }
      setConnected({ gcal: google, meet: google, outlook: providers.has("outlook"), iphone: providers.has("icloud") });
      const { data: synced } = await supabase.from("calendar_feeds").select("provider, last_synced").eq("user_id", user.id);
      const last: Record<string, string | null> = {};
      for (const r of (synced ?? []) as { provider: string; last_synced: string | null }[]) {
        const k = r.provider === "icloud" ? "iphone" : r.provider === "google" ? "gcal" : r.provider;
        if (!last[k] || (r.last_synced && r.last_synced > (last[k] ?? ""))) last[k] = r.last_synced;
      }
      try { last.gcal = localStorage.getItem("cm_gcal_last") ?? last.gcal ?? null; } catch { /* ignore */ }
      setLastSync(last);
    })();
  }, []);
  const [saved, setSaved]         = useState(false);
  const [baseline, setBaseline]   = useState("");
  const [saving, setSaving]       = useState(false);
  const [userId, setUserId]       = useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [wsName, setWsName]       = useState("");
  const [currentWs, setCurrentWs] = useState<string | null>(null);
  const [adminEmail, setAdminEmail] = useState("");
  const [team, setTeam]           = useState<TeamMember[]>([]);
  const [notifs, setNotifs]       = useState<Record<NotifKey, boolean>>({
    email_summaries: true, email_task_reminders: true, email_weekly_digest: false,
    email_mentions: true, email_bot_status: true,
  });
  const [botPrefs, setBotPrefs]   = useState<Record<BotKey, boolean>>({
    bot_auto_join: true, bot_auto_summarise: true, bot_email_participants: false,
  });
  const [loading, setLoading]     = useState(true);
  const [err, setErr]             = useState<string | null>(null);
  const [currentUserRole, setCurrentUserRole] = useState<string>("member");

  const load = useCallback(async () => {
    const user = await getCurrentUser();
    if (!user) { router.push("/login"); return; }
    setUserId(user.id);

    // Use active workspace from context, fall back to first membership
    const wsId = activeWorkspace?.workspace_id ??
      (await getFirstWorkspaceId(user.id));
    if (!wsId) { setLoading(false); return; }
    setCurrentWs(wsId);

    // Get workspace name and user's role in it
    const { data: wm } = await supabase
      .from("workspace_members")
      .select("workspace_id, workspaces(name), role")
      .eq("user_id", user.id)
      .eq("workspace_id", wsId)
      .maybeSingle() as { data: { workspace_id: string; workspaces: { name: string } | null; role: string } | null };

    if (!wm) { setLoading(false); return; }
    setWorkspaceId(wm.workspace_id);
    setWsName(wm.workspaces?.name ?? "");
    setCurrentUserRole(wm.role);

    // Get admin email from public.users (safe cast)
    const { data: userRowRaw } = await supabase.from("users").select("email").eq("id", user.id).single();
    const userRow = userRowRaw as { email: string | null } | null;
    setAdminEmail(userRow?.email ?? user.email ?? "");

    // Load user preferences using ACTUAL columns
    const { data: prefsRaw } = await supabase
      .from("user_preferences")
      .select("email_summaries, email_task_reminders, email_weekly_digest, email_mentions, email_bot_status, bot_auto_join, bot_auto_summarise, bot_email_participants")
      .eq("user_id", user.id)
      .single();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prefs = prefsRaw as any;
    if (prefs) {
      setNotifs({
        email_summaries:      prefs.email_summaries      ?? true,
        email_task_reminders: prefs.email_task_reminders ?? true,
        email_weekly_digest:  prefs.email_weekly_digest  ?? false,
        email_mentions:       prefs.email_mentions        ?? true,
        email_bot_status:     prefs.email_bot_status      ?? true,
      });
      setBotPrefs({
        bot_auto_join:          prefs.bot_auto_join          ?? true,
        bot_auto_summarise:     prefs.bot_auto_summarise     ?? true,
        bot_email_participants: prefs.bot_email_participants ?? false,
      });
    }

    // Load team members for the active workspace
    const { data: members } = await supabase
      .from("workspace_members")
      .select("id, user_id, role, joined_at, users(first_name, last_name, email)")
      .eq("workspace_id", wsId) as {
        data: Array<{
          id: string;
          user_id: string;
          role: string;
          joined_at: string | null;
          users: { first_name: string | null; last_name: string | null; email: string | null } | null;
        }> | null;
      };

    const teamRows: TeamMember[] = (members ?? []).map(m => {
      const firstName = m.users?.first_name ?? "";
      const lastName  = m.users?.last_name  ?? "";
      const name = [firstName, lastName].filter(Boolean).join(" ") || m.user_id.slice(0, 8);
      const email = m.users?.email ?? "";
      const joinedDate = m.joined_at ? new Date(m.joined_at).toLocaleDateString("en-AU", { month: "short", year: "numeric" }) : "-";
      return { id: m.id, user_id: m.user_id, role: m.role, joined_at: joinedDate, name, email };
    });
    setTeam(teamRows);
    setLoading(false);
    setBaseline("pending");
  }, [router, activeWorkspace]);

  // What was last loaded or saved, to tell whether there is anything to save.
  const snapshot = JSON.stringify({ wsName, notifs, botPrefs });
  useEffect(() => { if (baseline === "pending") setBaseline(snapshot); }, [baseline, snapshot]);
  const dirty = !!baseline && baseline !== "pending" && baseline !== snapshot;

  // Warn before leaving the page with unsaved changes
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  useEffect(() => { load(); }, [load, activeWorkspace]);

  const handleRoleChange = async (memberId: string, newRole: string) => {
    if (currentUserRole !== "admin") return; // double-check client side
    if (newRole !== "admin" && newRole !== "member" && newRole !== "viewer") return;
    const { error } = await supabase
      .from("workspace_members")
      .update({ role: newRole })
      .eq("id", memberId);
    if (error) { setErr(error.message); return; }
    setTeam(prev => prev.map(m => m.id === memberId ? { ...m, role: newRole } : m));
  };

  const handleRemoveMember = async (memberId: string, memberUserId: string) => {
    if (currentUserRole !== "admin") return;
    if (memberUserId === userId) { setErr("You can't remove yourself."); return; }
    if (!confirm("Remove this member from the workspace?")) return;
    const { error } = await supabase
      .from("workspace_members")
      .delete()
      .eq("id", memberId);
    if (error) { setErr(error.message); return; }
    setTeam(prev => prev.filter(m => m.id !== memberId));
  };

  const handleSave = async () => {
    setErr(null);
    setSaving(true);
    try {
      if (workspaceId) {
        const { error: wsErr } = await supabase
          .from("workspaces")
          .update({ name: wsName, updated_at: new Date().toISOString() })
          .eq("id", workspaceId);
        if (wsErr) throw wsErr;
      }
      if (userId) {
        const { error: prefsErr } = await supabase
          .from("user_preferences")
          .upsert(
            {
              user_id: userId,
              ...notifs,   // email_summaries, email_task_reminders, etc.
              ...botPrefs, // bot_auto_join, bot_auto_summarise, etc.
              updated_at: new Date().toISOString(),
            },
            { onConflict: "user_id" }
          );
        if (prefsErr) throw prefsErr;
      }
      setBaseline(snapshot);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to save settings");
    }
    setSaving(false);
  };
  const showSave = activeTab === "general" || activeTab === "notifications";

  return (
    <div style={{ paddingBottom: "48px" }} className="page-enter">
      <style>{ST_CSS}</style>
      <div className="page-header">
        <div>
          <div className="page-header-title">Settings</div>
          <div className="page-header-sub">Manage workspace, team, and integrations</div>
        </div>
        {showSave && (
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            {err ? <span className="st-msg err">{err}</span>
              : saved ? <span className="st-msg ok"><Check size={13} /> Changes saved</span>
              : dirty ? <span className="st-msg">Unsaved changes</span> : <span className="st-msg idle">All changes saved</span>}
            <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={!dirty || saving}>
              <Save size={13} /> {saving ? "Saving..." : "Save changes"}
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "60vh" }}><div className="spinner" /></div>
      ) : (
      <div style={{ display: "flex", padding: "24px 36px", gap: "24px" }} className="page-body settings-wrap">
        {/* Tab list */}
        <div style={{ width: "180px", flexShrink: 0 }} className="settings-tabs">
          <div style={{ display: "flex", flexDirection: "column", gap: "2px" }} className="settings-tabs-list">
            {TABS.map(tab => {
              const Icon = tab.icon;
              return (
                <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`nav-link ${activeTab === tab.id ? "active" : ""}`}>
                  <span className="nav-link-icon"><Icon size={14} /></span>
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Content */}
        <div style={{ flex: 1, minWidth: 0, maxWidth: "780px" }}>
          <motion.div key={activeTab} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.2 }}>

            {/* GENERAL */}
            {activeTab === "general" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <section className="data-card st-card">
                  <h3>Workspace details</h3>
                  <div className="st-grid">
                    <label>Workspace name
                      <input type="text" className="form-input" value={wsName} onChange={e => setWsName(e.target.value)} disabled={currentUserRole !== "admin"} />
                      {currentUserRole !== "admin" && <span className="st-help">Only admins can rename the workspace.</span>}
                    </label>
                    <div className="st-readonly">
                      <span>Admin email</span>
                      <div>{adminEmail || "-"}</div>
                      <span className="st-help">Workspace administrator · change it from your account</span>
                    </div>
                  </div>
                </section>

                <section className="data-card st-card">
                  <h3>Meeting automation</h3>
                  <div className="st-group">Automation</div>
                  {(["bot_auto_join", "bot_auto_summarise"] as BotKey[]).map(key => (
                    <div key={key} className="st-row">
                      <div><div className="st-row-title">{BOT_LABELS[key].label}</div><div className="st-row-desc">{BOT_LABELS[key].desc}</div></div>
                      <Toggle on={botPrefs[key]} onToggle={() => setBotPrefs(p => ({ ...p, [key]: !p[key] }))} />
                    </div>
                  ))}
                  <div className="st-group">Sharing</div>
                  <div className="st-row">
                    <div><div className="st-row-title">{BOT_LABELS.bot_email_participants.label}</div><div className="st-row-desc">{BOT_LABELS.bot_email_participants.desc}</div></div>
                    <Toggle on={botPrefs.bot_email_participants} onToggle={() => setBotPrefs(p => ({ ...p, bot_email_participants: !p.bot_email_participants }))} />
                  </div>
                  <div className="st-tip">
                    <Info size={14} />
                    <span>If a meeting has a waiting room or a passcode, the host needs to admit &ldquo;ClarityMeet&rdquo;. If the bot can&apos;t get in, nothing is recorded, and you can upload the recording on the Upload page instead.</span>
                  </div>
                </section>

                <section className="data-card st-card st-privacy">
                  <div className="st-privacy-head"><ShieldCheck size={16} /><h3>Recording and privacy</h3></div>
                  <ul>
                    <li>The bot joins visibly under the name &ldquo;ClarityMeet&rdquo;. Tell everyone in the meeting that it is being recorded.</li>
                    <li>Recordings, transcripts and summaries are only visible to members of this workspace.</li>
                    <li>They are kept until the meeting is deleted. The owner of a meeting or an admin can delete it at any time.</li>
                  </ul>
                  <Link href="/privacy" className="st-privacy-link">View privacy policy</Link>
                </section>
              </div>
            )}

            {activeTab === "activity" && <ActivityLog workspaceId={currentWs} />}

            {/* SECURITY */}
            {activeTab === "security" && <SecurityPanel />}

            {/* TEAM */}
            {activeTab === "team" && (
              <div className="data-card">
                <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--glass-border)", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px" }}>
                  <div>
                    <h3 style={{ fontFamily: "var(--font-display)", fontSize: "15px", fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>Team members</h3>
                    <p className="st-row-desc" style={{ marginTop: "4px" }}><b>Admin</b> manages members and settings. <b>Member</b> records meetings and edits tasks. <b>Viewer</b> can only read.</p>
                  </div>
                  {currentUserRole === "admin" && <Link href="/invite" className="btn btn-primary btn-sm" style={{ textDecoration: "none", whiteSpace: "nowrap" }}>Invite member</Link>}
                </div>
                <table className="data-table">
                  <thead><tr><th>Member</th><th>Role</th><th>Joined</th><th>Actions</th></tr></thead>
                  <tbody>
                    {team.length === 0 ? (
                      <tr><td colSpan={4} style={{ textAlign: "center", color: "var(--text-muted)", padding: "32px" }}>No team members found</td></tr>
                    ) : team.map(m => (
                      <tr key={m.id}>
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                            <div className="avatar avatar-sm">{m.name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0,2)}</div>
                            <div>
                              <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-primary)" }}>{m.name}</div>
                              <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>{m.email}</div>
                            </div>
                          </div>
                        </td>
                        <td>
                          {currentUserRole === "admin" && m.user_id !== userId ? (
                            <select
                              className="form-select"
                              value={m.role}
                              onChange={e => handleRoleChange(m.id, e.target.value)}
                              style={{ width: "auto", fontSize: "12px", padding: "4px 28px 4px 8px" }}
                            >
                              <option value="admin">admin</option>
                              <option value="member">member</option>
                              <option value="viewer">viewer</option>
                            </select>
                          ) : (
                            <span style={{ fontSize: "12px", color: "var(--text-secondary)", textTransform: "capitalize" }}>{m.role}</span>
                          )}
                        </td>
                        <td style={{ fontSize: "13px" }}>{m.joined_at}</td>
                        <td>
                          {currentUserRole === "admin" && m.user_id !== userId ? (
                            <button className="btn btn-danger btn-sm" onClick={() => handleRemoveMember(m.id, m.user_id)}>Remove</button>
                          ) : (
                            <span style={{ fontSize: "12px", color: "var(--text-disabled)" }}>-</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* INTEGRATIONS */}
            {activeTab === "integrations" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                {([["calendar", "Calendars", "Bring meetings in from your calendar, or show ClarityMeet meetings on your phone. Managed on the Calendar page."], ["platform", "Meeting platforms", "Apps the bot can join to record a meeting. Nothing to connect, just paste a link."]] as const).map(([kind, title, intro]) => (
                  <section key={kind} className="data-card st-card">
                    <h3>{title}</h3>
                    <p className="st-intro">{intro}</p>
                    {INTEGRATIONS.filter(i => i.kind === kind).map(intg => {
                      const Icon = intg.icon;
                      const on = kind === "calendar" ? !!connected[intg.key] : true;
                      return (
                        <div key={intg.key} className="st-row">
                          <div style={{ display: "flex", gap: "12px", alignItems: "flex-start", minWidth: 0 }}>
                            <span className="st-icon"><Icon size={16} /></span>
                            <div style={{ minWidth: 0 }}>
                              <div className="st-row-title">{intg.name}
                                <span className={`st-badge ${kind === "platform" ? "info" : on ? "ok" : ""}`}>{kind === "platform" ? "Supported" : on ? "Connected" : "Not connected"}</span>
                              </div>
                              <div className="st-row-desc">{intg.desc}{kind === "calendar" && on && lastSync[intg.key] ? ` Last synced ${new Date(lastSync[intg.key] as string).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}.` : ""}</div>
                            </div>
                          </div>
                          <Link href={intg.href} className="btn btn-secondary btn-sm" style={{ textDecoration: "none", whiteSpace: "nowrap" }}>
                            {kind === "platform" ? "Send bot" : on ? "Manage" : "Connect"}
                          </Link>
                        </div>
                      );
                    })}
                  </section>
                ))}
              </div>
            )}

            {/* NOTIFICATIONS */}
            {activeTab === "notifications" && (
              <section className="data-card st-card">
                <h3>Email notifications</h3>
                <p className="st-intro">You always get in-app notifications. These control what is also sent to {adminEmail || "your email"}.</p>
                {(Object.keys(notifs) as NotifKey[]).map(key => (
                  <div key={key} className="st-row">
                    <div><div className="st-row-title">{NOTIF_LABELS[key].label}</div><div className="st-row-desc">{NOTIF_LABELS[key].desc}</div></div>
                    <Toggle on={notifs[key]} onToggle={() => setNotifs(n => ({ ...n, [key]: !n[key] }))} />
                  </div>
                ))}
              </section>
            )}

          </motion.div>
        </div>
      </div>
      )}
    </div>
  );
}

const ST_CSS = `
.st-card { padding: 18px 22px; }
.st-card h3 { font-size: 15px; font-weight: 700; color: var(--text-primary); margin: 0 0 4px; }
.st-intro { font-size: 13px; color: var(--text-muted); margin: 0 0 6px; line-height: 1.5; }
.st-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 12px; }
@media (max-width: 700px) { .st-grid { grid-template-columns: 1fr; } }
.st-grid label { display: flex; flex-direction: column; gap: 6px; font-size: 12px; font-weight: 600; color: var(--text-muted); }
.st-grid input:disabled { opacity: 0.6; cursor: not-allowed; }
.st-help { font-size: 11px; font-weight: 400; }
.st-row { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 12px 0; border-top: 1px solid var(--glass-border); }
.st-row:first-of-type { border-top: 0; }
.st-intro + .st-row { border-top: 0; }
.st-row-title { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 14px; font-weight: 600; color: var(--text-primary); }
.st-row-desc { font-size: 12.5px; color: var(--text-secondary); margin-top: 3px; line-height: 1.5; max-width: 560px; }
.st-icon { width: 32px; height: 32px; border-radius: 50%; background: rgba(127,127,127,0.12); color: var(--text-secondary); display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
.st-badge { font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 999px; color: var(--text-muted); border: 1px solid var(--glass-border); }
.st-badge.ok { color: var(--emerald-pulse); border-color: rgba(16,185,129,0.4); }
.st-badge.info { color: #38BDF8; border-color: rgba(14,165,233,0.4); }
.st-note p { font-size: 13px; color: var(--text-secondary); line-height: 1.6; margin: 6px 0 0; }
.st-note a { color: #38BDF8; }
.st-msg { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--amber-alert); }
.st-msg.ok { color: var(--emerald-pulse); }
.st-msg.err { color: var(--crimson); }
.st-msg.idle { color: var(--text-muted); }
.st-readonly { display: flex; flex-direction: column; gap: 6px; font-size: 12px; font-weight: 600; color: var(--text-muted); }
.st-readonly div { display: flex; align-items: center; height: 40px; padding: 0 12px; border-radius: 8px; background: rgba(127,127,127,0.08); color: var(--text-primary); font-size: 14px; font-weight: 500; }
.st-group { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); margin: 14px 0 2px; }
.st-group + .st-row { border-top: 0; }
.st-tip { display: flex; gap: 10px; align-items: flex-start; margin-top: 12px; padding: 10px 12px; border-radius: 8px; background: rgba(127,127,127,0.07); font-size: 12px; color: var(--text-secondary); line-height: 1.5; }
.st-tip svg { color: var(--text-muted); flex-shrink: 0; margin-top: 1px; }
.st-privacy { border-color: rgba(16,185,129,0.3); background: rgba(16,185,129,0.04); }
.st-privacy-head { display: flex; align-items: center; gap: 8px; }
.st-privacy-head svg { color: var(--emerald-pulse); }
.st-privacy-head h3 { margin: 0; }
.st-privacy ul { margin: 10px 0 10px; padding-left: 18px; display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: var(--text-secondary); line-height: 1.5; }
.st-privacy-link { font-size: 13px; font-weight: 600; color: #38BDF8; text-decoration: none; }
.st-privacy-link:hover { text-decoration: underline; }
.page-header .btn-primary:disabled { opacity: 0.45; cursor: not-allowed; box-shadow: none; }
`;
