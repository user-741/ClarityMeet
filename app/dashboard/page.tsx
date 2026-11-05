"use client";
export const dynamic = 'force-dynamic';
// Main dashboard - all data fetched live from Supabase.


import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Users, CalendarDays, ListChecks, TrendingUp, Clock, Zap, ChevronRight, ArrowUpRight, Video, Upload } from "lucide-react";
import { motion } from "framer-motion";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/current-user";
import { useWorkspace } from "@/app/components/WorkspaceContext";
import type { WorkspaceStats, MeetingsSummary, TasksDetail, Meeting } from "@/lib/database.types";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function fmtDuration(secs: number | null) {
  if (!secs) return "-";
  const m = Math.round(secs / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function fmtDate(iso: string | null) {
  if (!iso) return "-";
  const d = new Date(iso);
  const now = new Date();
  const todayStr = new Date().toDateString();
  const yestDate = new Date(now); yestDate.setDate(now.getDate() - 1);
  if (d.toDateString() === todayStr) return `Today, ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  if (d.toDateString() === yestDate.toDateString()) return `Yesterday, ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short" }) + ", " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}



function Countdown({ to }: { to: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(id); }, []);
  const mins = Math.max(0, Math.round((new Date(to).getTime() - now) / 60000));
  const d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), m = mins % 60;
  const text = mins === 0 ? "starting now" : `next meeting in ${d ? `${d}d ` : ""}${h ? `${h}h ` : ""}${d ? "" : `${m}m`}`.trim();
  return <div style={{ fontSize: "12px", color: "var(--electric-teal)", fontWeight: 600, marginTop: "4px" }}>{text}</div>;
}

export default function DashboardPage() {
  const router = useRouter();
  const { activeWorkspace } = useWorkspace();
  const [greeting, setGreeting] = useState("Good morning");
  const [userName, setUserName] = useState("");
  const [stats,    setStats]    = useState<WorkspaceStats | null>(null);
  const [meetings, setMeetings] = useState<MeetingsSummary[]>([]);
  const [upcoming, setUpcoming] = useState<Meeting[]>([]);
  const [tasks,    setTasks]    = useState<TasksDetail[]>([]);
  const [weekly,   setWeekly]   = useState<number[]>(Array(7).fill(0));
  const [loading,  setLoading]  = useState(true);

  const load = useCallback(async () => {
    const user = await getCurrentUser();
    if (user) {
      supabase.from("users").select("first_name").eq("id", user.id).maybeSingle().then(({ data }) => {
        const first = data?.first_name || (user.user_metadata?.first_name as string | undefined) || user.email?.split("@")[0] || "";
        setUserName(first);
      });
    }
    if (!user) { router.push("/login"); return; }

    const h = new Date().getHours();
    if (h >= 12 && h < 17) setGreeting("Good afternoon");
    else if (h >= 17) setGreeting("Good evening");

    // Use the workspace selected in the sidebar (from context), fall back to first membership
    const wsId = activeWorkspace?.workspace_id ?? (() => {
      // fallback: fetch first workspace (only used before context loads)
      return null;
    })();

    let resolvedWsId = wsId;
    if (!resolvedWsId) {
      const wmRes = await supabase.from("workspace_members").select("workspace_id").eq("user_id", user.id).limit(1).maybeSingle();
      resolvedWsId = (wmRes.data as { workspace_id: string } | null)?.workspace_id ?? null;
    }
    if (!resolvedWsId) { setLoading(false); return; }

    const [statsRes, meetingsRes, upcomingRes, tasksRes, weeklyRes] = await Promise.all([
      supabase.from("workspace_stats").select("*").eq("workspace_id", resolvedWsId).single(),
      supabase.from("meetings_summary").select("*").eq("workspace_id", resolvedWsId).in("status", ["complete","summarising","processing"]).order("created_at", { ascending: false }).limit(4),
      supabase.from("meetings").select("*").eq("workspace_id", resolvedWsId).eq("status", "scheduled").gte("started_at", new Date().toISOString()).order("started_at", { ascending: true }).limit(3),
      supabase.from("tasks_detail").select("*").eq("workspace_id", resolvedWsId).order("created_at", { ascending: false }).limit(5),
      supabase.from("tasks").select("created_at").eq("workspace_id", resolvedWsId).gte("created_at", new Date(Date.now() - 7 * 86400000).toISOString()),
    ]);

    if (statsRes.data)    setStats(statsRes.data as WorkspaceStats);
    if (meetingsRes.data) setMeetings(meetingsRes.data as MeetingsSummary[]);
    if (upcomingRes.data) setUpcoming(upcomingRes.data as Meeting[]);
    if (tasksRes.data)    setTasks(tasksRes.data as TasksDetail[]);
    if (weeklyRes.data) {
      const counts = Array(7).fill(0);
      (weeklyRes.data as { created_at: string }[]).forEach((t) => { counts[(new Date(t.created_at).getDay() + 6) % 7]++; });
      setWeekly(counts);
    }
    setLoading(false);
  }, [router, activeWorkspace]);

  useEffect(() => { load(); }, [load, activeWorkspace]);

  // Keep a ref to latest load() so the realtime callback always calls the current version
  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; }, [load]);

  // Reload stats live when anyone joins or leaves the workspace
  useEffect(() => {
    if (!activeWorkspace?.workspace_id) return;
    const wsId = activeWorkspace.workspace_id;
    const channel = supabase
      .channel(`dashboard_ws_members_${wsId}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "workspace_members", filter: `workspace_id=eq.${wsId}` },
        () => { loadRef.current(); }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [activeWorkspace?.workspace_id]);

  const maxBar = Math.max(...weekly, 1);
  const completionRate = stats?.completion_rate_pct ?? 0;

  const STAT_CARDS = [
    { label: "Meetings This Month", value: stats?.meetings_this_month ?? 0,                              icon: CalendarDays, color: "#0EA5E9" },
    { label: "Active Tasks",        value: (stats?.open_tasks ?? 0) + (stats?.in_progress_tasks ?? 0), icon: ListChecks,   color: "#10B981" },
    { label: "Team Members",        value: stats?.member_count ?? 0,                                    icon: Users,        color: "#F59E0B" },
    { label: "Completion Rate",     value: `${completionRate}%`,                                        icon: TrendingUp,   color: "#A78BFA" },
  ];

  const statusBadge = (s: string) => {
    if (s === "complete") return "badge-green";
    if (["processing","summarising","transcribing"].includes(s)) return "badge-amber";
    return "badge-muted";
  };

  if (loading) return (
    <div className="page-enter" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "60vh" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "16px" }}>
        <div style={{ width: "32px", height: "32px", border: "3px solid var(--glass-border)", borderTopColor: "#0EA5E9", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
        <span style={{ fontSize: "13px", color: "var(--text-muted)" }}>Loading dashboard...</span>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );

  return (
    <div style={{ paddingBottom: "48px" }} className="page-enter">
      <div className="page-header">
        <div>
          <div className="page-header-title">{greeting}{userName ? `, ${userName}` : ""}</div>
          <div className="page-header-sub">Here&apos;s what&apos;s happening with your meetings today</div>
        </div>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <Link href="/upload" className="btn btn-secondary" style={{ textDecoration: "none" }}><Upload size={13} /> Upload recording</Link>
          <Link href="/bot" className="btn btn-primary" style={{ textDecoration: "none" }}><Zap size={13} /> New meeting</Link>
        </div>
      </div>

      <div style={{ padding: "32px 36px" }}>
        {/* How to record banner */}
        <div style={{
          background: "rgba(14,165,233,0.05)",
          border: "1px solid rgba(14,165,233,0.18)",
          borderRadius: "var(--radius-lg)",
          padding: "16px 20px",
          marginBottom: "24px",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
            <div style={{ width: "32px", height: "32px", background: "rgba(14,165,233,0.12)", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Video size={15} color="#7DD3FC" />
            </div>
            <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--text-primary)" }}>Record a meeting with ClarityMeet</span>
          </div>
          <div style={{ display: "flex", gap: "8px", alignItems: "stretch" }}>
            {[
              { step: "1", label: "Paste the link", desc: "Copy your Zoom or Teams invite into Start ClarityMeet" },
              { step: "2", label: "It joins for you", desc: "ClarityMeet joins and records, then stops when the meeting ends" },
              { step: "3", label: "Get the notes",   desc: "Summary, highlights and tasks appear here in a few minutes" },
            ].map(({ step, label, desc }) => (
              <div key={step} style={{ flex: 1, background: "rgba(255,255,255,0.03)", borderRadius: "8px", padding: "12px 14px", border: "1px solid rgba(255,255,255,0.06)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                  <div style={{ width: "20px", height: "20px", background: "rgba(14,165,233,0.2)", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", fontWeight: 700, color: "#7DD3FC", flexShrink: 0 }}>{step}</div>
                  <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--text-primary)" }}>{label}</span>
                </div>
                <p style={{ fontSize: "11px", color: "var(--text-muted)", margin: 0, lineHeight: 1.5 }}>{desc}</p>
              </div>
            ))}
            <Link href="/bot" style={{ display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", gap: "6px", background: "rgba(14,165,233,0.1)", border: "1px solid rgba(14,165,233,0.3)", borderRadius: "8px", padding: "12px 20px", textDecoration: "none", flexShrink: 0 }}>
              <Video size={16} color="#7DD3FC" />
              <span style={{ fontSize: "12px", fontWeight: 700, color: "#7DD3FC", whiteSpace: "nowrap" }}>Start ClarityMeet</span>
            </Link>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "16px", marginBottom: "28px" }} className="stagger">
          {STAT_CARDS.map(s => {
            const Icon = s.icon;
            return (
              <div key={s.label} className="stat-card">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
                  <div style={{ width: "38px", height: "38px", background: `${s.color}18`, borderRadius: "10px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Icon size={16} color={s.color} />
                  </div>
                </div>
                <div style={{ fontFamily: "var(--font-display)", fontSize: "30px", fontWeight: 800, marginBottom: "4px" }} className="text-gradient">{s.value}</div>
                <div style={{ fontSize: "12px", color: "var(--text-muted)", fontWeight: 500 }}>{s.label}</div>
              </div>
            );
          })}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: "20px", marginBottom: "20px" }}>
          <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.28, duration: 0.4 }} className="data-card">
            <div style={{ padding: "18px 24px", borderBottom: "1px solid var(--glass-border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h2 style={{ fontFamily: "var(--font-display)", fontSize: "14px", fontWeight: 700, color: "var(--text-primary)" }}>Recent Meetings</h2>
              <Link href="/meeting-summary" style={{ fontSize: "12px", color: "#7DD3FC", display: "flex", alignItems: "center", gap: "4px", textDecoration: "none" }}>View all <ChevronRight size={12} /></Link>
            </div>
            {meetings.length === 0 ? (
              <div className="empty-state"><CalendarDays size={28} color="var(--text-disabled)" /><p style={{ marginTop: "10px", fontSize: "13px" }}>No meetings yet</p></div>
            ) : (
              <table className="data-table">
                <thead><tr><th>Meeting</th><th>Date</th><th>Duration</th><th>Tasks</th><th>Status</th></tr></thead>
                <tbody>
                  {meetings.map(m => (
                    <tr key={m.id} onClick={() => router.push(`/meeting-summary?id=${m.id}`)} style={{ cursor: "pointer" }}>
                      <td style={{ color: "var(--text-primary)", fontWeight: 500 }}>{m.title || "Untitled meeting"}</td>
                      <td><span style={{ display: "flex", alignItems: "center", gap: "6px" }}><Clock size={11} color="var(--text-muted)" />{fmtDate(m.started_at || m.created_at)}</span></td>
                      <td>{fmtDuration(m.duration_secs)}</td>
                      <td>{m.task_count}</td>
                      <td><span className={`badge ${statusBadge(m.status ?? "")}`}>{m.status ?? "-"}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.33, duration: 0.4 }} className="data-card" style={{ height: "fit-content" }}>
            <div style={{ padding: "18px 24px", borderBottom: "1px solid var(--glass-border)" }}>
              <h2 style={{ fontFamily: "var(--font-display)", fontSize: "14px", fontWeight: 700, color: "var(--text-primary)" }}>Upcoming</h2>
              {upcoming[0]?.started_at && <Countdown to={upcoming[0].started_at} />}
            </div>
            {upcoming.length === 0 ? (
              <div className="empty-state" style={{ padding: "24px" }}><CalendarDays size={24} color="var(--text-disabled)" /><p style={{ marginTop: "8px", fontSize: "13px" }}>No scheduled meetings</p></div>
            ) : (
              <div style={{ padding: "6px 14px" }}>
                {upcoming.map((m, i) => (
                  <div key={m.id} style={{ padding: "14px 4px", borderBottom: i < upcoming.length - 1 ? "1px solid var(--glass-border)" : "none" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
                      <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-primary)" }}>{m.title || "Untitled"}</span>
                      <span className="badge badge-blue">{m.platform}</span>
                    </div>
                    <span style={{ fontSize: "12px", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: "4px" }}>
                      <CalendarDays size={10} />
                      {m.started_at ? new Date(m.started_at).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "TBD"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
          <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.38, duration: 0.4 }} className="data-card">
            <div style={{ padding: "18px 24px", borderBottom: "1px solid var(--glass-border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h2 style={{ fontFamily: "var(--font-display)", fontSize: "14px", fontWeight: 700, color: "var(--text-primary)" }}>Action Items</h2>
              <Link href="/tasks" style={{ fontSize: "12px", color: "#7DD3FC", display: "flex", alignItems: "center", gap: "4px", textDecoration: "none" }}>All tasks <ArrowUpRight size={12} /></Link>
            </div>
            {tasks.length === 0 ? (
              <div className="empty-state"><ListChecks size={28} color="var(--text-disabled)" /><p style={{ marginTop: "10px", fontSize: "13px" }}>No tasks yet</p></div>
            ) : (
              <div style={{ padding: "6px 14px" }}>
                {tasks.map((t, i) => (
                  <div key={t.id} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "12px 4px", borderBottom: i < tasks.length - 1 ? "1px solid var(--glass-border)" : "none" }}>
                    <div className={`priority-dot priority-${(t.priority ?? "Medium").toLowerCase()}`} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: "13px", fontWeight: 500, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</div>
                      <div style={{ fontSize: "11px", color: "var(--text-disabled)", marginTop: "2px" }}>{t.meeting_title || "No meeting"}</div>
                    </div>
                    <span style={{ fontSize: "12px", color: "var(--text-muted)", flexShrink: 0 }}>{t.assignee_display}</span>
                    <span className={`badge ${t.status === "Completed" ? "badge-green" : t.status === "In Progress" ? "badge-amber" : "badge-muted"}`}>{t.status}</span>
                  </div>
                ))}
              </div>
            )}
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.43, duration: 0.4 }} className="data-card">
            <div style={{ padding: "18px 24px", borderBottom: "1px solid var(--glass-border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h2 style={{ fontFamily: "var(--font-display)", fontSize: "14px", fontWeight: 700, color: "var(--text-primary)" }}>Weekly Activity</h2>
              <Link href="/analytics" style={{ fontSize: "12px", color: "#7DD3FC", display: "flex", alignItems: "center", gap: "4px", textDecoration: "none" }}>Analytics <ArrowUpRight size={12} /></Link>
            </div>
            <div style={{ padding: "24px" }}>
              <div style={{ display: "flex", alignItems: "flex-end", gap: "8px", height: "110px", marginBottom: "10px" }}>
                {weekly.map((v, i) => (
                  <div key={i} style={{ flex: 1, height: "100%", display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
                    <div className="chart-bar" style={{ width: "100%", height: `${(v / maxBar) * 100}%`, minHeight: "4px" }} title={`${DAYS[i]}: ${v}`} />
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: "8px" }}>
                {DAYS.map(d => <div key={d} style={{ flex: 1, textAlign: "center", fontSize: "10px", color: "var(--text-muted)", fontWeight: 600 }}>{d}</div>)}
              </div>
              <div style={{ display: "flex", gap: "28px", marginTop: "22px" }}>
                <div>
                  <div style={{ fontFamily: "var(--font-display)", fontSize: "24px", fontWeight: 700 }} className="text-gradient">{weekly.reduce((a,b) => a+b, 0)}</div>
                  <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>Tasks this week</div>
                </div>
                <div>
                  <div style={{ fontFamily: "var(--font-display)", fontSize: "24px", fontWeight: 700, color: "var(--emerald-pulse)" }}>{completionRate}%</div>
                  <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>Completion rate</div>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}