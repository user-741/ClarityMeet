"use client";
export const dynamic = 'force-dynamic';
// Main dashboard, all data fetched live from Supabase.


import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Zap, ChevronRight, ArrowUpRight, Video, Upload } from "lucide-react";
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
  const [lastMonthMeetings, setLastMonthMeetings] = useState(0);
  const [overdueCount, setOverdueCount] = useState(0);
  const [quickLink, setQuickLink] = useState("");

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
      supabase.from("meetings").select("*").eq("workspace_id", resolvedWsId).eq("status", "scheduled").gte("started_at", new Date(Date.now() - 30 * 60000).toISOString()).order("started_at", { ascending: true }).limit(3),
      // Most urgent unfinished tasks first: overdue and soonest due at the top
      supabase.from("tasks_detail").select("*").eq("workspace_id", resolvedWsId).neq("status", "Completed").order("due_date", { ascending: true, nullsFirst: false }).limit(6),
      supabase.from("tasks").select("created_at").eq("workspace_id", resolvedWsId).gte("created_at", new Date(new Date().setHours(0, 0, 0, 0) - 6 * 86400000).toISOString()),
    ]);
    const lastMonthStart = new Date(); lastMonthStart.setDate(1); lastMonthStart.setHours(0, 0, 0, 0); lastMonthStart.setMonth(lastMonthStart.getMonth() - 1);
    const thisMonthStart = new Date(lastMonthStart); thisMonthStart.setMonth(thisMonthStart.getMonth() + 1);
    const [{ count: lastMonth }, { count: overdue }] = await Promise.all([
      supabase.from("meetings").select("id", { count: "exact", head: true }).eq("workspace_id", resolvedWsId).neq("status", "scheduled").gte("started_at", lastMonthStart.toISOString()).lt("started_at", thisMonthStart.toISOString()),
      supabase.from("tasks").select("id", { count: "exact", head: true }).eq("workspace_id", resolvedWsId).neq("status", "Completed").lt("due_date", new Date().toLocaleDateString("en-CA")),
    ]);
    setLastMonthMeetings(lastMonth ?? 0);
    setOverdueCount(overdue ?? 0);

    if (statsRes.data)    setStats(statsRes.data as WorkspaceStats);
    if (meetingsRes.data) setMeetings(meetingsRes.data as MeetingsSummary[]);
    if (upcomingRes.data) setUpcoming(upcomingRes.data as Meeting[]);
    if (tasksRes.data)    setTasks(tasksRes.data as TasksDetail[]);
    if (weeklyRes.data) {
      // Last 7 days, ending today
      const start = new Date(); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - 6);
      const counts = Array(7).fill(0);
      (weeklyRes.data as { created_at: string }[]).forEach((t) => {
        const i = Math.floor((new Date(t.created_at).getTime() - start.getTime()) / 86400000);
        if (i >= 0 && i < 7) counts[i]++;
      });
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

  const completionRate = stats?.completion_rate_pct ?? 0;
  const thisMonth = stats?.meetings_this_month ?? 0;
  const monthDiff = thisMonth - lastMonthMeetings;
  const activeTasks = (stats?.open_tasks ?? 0) + (stats?.in_progress_tasks ?? 0);

  const STAT_CARDS = [
    { label: "Meetings this month", value: thisMonth, note: lastMonthMeetings || thisMonth ? `${monthDiff >= 0 ? "+" : ""}${monthDiff} vs last month` : "No meetings yet", tone: monthDiff > 0 ? "up" : monthDiff < 0 ? "down" : "" },
    { label: "Open tasks", value: activeTasks, note: overdueCount ? `${overdueCount} overdue` : "Nothing overdue", tone: overdueCount ? "down" : "up" },
    { label: "Completion rate", value: `${completionRate}%`, note: `${stats?.completed_tasks ?? 0} of ${stats?.total_tasks ?? 0} tasks done`, tone: "" },
    { label: "Team members", value: stats?.member_count ?? 0, note: "In this workspace", tone: "" },
  ];

  const statusLabel = (s: string | null) =>
    s === "complete" ? { text: "Summary ready", cls: "badge-green" }
    : s === "failed" ? { text: "Failed", cls: "badge-red" }
    : ["processing", "summarising", "transcribing"].includes(s ?? "") ? { text: "Processing", cls: "badge-amber" }
    : { text: s ?? "-", cls: "badge-muted" };

  const platformName = (p: string | null) => ({ zoom: "Zoom", teams: "Teams", google_meet: "Google Meet", upload: "Upload", webex: "Webex" } as Record<string, string>)[p ?? ""] ?? "Meeting";
  const today = new Date().toLocaleDateString("en-CA");
  const dueText = (d: string | null) => {
    if (!d) return { text: "No due date", cls: "" };
    if (d < today) return { text: `Overdue · ${new Date(`${d}T12:00:00`).toLocaleDateString("en-AU", { day: "numeric", month: "short" })}`, cls: "late" };
    if (d === today) return { text: "Due today", cls: "soon" };
    return { text: `Due ${new Date(`${d}T12:00:00`).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" })}`, cls: "" };
  };
  const weekDays = Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - 6 + i); return d; });
  const weekMax = Math.max(4, ...weekly);
  const next = upcoming[0];

  const sendQuick = () => {
    const l = quickLink.trim();
    router.push(l ? `/bot?url=${encodeURIComponent(l)}` : "/bot");
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
      <style>{DB_CSS}</style>
      <div className="page-header">
        <div>
          <div className="page-header-title">{greeting}{userName ? `, ${userName}` : ""}</div>
          <div className="page-header-sub">{new Date().toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" })}</div>
        </div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <Link href="/upload" className="btn btn-secondary btn-sm" style={{ textDecoration: "none" }}><Upload size={13} /> Upload recording</Link>
        </div>
      </div>

      <div className="page-body db-body">
        <div className="data-card db-quick">
          <Video size={16} />
          <input value={quickLink} onChange={e => setQuickLink(e.target.value)} onKeyDown={e => e.key === "Enter" && sendQuick()}
            placeholder="Paste a Zoom, Teams or Google Meet link to record it" aria-label="Meeting link" />
          <button className="btn btn-primary btn-sm" onClick={sendQuick}><Zap size={13} /> Send bot</button>
        </div>

        <div className="db-kpis">
          {STAT_CARDS.map(c => (
            <div key={c.label} className="data-card db-kpi">
              <div className="db-kpi-label">{c.label}</div>
              <div className="db-kpi-value">{c.value}</div>
              <div className={`db-kpi-note ${c.tone}`}>{c.note}</div>
            </div>
          ))}
        </div>

        <div className="db-grid">
          <div className="data-card">
            <div className="db-head"><h2>Recent meetings</h2><Link href="/meeting-summary">View all <ChevronRight size={12} /></Link></div>
            {meetings.length === 0 ? (
              <div className="db-empty">No meetings yet. Send the bot to a call or upload a recording.</div>
            ) : (
              <table className="data-table">
                <thead><tr><th>Meeting</th><th>When</th><th>Length</th><th>Tasks</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {meetings.map(m => {
                    const st = statusLabel(m.status);
                    return (
                      <tr key={m.id} onClick={() => router.push(`/meeting-summary?id=${m.id}`)} className="db-row">
                        <td style={{ color: "var(--text-primary)", fontWeight: 600 }}>{m.title || "Untitled meeting"}<div className="db-sub">{platformName(m.platform)}</div></td>
                        <td style={{ whiteSpace: "nowrap", fontSize: "13px" }}>{fmtDate(m.started_at || m.created_at)}</td>
                        <td style={{ fontSize: "13px" }}>{fmtDuration(m.duration_secs)}</td>
                        <td style={{ fontSize: "13px" }}>{m.task_count ?? 0}</td>
                        <td><span className={`badge ${st.cls}`}>{st.text}</span></td>
                        <td style={{ textAlign: "right" }}><ChevronRight size={14} color="var(--text-muted)" /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          <div className="data-card db-next">
            <div className="db-head"><h2>Next meeting</h2><Link href="/calendar">Calendar <ChevronRight size={12} /></Link></div>
            {!next ? (
              <div className="db-empty">Nothing scheduled. Add a meeting from the Calendar.</div>
            ) : (
              <div style={{ padding: "14px 18px" }}>
                <div className="db-next-when">{next.started_at ? new Date(next.started_at).toLocaleString("en-AU", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "TBD"}</div>
                <div className="db-next-title">{next.title || "Untitled meeting"}</div>
                {next.started_at && <Countdown to={next.started_at} />}
                <div className="db-next-meta">
                  <span>{platformName(next.platform)}</span>
                  <span className={next.meeting_url ? "on" : ""}><Video size={11} /> {next.meeting_url ? "Bot can join" : "No meeting link yet"}</span>
                </div>
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                  {next.meeting_url && <a className="btn btn-primary btn-sm" href={next.meeting_url} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>Join</a>}
                  {next.meeting_url && <Link className="btn btn-secondary btn-sm" href={`/bot?url=${encodeURIComponent(next.meeting_url)}`} style={{ textDecoration: "none" }}>Send bot</Link>}
                </div>
                {upcoming.length > 1 && (
                  <div className="db-later">
                    {upcoming.slice(1).map(m => (
                      <div key={m.id}><span>{m.title || "Untitled"}</span><span>{m.started_at ? new Date(m.started_at).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" }) : ""}</span></div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="db-grid db-grid-2">
          <div className="data-card">
            <div className="db-head"><h2>Needs attention</h2><Link href="/tasks">All tasks <ArrowUpRight size={12} /></Link></div>
            {tasks.length === 0 ? (
              <div className="db-empty">No open tasks. Nice work.</div>
            ) : (
              <div>
                {tasks.map(t => {
                  const due = dueText(t.due_date);
                  return (
                    <Link key={t.id} href="/tasks" className="db-task">
                      <div className={`priority-dot priority-${(t.priority ?? "Medium").toLowerCase()}`} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="db-task-title">{t.title}</div>
                        <div className="db-sub">{t.assignee_display || "Unassigned"}{t.meeting_title ? ` · ${t.meeting_title}` : ""}</div>
                      </div>
                      <span className={`db-due ${due.cls}`}>{due.text}</span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          <div className="data-card">
            <div className="db-head"><h2>Tasks created, last 7 days</h2><Link href="/analytics">Analytics <ArrowUpRight size={12} /></Link></div>
            <div style={{ padding: "16px 18px" }}>
              <div className="db-chart">
                <div className="db-y"><span>{weekMax}</span><span>{Math.round(weekMax / 2)}</span><span>0</span></div>
                <div className="db-bars">
                  {weekly.map((v, i) => (
                    <div key={i} className="db-bar-col" title={`${weekDays[i].toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "short" })}: ${v} task${v === 1 ? "" : "s"}`}>
                      <span className="db-bar-val">{v || ""}</span>
                      <div className="db-bar" style={{ height: `${(v / weekMax) * 100}%` }} />
                    </div>
                  ))}
                </div>
              </div>
              <div className="db-x">{weekDays.map((d, i) => <span key={i}>{i === 6 ? "Today" : DAYS[(d.getDay() + 6) % 7]}</span>)}</div>
              <div className="db-week-sum">
                <div><strong>{weekly.reduce((a, b) => a + b, 0)}</strong><span>tasks this week</span></div>
                <div><strong>{completionRate}%</strong><span>completed overall</span></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const DB_CSS = `
.db-body { padding: 24px 36px; }
@media (max-width: 700px) { .db-body { padding: 16px; } }
.db-quick { display: flex; align-items: center; gap: 10px; padding: 8px 8px 8px 16px; margin-bottom: 16px; }
.db-quick > svg { color: #38BDF8; flex-shrink: 0; }
.db-quick input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--text-primary); font: inherit; font-size: 14px; height: 32px; }
.db-kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; margin-bottom: 16px; }
@media (max-width: 900px) { .db-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.db-kpi { padding: 14px 16px; }
.db-kpi-label { font-size: 12px; font-weight: 600; color: var(--text-muted); }
.db-kpi-value { font-size: 26px; font-weight: 700; color: var(--text-primary); margin: 3px 0 1px; font-variant-numeric: tabular-nums; }
.db-kpi-note { font-size: 11px; font-weight: 600; color: var(--text-muted); }
.db-kpi-note.up { color: var(--emerald-pulse); }
.db-kpi-note.down { color: var(--crimson); }
.db-grid { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 16px; margin-bottom: 16px; }
.db-grid-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
@media (max-width: 1100px) { .db-grid, .db-grid-2 { grid-template-columns: minmax(0, 1fr); } }
.db-head { display: flex; justify-content: space-between; align-items: center; padding: 14px 18px; border-bottom: 1px solid var(--glass-border); }
.db-head h2 { font-size: 14px; font-weight: 700; color: var(--text-primary); margin: 0; }
.db-head a { display: inline-flex; align-items: center; gap: 3px; font-size: 12px; color: #38BDF8; text-decoration: none; }
.db-empty { padding: 22px 18px; font-size: 13px; color: var(--text-muted); }
.db-sub { font-size: 11px; color: var(--text-muted); font-weight: 400; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.db-row { cursor: pointer; transition: background 150ms; }
.db-next-when { font-size: 12px; font-weight: 600; color: #38BDF8; }
.db-next-title { font-size: 16px; font-weight: 700; color: var(--text-primary); margin: 3px 0 2px; }
.db-next-meta { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 12px; color: var(--text-muted); margin: 10px 0 12px; }
.db-next-meta span { display: inline-flex; align-items: center; gap: 5px; }
.db-next-meta .on { color: var(--emerald-pulse); }
.db-later { margin-top: 14px; border-top: 1px solid var(--glass-border); padding-top: 8px; display: flex; flex-direction: column; gap: 6px; }
.db-later div { display: flex; justify-content: space-between; gap: 10px; font-size: 12px; color: var(--text-secondary); }
.db-later span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.db-later span:last-child { color: var(--text-muted); white-space: nowrap; }
.db-task { display: flex; align-items: center; gap: 12px; padding: 11px 18px; border-top: 1px solid var(--glass-border); text-decoration: none; transition: background 150ms; }
.db-task:first-child { border-top: 0; }
.db-task:hover { background: rgba(14,165,233,0.05); }
.db-task-title { font-size: 13px; font-weight: 600; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.db-due { font-size: 11px; font-weight: 600; color: var(--text-muted); white-space: nowrap; }
.db-due.late { color: var(--crimson); }
.db-due.soon { color: var(--amber-alert); }
.db-chart { display: flex; gap: 8px; height: 130px; }
.db-y { display: flex; flex-direction: column; justify-content: space-between; font-size: 10px; color: var(--text-muted); text-align: right; min-width: 14px; }
.db-bars { flex: 1; display: flex; align-items: flex-end; gap: 10px; border-bottom: 1px solid var(--glass-border); background-image: linear-gradient(to bottom, transparent calc(50% - 0.5px), rgba(127,127,127,0.15) 50%, transparent calc(50% + 0.5px)); }
.db-bar-col { flex: 1; height: 100%; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; gap: 3px; }
.db-bar { width: 100%; max-width: 34px; border-radius: 4px 4px 0 0; background: #0EA5E9; transition: height 200ms; }
.db-bar-col:hover .db-bar { background: #38BDF8; }
.db-bar-val { font-size: 10px; color: var(--text-muted); font-variant-numeric: tabular-nums; }
.db-x { display: flex; gap: 10px; margin: 6px 0 0 22px; }
.db-x span { flex: 1; text-align: center; font-size: 10px; color: var(--text-muted); }
.db-week-sum { display: flex; gap: 28px; margin-top: 16px; }
.db-week-sum div { display: flex; flex-direction: column; }
.db-week-sum strong { font-size: 20px; color: var(--text-primary); }
.db-week-sum span { font-size: 12px; color: var(--text-muted); }
`;
