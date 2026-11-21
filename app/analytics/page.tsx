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
// Whole-number axis: 4 steps of 1, 2, 5, 10, 20, 50...
function niceTicks(v: number) {
  const raw = Math.max(1, v) / 4;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 5, 10].map(m => m * p).find(x => x >= raw) ?? 10 * p;
  const s = Math.max(1, Math.round(step));
  return [4, 3, 2, 1, 0].map(i => i * s);
}

// Smooth line through the points (monotone-ish cubic), so the area chart looks clean.
function smooth(pts: [number, number][]) {
  if (pts.length < 2) return pts.map(([x, y], i) => `${i ? "L" : "M"}${x},${y}`).join(" ");
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
    const cx = (x0 + x1) / 2;
    d += ` C${cx},${y0} ${cx},${y1} ${x1},${y1}`;
  }
  return d;
}

type Group = { label: string; values: number[]; title: string };

// Area chart with gradient fills, a hover line and a tooltip.
function AreaChart({ groups, series, height = 150 }: { groups: Group[]; series: { name: string; color: string }[]; height?: number }) {
  const W = 600, H = height;
  const ticks = niceTicks(Math.max(...groups.flatMap(g => g.values)));
  const max = ticks[0];
  const [hover, setHover] = useState<number | null>(null);
  const x = (i: number) => groups.length < 2 ? W / 2 : (i / (groups.length - 1)) * W;
  const y = (v: number) => H - (v / max) * (H - 6) - 1;
  return (
    <div className="an-chart">
      <div className="an-yaxis" style={{ height }}>{ticks.map(t => <span key={t}>{t}</span>)}</div>
      <div style={{ flex: 1, minWidth: 0, position: "relative" }}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="an-svg" style={{ height }}
          onMouseMove={e => { const r = e.currentTarget.getBoundingClientRect(); setHover(Math.max(0, Math.min(groups.length - 1, Math.round(((e.clientX - r.left) / r.width) * (groups.length - 1))))); }}
          onMouseLeave={() => setHover(null)}>
          <defs>
            {series.map((s, j) => (
              <linearGradient key={s.name} id={`an-fill-${j}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity="0.32" />
                <stop offset="100%" stopColor={s.color} stopOpacity="0" />
              </linearGradient>
            ))}
          </defs>
          {ticks.map(t => <line key={t} x1="0" x2={W} y1={y(t)} y2={y(t)} className="an-gridline" />)}
          {series.map((s, j) => {
            const pts = groups.map((g, i) => [x(i), y(g.values[j])] as [number, number]);
            const line = smooth(pts);
            return (
              <g key={s.name}>
                <path d={`${line} L${W},${H} L0,${H} Z`} fill={`url(#an-fill-${j})`} />
                <path d={line} fill="none" stroke={s.color} strokeWidth="2.2" vectorEffect="non-scaling-stroke" strokeLinecap="round" />
              </g>
            );
          })}
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1="0" y2={H} className="an-hoverline" />}
        </svg>
        {hover !== null && series.map((s, j) => (
          <span key={s.name} className="an-point" style={{ left: `${(x(hover) / W) * 100}%`, top: y(groups[hover].values[j]), background: s.color }} />
        ))}
        {hover !== null && (
          <div className="an-tip" style={{ left: `${(x(hover) / W) * 100}%`, bottom: "auto", top: -8, transform: `translate(${hover > groups.length * 0.7 ? "-105%" : "8%"}, 0)` }}>
            <strong>{groups[hover].title}</strong>
            {series.map((s, j) => <div key={s.name}><i style={{ background: s.color }} />{s.name}: {groups[hover].values[j]}</div>)}
          </div>
        )}
        <div className="an-xaxis">{groups.map((g, i) => <span key={g.label + i}>{g.label}</span>)}</div>
      </div>
    </div>
  );
}

// Column chart with rounded gradient bars and the value on top of each.
function Columns({ groups, color, height = 150 }: { groups: Group[]; color: [string, string]; height?: number }) {
  const ticks = niceTicks(Math.max(...groups.map(g => g.values[0])));
  const max = ticks[0];
  const [hover, setHover] = useState<number | null>(null);
  return (
    <div className="an-chart">
      <div className="an-yaxis" style={{ height }}>{ticks.map(t => <span key={t}>{t}</span>)}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="an-plot" style={{ height }}>
          {ticks.map(t => <div key={t} className="an-grid" style={{ bottom: `${(t / max) * 100}%` }} />)}
          {groups.map((g, i) => {
            const v = g.values[0];
            return (
              <div key={g.label + i} className={`an-group${hover === i ? " on" : ""}`} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                <div className="an-col" style={{ height: v ? `${(v / max) * 100}%` : "3px", background: v ? `linear-gradient(180deg, ${color[0]}, ${color[1]})` : "rgba(127,127,127,0.18)" }}>
                  {v > 0 && <span className="an-col-val">{v}</span>}
                </div>
                {hover === i && <div className="an-tip"><strong>{g.title}</strong><div>{v} meeting{v === 1 ? "" : "s"}</div></div>}
              </div>
            );
          })}
        </div>
        <div className="an-xaxis">{groups.map((g, i) => <span key={g.label + i}>{g.label}</span>)}</div>
      </div>
    </div>
  );
}

// Donut with the total in the middle.
function Donut({ parts, label }: { parts: { name: string; n: number; color: string }[]; label: string }) {
  const total = parts.reduce((s, p) => s + p.n, 0);
  const R = 42, C = 2 * Math.PI * R;
  let acc = 0;
  return (
    <div className="an-donut">
      <svg viewBox="0 0 100 100" width="112" height="112" role="img" aria-label={`${label}: ${parts.map(p => `${p.name} ${p.n}`).join(", ")}`}>
        <circle cx="50" cy="50" r={R} fill="none" stroke="rgba(127,127,127,0.14)" strokeWidth="11" />
        {total > 0 && parts.filter(p => p.n > 0).map(p => {
          const len = (p.n / total) * C;
          const el = <circle key={p.name} cx="50" cy="50" r={R} fill="none" stroke={p.color} strokeWidth="11" strokeDasharray={`${Math.max(0, len - 1.5)} ${C}`} strokeDashoffset={-acc} transform="rotate(-90 50 50)" strokeLinecap="butt"><title>{`${p.name}: ${p.n}`}</title></circle>;
          acc += len;
          return el;
        })}
        <text x="50" y="49" textAnchor="middle" className="an-donut-n">{total}</text>
        <text x="50" y="62" textAnchor="middle" className="an-donut-l">{label}</text>
      </svg>
      <div className="an-list" style={{ flex: 1, minWidth: 0 }}>
        {parts.map(p => (
          <div key={p.name}><span><i style={{ background: p.color }} />{p.name}</span><strong>{p.n}<em>{total ? ` ${Math.round((p.n / total) * 100)}%` : ""}</em></strong></div>
        ))}
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
      { label: "Meetings", value: String(cur.m.length), unit: "", ...change(cur.m.length, prev.m.length) },
      // Under an hour reads as minutes, otherwise hours; the unit is shown small next to the number
      (() => { const h = hours(cur.m); return h < 1
        ? { label: "Recorded", value: String(Math.round(h * 60)), unit: "min", ...change(h, hours(prev.m)) }
        : { label: "Recorded", value: h.toFixed(1).replace(/\.0$/, ""), unit: "hrs", ...change(h, hours(prev.m)) }; })(),
      { label: "Tasks created", value: String(cur.t.length), unit: "", ...change(cur.t.length, prev.t.length) },
      { label: "Completion", value: String(rate(cur.t)), unit: "%", ...(() => { const d = rate(cur.t) - rate(prev.t); return { text: prev.t.length ? `${d >= 0 ? "+" : ""}${d} pts vs previous` : "No earlier data", tone: d > 0 ? "up" : d < 0 ? "down" : "flat" }; })() },
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
    const late = (x: TaskRow) => !done(x) && !!x.due_date && x.due_date < today;
    const status = [
      { name: "Completed", n: tasks.filter(done).length, color: "#10B981" },
      { name: "In progress", n: tasks.filter(x => x.status === "In Progress" && !late(x)).length, color: "#0EA5E9" },
      { name: "Open", n: tasks.filter(x => !done(x) && x.status !== "In Progress" && !late(x)).length, color: "#94A3B8" },
      { name: "Overdue", n: tasks.filter(late).length, color: "#EF4444" },
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
              <div className="an-kpi-value"><span className="text-gradient">{k.value}</span>{k.unit && <span className="an-kpi-unit">{k.unit}</span>}</div>
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
            <AreaChart groups={view.taskGroups} series={[{ name: "Created", color: "#0EA5E9" }, { name: "Completed", color: "#10B981" }]} />
          </div>

          <div className="data-card an-card">
            <div className="an-card-head">
              <div>
                <h3>Meetings per month</h3>
                <p>Recorded or uploaded, last 12 months</p>
              </div>
            </div>
            <Columns groups={view.monthGroups} color={["#818CF8", "#0EA5E9"]} />
          </div>
        </div>

        <div className="an-row an-row-3">
          <div className="data-card an-card">
            <div className="an-card-head"><div><h3>Task status</h3><p>All tasks in this workspace</p></div></div>
            <Donut parts={view.status} label="tasks" />
          </div>

          <div className="data-card an-card">
            <div className="an-card-head"><div><h3>Platforms</h3><p>Meetings in this period</p></div></div>
            {view.byPlatform.length === 0 ? <p className="an-empty">No meetings in this period.</p> : (
              <Donut parts={view.byPlatform.map(([k, n]) => ({ name: (PLATFORM[k] ?? PLATFORM.other).name, n, color: (PLATFORM[k] ?? PLATFORM.other).color }))} label="meetings" />
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
                        <span className="an-member-rate"><b>{m.rate}%</b> · {m.completed}/{m.tasks}</span>
                      </div>
                      <div className="an-meter"><div style={{ width: `${m.rate}%`, background: "linear-gradient(90deg, #0EA5E9, #10B981)" }} /></div>
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
.an-body { padding: 16px 28px; }
@media (max-width: 700px) { .an-body { padding: 16px; } }
.an-seg { display: inline-flex; padding: 2px; border-radius: 999px; background: var(--glass-surface); border: 1px solid var(--glass-border); }
.an-seg button { border: 0; background: transparent; color: var(--text-secondary); font-size: 12px; font-weight: 600; padding: 6px 14px; border-radius: 999px; cursor: pointer; transition: background 150ms; }
.an-seg button.on { background: rgba(14,165,233,0.16); color: var(--text-primary); }
.an-kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 12px; }
@media (max-width: 900px) { .an-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.an-kpi { padding: 11px 14px; display: grid; grid-template-columns: 1fr auto; align-items: end; column-gap: 8px; }
.an-kpi-label { grid-column: 1 / -1; }
.an-kpi-label { font-size: 12px; color: var(--text-muted); font-weight: 600; }
.an-kpi-value { font-size: 27px; margin: 2px 0 0; line-height: 1.15; font-variant-numeric: tabular-nums; }
.an-kpi-unit { font-family: var(--font-body); font-size: 13px; font-weight: 600; letter-spacing: 0; color: var(--text-muted); margin-left: 4px; }
.an-kpi-change { font-size: 11px; font-weight: 600; color: var(--text-muted); text-align: right; padding-bottom: 3px; }
.an-kpi-change.up { color: var(--emerald-pulse); }
.an-kpi-change.down { color: var(--crimson); }
.an-row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-bottom: 12px; }
.an-row-3 { grid-template-columns: 1fr 1fr 1.3fr; }
@media (max-width: 1100px) { .an-row, .an-row-3 { grid-template-columns: minmax(0, 1fr); } }
.an-card { padding: 12px 16px; }
.an-card-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 10px; }
.an-card-head h3 { font-size: 14px; font-weight: 700; color: var(--text-primary); margin: 0 0 2px; }
.an-card-head p { font-size: 11px; color: var(--text-muted); margin: 0; }
.an-legend, .an-list span { display: flex; gap: 12px; align-items: center; font-size: 11px; color: var(--text-muted); }
.an-legend span { display: inline-flex; align-items: center; gap: 5px; }
.an-legend i, .an-list i { width: 8px; height: 8px; border-radius: 50%; display: inline-block; margin-right: 6px; }
.an-chart { display: flex; gap: 8px; }
.an-yaxis { display: flex; flex-direction: column; justify-content: space-between; font-size: 10px; color: var(--text-muted); text-align: right; min-width: 18px; font-variant-numeric: tabular-nums; transform: translateY(5px); }
.an-plot { position: relative; display: flex; align-items: flex-end; gap: 4px; }
.an-grid { position: absolute; left: 0; right: 0; border-top: 1px dashed rgba(127,127,127,0.18); }
.an-group { position: relative; flex: 1; min-width: 0; height: 100%; display: flex; align-items: flex-end; justify-content: center; gap: 2px; border-radius: 4px; cursor: default; }
.an-group.on { background: rgba(127,127,127,0.08); }
.an-bar { flex: 1; max-width: 22px; border-radius: 3px 3px 0 0; min-height: 0; transition: height 200ms; }
.an-tip { position: absolute; bottom: calc(100% + 6px); left: 50%; transform: translateX(-50%); z-index: 5; white-space: nowrap; padding: 8px 10px; border-radius: 8px; font-size: 11px; background: var(--bg-elevated); border: 1px solid var(--glass-border); box-shadow: 0 8px 20px rgba(0,0,0,0.25); color: var(--text-secondary); pointer-events: none; }
.an-tip strong { display: block; color: var(--text-primary); margin-bottom: 3px; }
.an-tip i { width: 7px; height: 7px; border-radius: 50%; display: inline-block; margin-right: 5px; }
.an-xaxis { display: flex; gap: 3px; margin-top: 6px; }
.an-xaxis span { flex: 1; min-width: 0; text-align: center; font-size: 10px; color: var(--text-muted); white-space: nowrap; overflow: visible; }
.an-svg { width: 100%; display: block; overflow: visible; cursor: crosshair; }
.an-gridline { stroke: rgba(127,127,127,0.16); stroke-dasharray: 3 4; vector-effect: non-scaling-stroke; }
.an-hoverline { stroke: rgba(127,127,127,0.45); vector-effect: non-scaling-stroke; }
.an-point { position: absolute; width: 9px; height: 9px; border-radius: 50%; transform: translate(-50%, -50%); box-shadow: 0 0 0 3px var(--bg-elevated); pointer-events: none; }
.an-col { position: relative; width: 62%; max-width: 30px; border-radius: 6px 6px 2px 2px; transition: height 250ms, filter 150ms; }
.an-group.on .an-col { filter: brightness(1.15); }
.an-col-val { position: absolute; top: -16px; left: 50%; transform: translateX(-50%); font-size: 10px; font-weight: 700; color: var(--text-secondary); font-variant-numeric: tabular-nums; }
.an-donut { display: flex; align-items: center; gap: 16px; }
.an-donut-n { font-family: var(--font-display); font-size: 20px; font-weight: 800; fill: var(--text-primary); }
.an-donut-l { font-size: 8px; fill: var(--text-muted); }
.an-list strong em { font-style: normal; font-weight: 500; color: var(--text-muted); font-size: 11px; margin-left: 4px; }
.an-member-rate b { color: var(--text-primary); }
.an-stack { display: flex; height: 8px; border-radius: 6px; overflow: hidden; background: rgba(127,127,127,0.12); margin-bottom: 10px; }
.an-list { display: flex; flex-direction: column; gap: 7px; }
.an-list > div { display: flex; justify-content: space-between; align-items: center; font-size: 13px; }
.an-list span { font-size: 13px; color: var(--text-secondary); gap: 0; }
.an-list strong { color: var(--text-primary); font-variant-numeric: tabular-nums; }
.an-meter { height: 7px; border-radius: 4px; background: rgba(127,127,127,0.14); overflow: hidden; }
.an-meter > div { height: 100%; border-radius: 4px; }
.an-empty { font-size: 13px; color: var(--text-muted); margin: 0; }
.an-team { display: flex; flex-direction: column; gap: 8px; max-height: 172px; overflow-y: auto; }
.an-member { display: flex; gap: 10px; align-items: center; }
.an-member-name { font-size: 13px; font-weight: 600; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.an-member-rate { font-size: 12px; color: var(--text-muted); white-space: nowrap; }
.an-member .an-meter { margin: 5px 0 3px; }
.an-member-sub { font-size: 11px; color: var(--text-muted); }
`;
