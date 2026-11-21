"use client";
export const dynamic = 'force-dynamic';
// Analytics: KPIs for the chosen period (with the change from the period before), task and meeting
// charts with axes and hover values, platform and status breakdowns, and team performance.

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/current-user";
import { getFirstWorkspaceId } from "@/lib/workspace";
import { useWorkspace } from "@/app/components/WorkspaceContext";

type Range = "week" | "month" | "quarter";
const RANGE_DAYS: Record<Range, number> = { week: 7, month: 30, quarter: 90 };
const RANGE_LABEL: Record<Range, string> = { week: "Last 7 days", month: "Last 30 days", quarter: "Last 90 days" };

type MeetingRow = { started_at: string | null; duration_secs: number | null; platform: string | null; status: string | null };
type TaskRow = { created_at: string; status: string | null; due_date: string | null; assignee_id: string | null; completed_at: string | null };
type Member = { user_id: string; users: { first_name: string | null; last_name: string | null } | null };

const PLATFORM: Record<string, { name: string; color: string }> = {
  zoom: { name: "Zoom", color: "#2D8CFF" },
  teams: { name: "Teams", color: "#7B83EB" },
  google_meet: { name: "Google Meet", color: "#00AC47" },
  upload: { name: "Upload", color: "#F59E0B" },
  webex: { name: "Webex", color: "#00BCEB" },
  other: { name: "Other", color: "#6B7280" },
};

const dayKey = (d: Date) => d.toLocaleDateString("en-CA");
const niceMax = (v: number) => { if (v <= 4) return 4; const p = Math.pow(10, Math.floor(Math.log10(v))); return Math.ceil(v / p) * p; };

// Simple bar chart with a y-axis and a value on hover.
function Bars({ groups, series, height = 170 }: {
  groups: { label: string; values: number[]; title: string }[];
  series: { name: string; color: string }[];
  height?: number;
}) {
  const max = niceMax(Math.max(1, ...groups.flatMap(g => g.values)));
  const ticks = [max, max * 0.75, max * 0.5, max * 0.25, 0].map(t => Math.round(t * 10) / 10);
  const [hover, setHover] = useState<number | null>(null);
  return (
    <div className="an-chart">
      <div className="an-yaxis" style={{ height }}>{ticks.map(t => <span key={t}>{t}</span>)}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="an-plot" style={{ height }}>
          {ticks.map(t => <div key={t} className="an-grid" style={{ bottom: `${(t / max) * 100}%` }} />)}
          {groups.map((g, i) => (
            <div key={g.label + i} className={`an-group${hover === i ? " on" : ""}`} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              {g.values.map((v, j) => (
                <div key={j} className="an-bar" style={{ height: `${(v / max) * 100}%`, background: series[j].color }} />
              ))}
              {hover === i && (
                <div className="an-tip">
                  <strong>{g.title}</strong>
                  {series.map((s, j) => <div key={s.name}><i style={{ background: s.color }} />{s.name}: {g.values[j]}</div>)}
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="an-xaxis">{groups.map((g, i) => <span key={g.label + i}>{g.label}</span>)}</div>
      </div>
    </div>
  );
}

export default function AnalyticsPage() {
  const { activeWorkspace } = useWorkspace();
  const router = useRouter();
  const [range, setRange] = useState<Range>("month");
  const [meetings, setMeetings] = useState<MeetingRow[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const user = await getCurrentUser();
    if (!user) { router.push("/login"); return; }
    const wsId = activeWorkspace?.workspace_id ?? (await getFirstWorkspaceId(user.id));
    if (!wsId) { setLoading(false); return; }

    const since = new Date(); since.setMonth(since.getMonth() - 12); since.setDate(1);
    const [m, t, mem] = await Promise.all([
      supabase.from("meetings").select("started_at, duration_secs, platform, status").eq("workspace_id", wsId).gte("started_at", since.toISOString()),
      supabase.from("tasks").select("created_at, status, due_date, assignee_id, completed_at").eq("workspace_id", wsId),
      supabase.from("workspace_members").select("user_id, users(first_name, last_name)").eq("workspace_id", wsId),
    ]);
    setMeetings((m.data ?? []) as MeetingRow[]);
    setTasks((t.data ?? []) as TaskRow[]);
    setMembers((mem.data ?? []) as unknown as Member[]);
    setLoading(false);
  }, [router, activeWorkspace]);

  useEffect(() => { load(); }, [load]);

  const view = useMemo(() => {
    const days = RANGE_DAYS[range];
    const now = Date.now();
    const start = now - days * 86400000;
    const prevStart = start - days * 86400000;
    const inRange = (iso: string | null, a: number, b: number) => !!iso && new Date(iso).getTime() >= a && new Date(iso).getTime() < b;
    const done = (t: TaskRow) => t.status === "Completed";

    const past = meetings.filter(x => x.status !== "scheduled");
    const cur = { m: past.filter(x => inRange(x.started_at, start, now)), t: tasks.filter(x => inRange(x.created_at, start, now)) };
    const prev = { m: past.filter(x => inRange(x.started_at, prevStart, start)), t: tasks.filter(x => inRange(x.created_at, prevStart, start)) };
    const rate = (ts: TaskRow[]) => ts.length ? Math.round((ts.filter(done).length / ts.length) * 100) : 0;
    const hours = (ms: MeetingRow[]) => ms.reduce((s, x) => s + (x.duration_secs ?? 0), 0) / 3600;

    const change = (a: number, b: number, unit = "") => {
      if (b === 0 && a === 0) return { text: "No change", tone: "flat" };
      if (b === 0) return { text: `+${Math.round(a * 10) / 10}${unit} vs previous`, tone: "up" };
      const d = Math.round(((a - b) / b) * 100);
      return { text: `${d >= 0 ? "+" : ""}${d}% vs previous`, tone: d > 0 ? "up" : d < 0 ? "down" : "flat" };
    };

    const kpis = [
      { label: "Meetings", value: String(cur.m.length), ...change(cur.m.length, prev.m.length) },
      { label: "Hours recorded", value: hours(cur.m).toFixed(1), ...change(hours(cur.m), hours(prev.m), "h") },
      { label: "Tasks created", value: String(cur.t.length), ...change(cur.t.length, prev.t.length) },
      { label: "Completion rate", value: `${rate(cur.t)}%`, ...(() => { const d = rate(cur.t) - rate(prev.t); return { text: prev.t.length ? `${d >= 0 ? "+" : ""}${d} pts vs previous` : "No earlier data", tone: d > 0 ? "up" : d < 0 ? "down" : "flat" }; })() },
    ];

    // Tasks per day (week/month) or per week (quarter)
    const bucket = range === "quarter" ? 7 : 1;
    const nBuckets = Math.ceil(days / bucket);
    const taskGroups = Array.from({ length: nBuckets }, (_, i) => {
      const a = start + i * bucket * 86400000, b = Math.min(a + bucket * 86400000, now + 1);
      const d = new Date(a);
      const created = tasks.filter(x => inRange(x.created_at, a, b)).length;
      const completed = tasks.filter(x => inRange(x.completed_at, a, b)).length;
      const label = range === "week" ? d.toLocaleDateString("en-AU", { weekday: "short" })
        : range === "month" ? (i % 5 === 0 ? d.toLocaleDateString("en-AU", { day: "numeric", month: "short" }) : "")
        : (i % 2 === 0 ? d.toLocaleDateString("en-AU", { day: "numeric", month: "short" }) : "");
      const title = bucket === 1 ? d.toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "short" }) : `Week of ${d.toLocaleDateString("en-AU", { day: "numeric", month: "short" })}`;
      return { label, title, values: [created, completed] };
    });

    // Meetings per month, last 12 months
    const monthGroups = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 11 + i);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      const n = past.filter(x => x.started_at && `${new Date(x.started_at).getFullYear()}-${new Date(x.started_at).getMonth()}` === key).length;
      return { label: d.toLocaleDateString("en-AU", { month: "short" }), title: d.toLocaleDateString("en-AU", { month: "long", year: "numeric" }), values: [n] };
    });

    // Platform split for the period
    const byPlatform = Object.entries(cur.m.reduce<Record<string, number>>((acc, x) => { const k = x.platform ?? "other"; acc[k] = (acc[k] ?? 0) + 1; return acc; }, {}))
      .sort((a, b) => b[1] - a[1]);

    // Task status right now
    const today = dayKey(new Date());
    const overdue = tasks.filter(x => !done(x) && x.due_date && x.due_date < today).length;
    const status = [
      { name: "Completed", n: tasks.filter(done).length, color: "#10B981" },
      { name: "In progress", n: tasks.filter(x => x.status === "In Progress").length, color: "#0EA5E9" },
      { name: "Open", n: tasks.filter(x => !done(x) && x.status !== "In Progress").length - overdue, color: "#94A3B8" },
      { name: "Overdue", n: overdue, color: "#EF4444" },
    ];

    const team = members.map(mb => {
      const name = `${mb.users?.first_name ?? ""} ${mb.users?.last_name ?? ""}`.trim() || "Member";
      const initials = name.split(" ").map(p => p[0]).join("").slice(0, 2).toUpperCase();
      const mine = tasks.filter(x => x.assignee_id === mb.user_id);
      const c = mine.filter(done).length;
      const od = mine.filter(x => !done(x) && x.due_date && x.due_date < today).length;
      return { name, initials, tasks: mine.length, completed: c, open: mine.length - c, overdue: od, rate: mine.length ? Math.round((c / mine.length) * 100) : 0 };
    }).filter(r => r.tasks > 0).sort((a, b) => b.tasks - a.tasks);

    return { kpis, taskGroups, monthGroups, byPlatform, status, team, total: cur.m.length };
  }, [range, meetings, tasks, members]);

  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "60vh" }}>
      <div className="spinner" />
    </div>
  );

  const statusTotal = Math.max(1, view.status.reduce((s, x) => s + x.n, 0));

  return (
    <div style={{ paddingBottom: "48px" }} className="page-enter">
      <style>{AN_CSS}</style>
      <div className="page-header">
        <div>
          <div className="page-header-title">Analytics</div>
          <div className="page-header-sub">{RANGE_LABEL[range]}, compared with the {RANGE_DAYS[range]} days before</div>
        </div>
        <div className="an-seg" role="tablist" aria-label="Date range">
          {(["week", "month", "quarter"] as Range[]).map(r => (
            <button key={r} role="tab" aria-selected={range === r} className={range === r ? "on" : ""} onClick={() => setRange(r)}>
              {r === "week" ? "7 days" : r === "month" ? "30 days" : "90 days"}
            </button>
          ))}
        </div>
      </div>

      <div className="page-body an-body">
        <div className="an-kpis">
          {view.kpis.map(k => (
            <div key={k.label} className="data-card an-kpi">
              <div className="an-kpi-label">{k.label}</div>
              <div className="an-kpi-value">{k.value}</div>
              <div className={`an-kpi-change ${k.tone}`}>{k.text}</div>
            </div>
          ))}
        </div>

        <div className="an-row">
          <div className="data-card an-card">
            <div className="an-card-head">
              <div>
                <h3>Tasks created and completed</h3>
                <p>{range === "quarter" ? "Per week" : "Per day"} · hover a bar for numbers</p>
              </div>
              <div className="an-legend"><span><i style={{ background: "#0EA5E9" }} />Created</span><span><i style={{ background: "#10B981" }} />Completed</span></div>
            </div>
            <Bars groups={view.taskGroups} series={[{ name: "Created", color: "#0EA5E9" }, { name: "Completed", color: "#10B981" }]} />
          </div>

          <div className="data-card an-card">
            <div className="an-card-head">
              <div>
                <h3>Meetings per month</h3>
                <p>Recorded or uploaded, last 12 months</p>
              </div>
            </div>
            <Bars groups={view.monthGroups} series={[{ name: "Meetings", color: "#6366F1" }]} />
          </div>
        </div>

        <div className="an-row an-row-3">
          <div className="data-card an-card">
            <div className="an-card-head"><div><h3>Task status</h3><p>All tasks in this workspace</p></div></div>
            <div className="an-stack">
              {view.status.filter(s => s.n > 0).map(s => <div key={s.name} style={{ width: `${(s.n / statusTotal) * 100}%`, background: s.color }} title={`${s.name}: ${s.n}`} />)}
            </div>
            <div className="an-list">
              {view.status.map(s => (
                <div key={s.name}><span><i style={{ background: s.color }} />{s.name}</span><strong>{s.n}</strong></div>
              ))}
            </div>
          </div>

          <div className="data-card an-card">
            <div className="an-card-head"><div><h3>Platforms</h3><p>Meetings in this period</p></div></div>
            {view.byPlatform.length === 0 ? <p className="an-empty">No meetings in this period.</p> : (
              <div className="an-list">
                {view.byPlatform.map(([k, n]) => {
                  const p = PLATFORM[k] ?? PLATFORM.other;
                  return (
                    <div key={k} style={{ display: "block" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "5px" }}><span><i style={{ background: p.color }} />{p.name}</span><strong>{n}</strong></div>
                      <div className="an-meter"><div style={{ width: `${(n / view.total) * 100}%`, background: p.color }} /></div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="data-card an-card">
            <div className="an-card-head"><div><h3>Team performance</h3><p>Tasks assigned to each member</p></div></div>
            {view.team.length === 0 ? <p className="an-empty">No tasks have been assigned yet.</p> : (
              <div className="an-team">
                {view.team.map(m => (
                  <div key={m.name} className="an-member">
                    <div className="avatar avatar-sm">{m.initials}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: "8px" }}>
                        <span className="an-member-name">{m.name}</span>
                        <span className="an-member-rate">{m.completed}/{m.tasks} done</span>
                      </div>
                      <div className="an-meter"><div style={{ width: `${m.rate}%`, background: "#10B981" }} /></div>
                      <div className="an-member-sub">{m.open} open{m.overdue ? <span style={{ color: "var(--crimson)" }}> · {m.overdue} overdue</span> : ""}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const AN_CSS = `
.an-body { padding: 24px 36px; }
@media (max-width: 700px) { .an-body { padding: 16px; } }
.an-seg { display: inline-flex; padding: 2px; border-radius: 999px; background: var(--glass-surface); border: 1px solid var(--glass-border); }
.an-seg button { border: 0; background: transparent; color: var(--text-secondary); font-size: 12px; font-weight: 600; padding: 6px 14px; border-radius: 999px; cursor: pointer; transition: background 150ms; }
.an-seg button.on { background: rgba(14,165,233,0.16); color: var(--text-primary); }
.an-kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; margin-bottom: 18px; }
@media (max-width: 900px) { .an-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.an-kpi { padding: 14px 16px; }
.an-kpi-label { font-size: 12px; color: var(--text-muted); font-weight: 600; }
.an-kpi-value { font-size: 26px; font-weight: 700; color: var(--text-primary); margin: 4px 0 2px; font-variant-numeric: tabular-nums; }
.an-kpi-change { font-size: 11px; font-weight: 600; color: var(--text-muted); }
.an-kpi-change.up { color: var(--emerald-pulse); }
.an-kpi-change.down { color: var(--crimson); }
.an-row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin-bottom: 14px; }
.an-row-3 { grid-template-columns: 1fr 1fr 1.3fr; }
@media (max-width: 1100px) { .an-row, .an-row-3 { grid-template-columns: minmax(0, 1fr); } }
.an-card { padding: 16px 18px; }
.an-card-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 14px; }
.an-card-head h3 { font-size: 14px; font-weight: 700; color: var(--text-primary); margin: 0 0 2px; }
.an-card-head p { font-size: 12px; color: var(--text-muted); margin: 0; }
.an-legend, .an-list span { display: flex; gap: 12px; align-items: center; font-size: 11px; color: var(--text-muted); }
.an-legend span { display: inline-flex; align-items: center; gap: 5px; }
.an-legend i, .an-list i { width: 8px; height: 8px; border-radius: 50%; display: inline-block; margin-right: 6px; }
.an-chart { display: flex; gap: 8px; }
.an-yaxis { display: flex; flex-direction: column; justify-content: space-between; font-size: 10px; color: var(--text-muted); text-align: right; min-width: 18px; font-variant-numeric: tabular-nums; transform: translateY(5px); }
.an-plot { position: relative; display: flex; align-items: flex-end; gap: 3px; border-bottom: 1px solid var(--glass-border); }
.an-grid { position: absolute; left: 0; right: 0; border-top: 1px dashed rgba(127,127,127,0.18); }
.an-group { position: relative; flex: 1; min-width: 0; height: 100%; display: flex; align-items: flex-end; justify-content: center; gap: 2px; border-radius: 4px; cursor: default; }
.an-group.on { background: rgba(127,127,127,0.08); }
.an-bar { flex: 1; max-width: 22px; border-radius: 3px 3px 0 0; min-height: 0; transition: height 200ms; }
.an-tip { position: absolute; bottom: calc(100% + 6px); left: 50%; transform: translateX(-50%); z-index: 5; white-space: nowrap; padding: 8px 10px; border-radius: 8px; font-size: 11px; background: var(--bg-elevated); border: 1px solid var(--glass-border); box-shadow: 0 8px 20px rgba(0,0,0,0.25); color: var(--text-secondary); pointer-events: none; }
.an-tip strong { display: block; color: var(--text-primary); margin-bottom: 3px; }
.an-tip i { width: 7px; height: 7px; border-radius: 50%; display: inline-block; margin-right: 5px; }
.an-xaxis { display: flex; gap: 3px; margin-top: 6px; }
.an-xaxis span { flex: 1; min-width: 0; text-align: center; font-size: 10px; color: var(--text-muted); white-space: nowrap; overflow: visible; }
.an-stack { display: flex; height: 10px; border-radius: 6px; overflow: hidden; background: rgba(127,127,127,0.12); margin-bottom: 14px; }
.an-list { display: flex; flex-direction: column; gap: 10px; }
.an-list > div { display: flex; justify-content: space-between; align-items: center; font-size: 13px; }
.an-list span { font-size: 13px; color: var(--text-secondary); gap: 0; }
.an-list strong { color: var(--text-primary); font-variant-numeric: tabular-nums; }
.an-meter { height: 6px; border-radius: 4px; background: rgba(127,127,127,0.14); overflow: hidden; }
.an-meter > div { height: 100%; border-radius: 4px; }
.an-empty { font-size: 13px; color: var(--text-muted); margin: 0; }
.an-team { display: flex; flex-direction: column; gap: 12px; }
.an-member { display: flex; gap: 10px; align-items: center; }
.an-member-name { font-size: 13px; font-weight: 600; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.an-member-rate { font-size: 12px; color: var(--text-muted); white-space: nowrap; }
.an-member .an-meter { margin: 5px 0 3px; }
.an-member-sub { font-size: 11px; color: var(--text-muted); }
`;
