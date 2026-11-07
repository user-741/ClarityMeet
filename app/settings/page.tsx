"use client";
export const dynamic = 'force-dynamic';
// Settings: general, security (two-step verification), team and roles, integrations and notifications.


import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Users, Bell, ShieldCheck, Plug, Check, Save, Video, Monitor, MessageCircle, Calendar, Smartphone, Lock, History } from "lucide-react";
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

const INTEGRATIONS = [
  { key: "zoom",    name: "Zoom",            icon: Video,         desc: "ClarityMeet joins in the Zoom desktop app and records the meeting.", href: "/bot",      action: "Open bot" },
  { key: "meet",    name: "Google Meet",     icon: Monitor,       desc: "Record Meet calls, and create meetings with a Meet link from the calendar.", href: "/calendar", action: "Open calendar" },
  { key: "teams",   name: "Microsoft Teams", icon: MessageCircle, desc: "ClarityMeet joins in the Teams desktop app from a meeting link.", href: "/bot",      action: "Open bot" },
  { key: "gcal",    name: "Google Calendar", icon: Calendar,      desc: "Sign in with Google to import events and add new meetings to your calendar.", href: "/calendar", action: "Connect" },
  { key: "outlook", name: "Outlook",         icon: Calendar,      desc: "Paste your published Outlook calendar link to keep meetings in sync.", href: "/calendar", action: "Connect" },
  { key: "iphone",  name: "iPhone / iCloud", icon: Smartphone,    desc: "Sync your iCloud calendar in, and subscribe on your iPhone to see ClarityMeet meetings.", href: "/calendar", action: "Connect" },
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
  bot_auto_join:         { label: "Auto-join Zoom meetings",      desc: "Bot automatically joins when a meeting starts" },
  bot_auto_summarise:    { label: "Auto-generate AI summaries",   desc: "Create summary immediately after meeting ends" },
  bot_email_participants:{ label: "Email summary to participants", desc: "Send summary email to all attendees" },
};

const Toggle = ({ on, onToggle }: { on: boolean; onToggle: () => void }) => (
  <button className={`toggle ${on ? "toggle-on" : "toggle-off"}`} onClick={onToggle}>
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

  useEffect(() => {
    (async () => {
      const user = await getCurrentUser();
      if (!user) return;
      const { data } = await supabase.from("calendar_feeds").select("provider").eq("user_id", user.id);
      const providers = new Set((data ?? []).map(r => r.provider as string));
      let google = providers.has("google");
      try { google = google || localStorage.getItem("cm_gcal_connected") === "1"; } catch { /* ignore */ }
      setConnected({ gcal: google, meet: google, outlook: providers.has("outlook"), iphone: providers.has("icloud") });
    })();
  }, []);
  const [saved, setSaved]         = useState(false);
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
  }, [router, activeWorkspace]);

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
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to save settings");
    }
  };

  return (
    <div style={{ paddingBottom: "48px" }} className="page-enter">
      <div className="page-header">
        <div>
          <div className="page-header-title">Settings</div>
          <div className="page-header-sub">Manage workspace, team, and integrations</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "6px" }}>
          <button className="btn btn-primary" onClick={handleSave}>
            {saved ? <><Check size={13} /> Saved!</> : <><Save size={13} /> Save changes</>}
          </button>
          {err && <span style={{ fontSize: "12px", color: "var(--crimson)" }}>{err}</span>}
        </div>
      </div>

      {loading ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "60vh" }}><div className="spinner" /></div>
      ) : (
      <div style={{ display: "flex", padding: "28px 36px", gap: "28px" }}>
        {/* Tab list */}
        <div style={{ width: "190px", flexShrink: 0 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
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
        <div style={{ flex: 1 }}>
          <motion.div key={activeTab} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.2 }}>

            {/* GENERAL */}
            {activeTab === "general" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                <div className="liquid-card" style={{ padding: "28px" }}>
                  <h3 style={{ fontFamily: "var(--font-display)", fontSize: "15px", fontWeight: 700, color: "var(--text-primary)", marginBottom: "22px" }}>Workspace Settings</h3>
                  <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                    <div>
                      <label className="form-label">Workspace name</label>
                      <input type="text" className="form-input" value={wsName} onChange={e => setWsName(e.target.value)} />
                    </div>
                    <div>
                      <label className="form-label">Admin email</label>
                      <input type="text" className="form-input" value={adminEmail} readOnly style={{ opacity: 0.6, cursor: "not-allowed" }} />
                    </div>
                  </div>
                </div>
                <div className="liquid-card" style={{ padding: "28px" }}>
                  <h3 style={{ fontFamily: "var(--font-display)", fontSize: "15px", fontWeight: 700, color: "var(--text-primary)", marginBottom: "20px" }}>Default Bot Behaviour</h3>
                  {(Object.keys(botPrefs) as BotKey[]).map((key, i) => (
                    <div key={key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 0", borderBottom: i < Object.keys(botPrefs).length - 1 ? "1px solid var(--glass-border)" : "none" }}>
                      <div>
                        <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-primary)" }}>{BOT_LABELS[key].label}</div>
                        <div style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "3px" }}>{BOT_LABELS[key].desc}</div>
                      </div>
                      <Toggle on={botPrefs[key]} onToggle={() => setBotPrefs(p => ({ ...p, [key]: !p[key] }))} />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeTab === "activity" && <ActivityLog workspaceId={currentWs} />}

            {/* SECURITY */}
            {activeTab === "security" && <SecurityPanel />}

            {/* TEAM */}
            {activeTab === "team" && (
              <div className="data-card">
                <div style={{ padding: "18px 24px", borderBottom: "1px solid var(--glass-border)", display: "flex", justifyContent: "space-between" }}>
                  <h3 style={{ fontFamily: "var(--font-display)", fontSize: "15px", fontWeight: 700, color: "var(--text-primary)" }}>Team Members</h3>
                  <Link href="/invite" className="btn btn-primary btn-sm" style={{ textDecoration: "none" }}>Invite member</Link>
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
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>
                {INTEGRATIONS.map(intg => {
                  const IntegrationIcon = intg.icon;
                  return (
                    <div key={intg.name} className="liquid-card" style={{ padding: "22px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "12px" }}>
                        <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
                          <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "28px", height: "28px", color: "var(--text-primary)" }}><IntegrationIcon size={18} /></span>
                          <span style={{ fontSize: "15px", fontWeight: 700, color: "var(--text-primary)", fontFamily: "var(--font-display)" }}>{intg.name}</span>
                        </div>
                        {connected[intg.key] && <span className="badge badge-green">Connected</span>}
                      </div>
                      <p style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "16px", lineHeight: 1.6 }}>{intg.desc}</p>
                      <Link href={intg.href} className={`btn btn-sm ${connected[intg.key] ? "btn-secondary" : "btn-primary"}`} style={{ width: "100%", justifyContent: "center", textDecoration: "none" }}>
                        {connected[intg.key] ? "Manage" : intg.action}
                      </Link>
                    </div>
                  );
                })}
              </div>
            )}

            {/* NOTIFICATIONS */}
            {activeTab === "notifications" && (
              <div className="liquid-card" style={{ padding: "28px" }}>
                <h3 style={{ fontFamily: "var(--font-display)", fontSize: "15px", fontWeight: 700, color: "var(--text-primary)", marginBottom: "22px" }}>Email Notification Preferences</h3>
                {(Object.keys(notifs) as NotifKey[]).map((key, i) => (
                  <div key={key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 0", borderBottom: i < Object.keys(notifs).length - 1 ? "1px solid var(--glass-border)" : "none" }}>
                    <div>
                      <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-primary)" }}>{NOTIF_LABELS[key].label}</div>
                      <div style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "3px" }}>{NOTIF_LABELS[key].desc}</div>
                    </div>
                    <Toggle on={notifs[key]} onToggle={() => setNotifs(n => ({ ...n, [key]: !n[key] }))} />
                  </div>
                ))}
              </div>
            )}

          </motion.div>
        </div>
      </div>
      )}
    </div>
  );
}