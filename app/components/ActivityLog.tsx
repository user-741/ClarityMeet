"use client";
// Workspace activity log (audit trail). Grouped by day, filterable, searchable, exportable.
// Quick repeated changes to the same item by the same person are folded into one line that can be expanded.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { History, Search, Download, ListChecks, FileText, Users, LogIn, ChevronDown } from "lucide-react";
import { supabase } from "@/lib/supabase";

type Row = {
  id: string; action: string; created_at: string; entity_type: string | null; entity_id: string | null;
  payload: Record<string, unknown> | null; user_id: string | null;
  users?: { first_name: string | null; last_name: string | null; email: string | null } | null;
};
type Filter = "all" | "tasks" | "meetings" | "members" | "logins";

const PAGE = 60;
const FILTERS: [Filter, string][] = [["all", "All"], ["tasks", "Tasks"], ["meetings", "Meetings"], ["members", "Members"], ["logins", "Sign-ins"]];
const kindOf = (a: string): Filter => a.startsWith("task.") ? "tasks" : a.startsWith("meeting.") ? "meetings" : a.startsWith("member.") ? "members" : a === "user.login" ? "logins" : "all";

const who = (r: Row) => {
  const name = [r.users?.first_name, r.users?.last_name].filter(Boolean).join(" ");
  return name || r.users?.email || (r.user_id ? "A member" : "ClarityMeet");
};
const initials = (n: string) => n === "ClarityMeet" ? "CM" : n.split(/\s+/).map(p => p[0]).join("").slice(0, 2).toUpperCase();
const title = (r: Row) => (typeof r.payload?.title === "string" ? r.payload.title : "");

// One readable sentence per action
function sentence(r: Row) {
  const p = r.payload ?? {};
  switch (r.action) {
    case "task.status_changed":
      if (p.to === "Completed") return "completed the task";
      if (p.from === "Completed") return "reopened the task";
      return `moved the task to ${String(p.to ?? "a new status")}`;
    case "task.created": return r.user_id ? "added the task" : "found the task in a meeting";
    case "task.deleted": return "deleted the task";
    case "meeting.created": return "added the meeting";
    case "meeting.deleted": return "deleted the meeting";
    case "meeting.summary_edited": return "edited the summary of";
    case "member.added": return "added";
    case "member.removed": return "removed";
    case "member.role_changed": return `changed the role of`;
    case "user.login": return "signed in";
    default: return r.action;
  }
}

const ICON: Record<Filter, typeof ListChecks> = { tasks: ListChecks, meetings: FileText, members: Users, logins: LogIn, all: History };

const dayLabel = (iso: string) => {
  const d = new Date(iso), key = d.toLocaleDateString("en-CA");
  const today = new Date().toLocaleDateString("en-CA");
  const yest = new Date(Date.now() - 86400000).toLocaleDateString("en-CA");
  const date = d.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", ...(d.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) });
  return key === today ? `Today · ${date}` : key === yest ? `Yesterday · ${date}` : date;
};

export default function ActivityLog({ workspaceId }: { workspaceId: string | null }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [more, setMore] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());

  const fetchPage = useCallback(async (from: number) => {
    if (!workspaceId) return [];
    const { data } = await supabase
      .from("audit_logs")
      .select("id, action, created_at, entity_type, entity_id, payload, user_id, users(first_name, last_name, email)")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .range(from, from + PAGE - 1);
    return (data ?? []) as unknown as Row[];
  }, [workspaceId]);

  useEffect(() => {
    fetchPage(0).then(r => { setRows(r); setMore(r.length === PAGE); });
  }, [fetchPage]);

  const loadMore = async () => {
    const next = await fetchPage(rows?.length ?? 0);
    setRows(r => [...(r ?? []), ...next]);
    setMore(next.length === PAGE);
  };

  // Filter, then fold quick repeats (same person, same item, same kind of change, within 10 minutes)
  const days = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = (rows ?? [])
      .filter(r => filter === "all" || kindOf(r.action) === filter)
      .filter(r => !term || `${who(r)} ${sentence(r)} ${title(r)}`.toLowerCase().includes(term));
    const groups: { key: string; items: Row[] }[] = [];
    for (const r of list) {
      const last = groups[groups.length - 1];
      const head = last?.items[0];
      if (head && head.action === r.action && head.user_id === r.user_id && head.entity_id && head.entity_id === r.entity_id
        && r.action !== "user.login"
        && new Date(last.items[last.items.length - 1].created_at).getTime() - new Date(r.created_at).getTime() < 10 * 60000) {
        last.items.push(r);
      } else if (head && r.action === "user.login" && head.action === "user.login" && head.user_id === r.user_id
        && new Date(head.created_at).toLocaleDateString("en-CA") === new Date(r.created_at).toLocaleDateString("en-CA")) {
        last.items.push(r);
      } else {
        groups.push({ key: r.id, items: [r] });
      }
    }
    const byDay: { label: string; groups: typeof groups }[] = [];
    for (const g of groups) {
      const label = dayLabel(g.items[0].created_at);
      if (byDay[byDay.length - 1]?.label === label) byDay[byDay.length - 1].groups.push(g);
      else byDay.push({ label, groups: [g] });
    }
    return byDay;
  }, [rows, filter, q]);

  const exportCsv = () => {
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const lines = [["When", "Who", "Action", "Item", "Details"].join(",")];
    for (const r of rows ?? []) {
      const p = r.payload ?? {};
      const extra = r.action === "task.status_changed" ? `${String(p.from ?? "")} -> ${String(p.to ?? "")}` : "";
      lines.push([new Date(r.created_at).toLocaleString("en-AU"), who(r), r.action, title(r), extra].map(esc).join(","));
    }
    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = "claritymeet-activity-log.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  const itemLink = (r: Row) => {
    const t = title(r);
    if (!t) return null;
    if (r.entity_type === "meetings" && r.entity_id && r.action !== "meeting.deleted") return <Link href={`/meeting-summary?id=${r.entity_id}`} className="al-item">{t}</Link>;
    if (r.entity_type === "tasks" && r.action !== "task.deleted") return <Link href="/tasks" className="al-item">{t}</Link>;
    return <span className="al-item plain">{t}</span>;
  };

  const time = (iso: string) => new Date(iso).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" });
  const full = (iso: string) => new Date(iso).toLocaleString("en-AU", { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" });

  return (
    <div className="data-card al">
      <style>{AL_CSS}</style>
      <div className="al-head">
        <div>
          <h3><History size={15} /> Activity log</h3>
          <p>Changes to meetings, tasks and members in this workspace, newest first.</p>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={exportCsv} disabled={!rows?.length}><Download size={13} /> Export CSV</button>
      </div>

      <div className="al-tools">
        <div className="al-chips" role="tablist">
          {FILTERS.map(([k, l]) => <button key={k} role="tab" aria-selected={filter === k} className={filter === k ? "on" : ""} onClick={() => setFilter(k)}>{l}</button>)}
        </div>
        <div className="al-search"><Search size={13} /><input placeholder="Search people or items" value={q} onChange={e => setQ(e.target.value)} aria-label="Search activity" /></div>
      </div>

      {rows === null ? (
        <div className="al-skel">{[0, 1, 2, 3].map(i => <div key={i} />)}</div>
      ) : days.length === 0 ? (
        <p className="al-empty">{rows.length ? "Nothing matches this filter." : "No activity recorded yet."}</p>
      ) : (
        <div className="al-body">
          {days.map(day => (
            <section key={day.label}>
              <div className="al-day">{day.label}</div>
              {day.groups.map(g => {
                const r = g.items[0];
                const name = who(r);
                const Icon = ICON[kindOf(r.action)];
                const many = g.items.length > 1;
                const open = openGroups.has(g.key);
                return (
                  <div key={g.key} className="al-row">
                    <div className={`al-avatar${r.user_id ? "" : " sys"}`} title={name}>{initials(name)}</div>
                    <div className="al-main">
                      <div className="al-line">
                        <strong>{name}</strong> {sentence(r)} {itemLink(r)}
                        {many && r.action === "user.login" && <span className="al-times"> · {g.items.length} times</span>}
                        {many && r.action !== "user.login" && (
                          <button className="al-more" onClick={() => setOpenGroups(s => { const n = new Set(s); if (n.has(g.key)) n.delete(g.key); else n.add(g.key); return n; })}>
                            {g.items.length} changes <ChevronDown size={12} style={{ transform: open ? "rotate(180deg)" : "none" }} />
                          </button>
                        )}
                      </div>
                      {many && open && r.action !== "user.login" && (
                        <ul className="al-sub">
                          {g.items.map(x => (
                            <li key={x.id}><span title={full(x.created_at)}>{time(x.created_at)}</span> {x.action === "task.status_changed" ? `${String(x.payload?.from ?? "?")} → ${String(x.payload?.to ?? "?")}` : sentence(x)}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <div className="al-meta">
                      <Icon size={13} />
                      <time dateTime={r.created_at} title={full(r.created_at)}>{time(r.created_at)}</time>
                    </div>
                  </div>
                );
              })}
            </section>
          ))}
          {more && <button className="btn btn-ghost btn-sm al-load" onClick={loadMore}>Load older activity</button>}
        </div>
      )}
    </div>
  );
}

const AL_CSS = `
.al-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; padding: 16px 20px 10px; }
.al-head h3 { display: flex; align-items: center; gap: 8px; font-family: var(--font-display); font-size: 15px; font-weight: 700; color: var(--text-primary); margin: 0; }
.al-head p { font-size: 12.5px; color: var(--text-secondary); margin: 4px 0 0; }
.al-tools { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; padding: 0 20px 12px; border-bottom: 1px solid var(--glass-border); }
.al-chips { display: flex; gap: 6px; flex-wrap: wrap; }
.al-chips button { padding: 5px 12px; border-radius: 999px; border: 1px solid var(--glass-border); background: transparent; color: var(--text-secondary); font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; }
.al-chips button.on { background: rgba(14,165,233,0.12); border-color: rgba(14,165,233,0.45); color: var(--text-primary); }
.al-search { display: flex; align-items: center; gap: 7px; height: 32px; padding: 0 10px; border-radius: 8px; border: 1px solid var(--glass-border); min-width: 200px; }
.al-search:focus-within { border-color: rgba(14,165,233,0.6); box-shadow: 0 0 0 3px rgba(14,165,233,0.14); }
.al-search svg { color: var(--text-muted); }
.al-search input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--text-primary); font: inherit; font-size: 12.5px; }
.al-body { padding: 4px 0 10px; max-height: 70vh; overflow-y: auto; }
.al-day { position: sticky; top: 0; z-index: 1; padding: 10px 20px 6px; font-size: 11px; font-weight: 700; letter-spacing: 0.04em; color: var(--text-muted); background: var(--bg-elevated); }
.al-row { display: flex; align-items: flex-start; gap: 12px; padding: 9px 20px; transition: background 150ms; }
.al-row:hover { background: rgba(127,127,127,0.06); }
.al-avatar { width: 28px; height: 28px; border-radius: 50%; flex-shrink: 0; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; color: var(--text-primary); background: rgba(14,165,233,0.14); }
.al-avatar.sys { background: rgba(127,127,127,0.14); color: var(--text-secondary); }
.al-main { flex: 1; min-width: 0; }
.al-line { font-size: 13px; color: var(--text-secondary); line-height: 1.5; padding-top: 4px; }
.al-line strong { color: var(--text-primary); font-weight: 600; }
.al-item { color: var(--text-primary); font-weight: 500; text-decoration: none; border-bottom: 1px dotted rgba(127,127,127,0.5); }
.al-item:hover { color: #38BDF8; border-bottom-color: #38BDF8; }
.al-item.plain { border-bottom: 0; }
.al-times { color: var(--text-muted); }
.al-more { display: inline-flex; align-items: center; gap: 3px; margin-left: 6px; padding: 1px 8px; border-radius: 999px; border: 1px solid var(--glass-border); background: none; font: inherit; font-size: 11px; color: var(--text-secondary); cursor: pointer; }
.al-sub { list-style: none; margin: 6px 0 0; padding: 0 0 0 10px; border-left: 1px solid var(--glass-border); display: flex; flex-direction: column; gap: 3px; font-size: 12px; color: var(--text-secondary); }
.al-sub span { color: var(--text-muted); margin-right: 6px; font-variant-numeric: tabular-nums; }
.al-meta { display: flex; align-items: center; gap: 6px; padding-top: 5px; font-size: 12px; color: var(--text-muted); white-space: nowrap; font-variant-numeric: tabular-nums; }
.al-load { display: block; margin: 8px auto 0; }
.al-empty { padding: 28px 20px; font-size: 13px; color: var(--text-muted); text-align: center; margin: 0; }
.al-skel { padding: 14px 20px; display: flex; flex-direction: column; gap: 10px; }
.al-skel div { height: 34px; border-radius: 8px; background: linear-gradient(90deg, rgba(127,127,127,0.08), rgba(127,127,127,0.16), rgba(127,127,127,0.08)); background-size: 200% 100%; animation: al-sh 1.2s linear infinite; }
@keyframes al-sh { to { background-position: -200% 0; } }
`;
