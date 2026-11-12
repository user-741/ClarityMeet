"use client";
export const dynamic = 'force-dynamic';
// Analytics & Insights, KPI cards, weekly bar chart, monthly line chart, and team performance table.


import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { BarChart2, TrendingUp, Users, Clock, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { motion } from "framer-motion";
import { supabase } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/current-user";
import { getFirstWorkspaceId } from "@/lib/workspace";
import { useWorkspace } from "@/app/components/WorkspaceContext";
import type { WorkspaceStats, TasksDetail } from "@/lib/database.types";

const DAY_LABELS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const MONTH_LABELS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
// Month i of the last 12 (0 = eleven months ago, 11 = this month)
const monthAt = (i: number) => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth() - 11 + i, 1); };
const monthLabel = (i: number) => MONTH_LABELS[monthAt(i).getMonth()];
const monthRange = (i: number) => `${monthLabel(i)} ${monthAt(i).getFullYear()}`;

type TeamRow = { name: string; initials: string; tasks: number; completed: number; rate: number };

export default function AnalyticsPage() {
  const { activeWorkspace } = useWorkspace();
  const router = useRouter();
  const [dateRange, setDateRange] = useState("month");
  const [stats, setStats] = useState<WorkspaceStats | null>(null);
  const [weekly, setWeekly] = useState<{ day: string; tasks: number; completed: number }[]>([]);
  const [monthly, setMonthly] = useState<number[]>(Array(12).fill(0));
  const [team, setTeam] = useState<TeamRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const user = await getCurrentUser();
    if (!user) { router.push("/login"); return; }

    const wsId = activeWorkspace?.workspace_id ??
      (await getFirstWorkspaceId(user.id));
    if (!wsId) { setLoading(false); return; }

    // KPI stats
    const { data: statsData } = await supabase
      .from("workspace_stats")
      .select("*")
      .eq("workspace_id", wsId)
      .single();
    if (statsData) setStats(statsData as WorkspaceStats);

    // Weekly tasks (last 7 days)
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 6);
    const { data: weekTasksRaw } = await supabase
      .from("tasks")
      .select("created_at, status")
      .eq("workspace_id", wsId)
      .gte("created_at", weekAgo.toISOString());
    const weekTasks = weekTasksRaw as { created_at: string; status: string }[] | null;

    const weekMap = DAY_LABELS.map(d => ({ day: d, tasks: 0, completed: 0 }));
    (weekTasks ?? []).forEach(t => {
      const idx = new Date(t.created_at).getDay();
      weekMap[idx].tasks += 1;
      if (t.status === "Completed") weekMap[idx].completed += 1;
    });
    // Reorder so today is last
    const todayIdx = new Date().getDay();
    const reordered = [
      ...weekMap.slice(todayIdx + 1),
      ...weekMap.slice(0, todayIdx + 1),
    ];
    setWeekly(reordered);

    // Monthly meetings (the last 12 months, ending this month)
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth() - 11, 1);
    const { data: monthMeetingsRaw } = await supabase
      .from("meetings")
      .select("started_at")
      .eq("workspace_id", wsId)
      .gte("started_at", first.toISOString())
      .lte("started_at", now.toISOString());
    const monthMeetings = monthMeetingsRaw as { started_at: string | null }[] | null;

    const monthCounts = Array(12).fill(0);
    (monthMeetings ?? []).forEach(m => {
      if (!m.started_at) return;
      const d = new Date(m.started_at);
      const idx = (d.getFullYear() - first.getFullYear()) * 12 + d.getMonth() - first.getMonth();
      if (idx >= 0 && idx < 12) monthCounts[idx] += 1;
    });
    setMonthly(monthCounts);

    // Team performance
    const { data: members } = await supabase
      .from("workspace_members")
      .select("user_id, users(first_name, last_name)")
      .eq("workspace_id", wsId);

    const { data: allTasks } = await supabase
      .from("tasks_detail")
      .select("assignee_id, status")
      .eq("workspace_id", wsId) as { data: (Pick<TasksDetail, "assignee_id" | "status">)[] | null };

    const teamRows: TeamRow[] = (members ?? []).map((m: { user_id: string; users: { first_name: string | null; last_name: string | null } | null }) => {
      const u = m.users;
      const firstName = u?.first_name ?? "";
      const lastName = u?.last_name ?? "";
      const name = `${firstName} ${lastName}`.trim() || m.user_id;
      const initials = [firstName[0], lastName[0]].filter(Boolean).join("").toUpperCase() || "??";
      const userTasks = (allTasks ?? []).filter(t => t.assignee_id === m.user_id);
      const done = userTasks.filter(t => t.status === "Completed").length;
      const rate = userTasks.length > 0 ? Math.round((done / userTasks.length) * 100) : 0;
      return { name, initials, tasks: userTasks.length, completed: done, rate };
    });
    setTeam(teamRows.filter(r => r.tasks > 0).sort((a, b) => b.tasks - a.tasks));
    setLoading(false);
  }, [router, activeWorkspace]);

  useEffect(() => { load(); }, [load, activeWorkspace]);

  const maxWeek    = Math.max(...weekly.map(d => d.tasks), 1);
  const maxMonthly = Math.max(...monthly, 1);

  const KPIS = [
    { label: "Total Meetings",       value: stats ? String(stats.total_meetings ?? 0) : "-",                           icon: Clock,      color: "#0EA5E9", trend: "up"   as const },
    { label: "Tasks Created",        value: stats ? String(stats.total_tasks ?? 0) : "-",                              icon: TrendingUp, color: "#10B981", trend: "up"   as const },
    { label: "Completion Rate",      value: stats ? `${stats.completion_rate_pct ?? 0}%` : "-",                       icon: BarChart2,  color: "#A78BFA", trend: "up"   as const },
    { label: "Meetings This Month",  value: stats ? String(stats.meetings_this_month ?? 0) : "-",             icon: Users,      color: "#F59E0B", trend: "down" as const },
  ];

  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "60vh" }}>
      <div className="spinner" />
    </div>
  );

  return (
    <div style={{ paddingBottom: "48px" }} className="page-enter">
      <div className="page-header">
        <div>
          <div className="page-header-title">Analytics &amp; Insights</div>
          <div className="page-header-sub">Performance metrics across your workspace</div>
        </div>
        <div style={{ display: "flex", gap: "4px", background: "rgba(14,21,37,0.9)", border: "1px solid var(--glass-border)", borderRadius: "var(--radius-sm)", padding: "4px" }}>
          {["week","month","quarter"].map(r => (
            <button key={r} onClick={() => setDateRange(r)} style={{
              padding: "7px 16px", border: "none", borderRadius: "6px", cursor: "pointer", fontSize: "12px", fontWeight: 600,
              background: dateRange === r ? "var(--bg-overlay)" : "transparent",
              color: dateRange === r ? "var(--text-primary)" : "var(--text-muted)", textTransform: "capitalize", transition: "all 200ms",
            }}>{r}</button>
          ))}
        </div>
      </div>

      <div style={{ padding: "28px 36px" }} className="page-body">
        {/* KPIs */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "16px", marginBottom: "24px" }} className="rg-4 stagger">
          {KPIS.map(s => {
            const Icon = s.icon;
            return (
              <div key={s.label} className="stat-card">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
                  <div style={{ width: "38px", height: "38px", background: `${s.color}18`, borderRadius: "10px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Icon size={16} color={s.color} />
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "3px", fontSize: "12px", fontWeight: 700, color: s.trend === "up" ? "var(--emerald-pulse)" : "var(--crimson)" }}>
                    {s.trend === "up" ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                  </div>
                </div>
                <div style={{ fontFamily: "var(--font-display)", fontSize: "30px", fontWeight: 800, marginBottom: "4px" }} className="text-gradient stat-num">{s.value}</div>
                <div style={{ fontSize: "12px", color: "var(--text-muted)", fontWeight: 500 }}>{s.label}</div>
              </div>
            );
          })}
        </div>

        {/* Charts row */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", marginBottom: "20px" }} className="rg-2">
          {/* Weekly bar */}
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.28 }} className="liquid-card" style={{ padding: "24px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "24px" }}>
              <div>
                <h3 style={{ fontFamily: "var(--font-display)", fontSize: "14px", fontWeight: 700, color: "var(--text-primary)", marginBottom: "4px" }}>Weekly Task Volume</h3>
                <p style={{ fontSize: "12px", color: "var(--text-muted)" }}>Created vs completed this week</p>
              </div>
              <div style={{ display: "flex", gap: "14px", alignItems: "center" }}>
                {[{color:"#0EA5E9",label:"Created"},{color:"#10B981",label:"Completed"}].map(l => (
                  <div key={l.label} style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                    <div style={{ width: "10px", height: "10px", background: l.color, borderRadius: "2px" }} />
                    <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>{l.label}</span>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: "10px", height: "120px", marginBottom: "10px" }}>
              {weekly.map(d => (
                <div key={d.day} style={{ flex: 1, display: "flex", alignItems: "flex-end", gap: "3px", height: "100%" }}>
                  <div style={{ flex: 1, background: "rgba(14,165,233,0.85)", borderRadius: "3px 3px 0 0", height: `${(d.tasks / maxWeek) * 100}%`, minHeight: "4px" }} />
                  <div style={{ flex: 1, background: "rgba(16,185,129,0.85)", borderRadius: "3px 3px 0 0", height: `${(d.completed / maxWeek) * 100}%`, minHeight: "4px" }} />
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: "10px" }}>
              {weekly.map(d => <div key={d.day} style={{ flex: 1, textAlign: "center", fontSize: "10px", color: "var(--text-muted)", fontWeight: 600 }}>{d.day}</div>)}
            </div>
          </motion.div>

          {/* Monthly line */}
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.33 }} className="liquid-card" style={{ padding: "24px" }}>
            <h3 style={{ fontFamily: "var(--font-display)", fontSize: "14px", fontWeight: 700, color: "var(--text-primary)", marginBottom: "4px" }}>Meetings Per Month</h3>
            <p style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "24px" }}>{monthRange(0)} - {monthRange(11)}</p>
            <div style={{ position: "relative", height: "120px", marginBottom: "10px" }}>
              <svg width="100%" height="120" viewBox="0 0 400 120" preserveAspectRatio="none" style={{ overflow: "visible" }}>
                <defs>
                  <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0EA5E9" stopOpacity="0.25" />
                    <stop offset="100%" stopColor="#6366F1" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <path
                  d={`M0,${120-(monthly[0]/maxMonthly)*100} ${monthly.map((v,i) => `L${(i/11)*400},${120-(v/maxMonthly)*100}`).join(" ")} L400,120 L0,120 Z`}
                  fill="url(#areaGrad)"
                />
                <path
                  d={monthly.map((v,i) => `${i===0?"M":"L"}${(i/11)*400},${120-(v/maxMonthly)*100}`).join(" ")}
                  fill="none" stroke="url(#lineGrad)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                />
                <defs>
                  <linearGradient id="lineGrad" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#0EA5E9" />
                    <stop offset="100%" stopColor="#6366F1" />
                  </linearGradient>
                </defs>
                {monthly.map((v,i) => (
                  <circle key={i} cx={(i/11)*400} cy={120-(v/maxMonthly)*100} r="3" fill="#7DD3FC" />
                ))}
              </svg>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              {MONTH_LABELS.map((_, i) => monthLabel(i)).map(m => <div key={m} style={{ fontSize: "9px", color: "var(--text-muted)", fontWeight: 600 }}>{m}</div>)}
            </div>
          </motion.div>
        </div>

        {/* Team table */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.38 }} className="data-card">
          <div style={{ padding: "18px 24px", borderBottom: "1px solid var(--glass-border)" }}>
            <h3 style={{ fontFamily: "var(--font-display)", fontSize: "14px", fontWeight: 700, color: "var(--text-primary)" }}>Team Performance</h3>
          </div>
          <table className="data-table">
            <thead><tr><th>Member</th><th>Assigned</th><th>Completed</th><th>Rate</th><th style={{ width: "180px" }}>Progress</th></tr></thead>
            <tbody>
              {team.length === 0 ? (
                <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--text-muted)", padding: "32px" }}>No team data yet</td></tr>
              ) : team.map((m, i) => (
                <motion.tr key={m.name} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.45 + i * 0.06 }}>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <div className="avatar avatar-md">{m.initials}</div>
                      <span style={{ color: "var(--text-primary)", fontWeight: 500 }}>{m.name}</span>
                    </div>
                  </td>
                  <td>{m.tasks}</td>
                  <td>{m.completed}</td>
                  <td>
                    <span style={{ fontSize: "15px", fontWeight: 800, fontFamily: "var(--font-display)", color: m.rate >= 90 ? "var(--emerald-pulse)" : m.rate >= 80 ? "var(--amber-alert)" : "var(--crimson)" }}>
                      {m.rate}%
                    </span>
                  </td>
                  <td>
                    <div className="progress-track">
                      <div className={`progress-fill ${m.rate >= 90 ? "progress-fill-green" : m.rate >= 80 ? "progress-fill-amber" : ""}`} style={{ width: `${m.rate}%` }} />
                    </div>
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </motion.div>
      </div>
    </div>
  );
}