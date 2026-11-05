"use client";
export const dynamic = "force-dynamic";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Search, FileText, ListChecks, Clock, ArrowRight } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/current-user";
import { getFirstWorkspaceId } from "@/lib/workspace";
import { useWorkspace } from "@/app/components/WorkspaceContext";
import { parseQuery, describe, type ParsedQuery } from "@/lib/nl-search";
import type { TasksDetail } from "@/lib/database.types";

type MeetingHit = { id: string; title: string | null; summary: string | null; started_at: string | null; created_at: string; status: string | null; task_count: number | null };

const EXAMPLES = [
  "unfinished tasks from last week",
  "high priority tasks assigned to me",
  "meetings about the budget this month",
  "overdue tasks",
  "what did we decide in October",
  "unassigned action items",
];

const STATUS_BADGE: Record<string, string> = { Open: "badge-blue", "In Progress": "badge-amber", Completed: "badge-green", Cancelled: "badge-muted" };

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" }) : "-");

function snippet(text: string | null, terms: string[]) {
  if (!text) return "";
  const lower = text.toLowerCase();
  const hit = terms.map(t => lower.indexOf(t)).filter(i => i >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, hit - 60);
  return `${start > 0 ? "..." : ""}${text.slice(start, start + 220)}${text.length > start + 220 ? "..." : ""}`;
}

function Highlight({ text, terms }: { text: string; terms: string[] }) {
  if (!terms.length) return <>{text}</>;
  const re = new RegExp(`(${terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return <>{text.split(re).map((part, i) => (i % 2 ? <mark key={i} style={{ background: "rgba(14,165,233,0.18)", color: "inherit", borderRadius: "3px", padding: "0 2px" }}>{part}</mark> : part))}</>;
}

function SearchInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { activeWorkspace } = useWorkspace();
  const [input, setInput] = useState(params.get("q") ?? "");
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [parsed, setParsed] = useState<ParsedQuery | null>(null);
  const [tasks, setTasks] = useState<TasksDetail[]>([]);
  const [meetings, setMeetings] = useState<MeetingHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const run = useCallback(async (q: string) => {
    if (!q.trim()) { setParsed(null); setTasks([]); setMeetings([]); return; }
    setLoading(true); setErr("");
    const user = await getCurrentUser();
    if (!user) { router.push("/login"); return; }
    const wsId = activeWorkspace?.workspace_id ?? (await getFirstWorkspaceId(user.id));
    if (!wsId) { setLoading(false); setErr("Join or create a workspace first."); return; }

    const p = parseQuery(q);
    setParsed(p);

    const taskReq = async () => {
      if (p.kind === "meetings") return [];
      let r = supabase.from("tasks_detail").select("*").eq("workspace_id", wsId);
      if (p.statuses.length) r = r.in("status", p.statuses);
      if (p.overdue) r = r.lt("due_date", new Date().toISOString().slice(0, 10)).neq("status", "Completed").neq("status", "Cancelled");
      if (p.priority) r = r.eq("priority", p.priority);
      if (p.mine) r = r.eq("assignee_id", user.id);
      if (p.unassigned) r = r.is("assignee_id", null);
      if (p.assignee) r = r.ilike("assignee_display", `%${p.assignee}%`);
      if (p.from && p.to) {
        const col = p.dueWindow ? "due_date" : "created_at";
        r = r.gte(col, p.from.toISOString()).lt(col, p.to.toISOString());
      }
      for (const t of p.terms) r = r.or(`title.ilike.%${t}%,description.ilike.%${t}%,meeting_title.ilike.%${t}%`);
      const { data } = await r.order("created_at", { ascending: false }).limit(50);
      return (data ?? []) as TasksDetail[];
    };

    const meetingReq = async () => {
      if (p.kind === "tasks" || p.overdue || p.statuses.length || p.mine || p.unassigned || p.assignee || p.priority) return [];
      let r = supabase.from("meetings").select("id,title,summary,started_at,created_at,status,task_count").eq("workspace_id", wsId);
      if (p.from && p.to) r = r.gte("started_at", p.from.toISOString()).lt("started_at", p.to.toISOString());
      for (const t of p.terms) r = r.or(`title.ilike.%${t}%,summary.ilike.%${t}%,transcript.ilike.%${t}%`);
      const { data } = await r.order("started_at", { ascending: false, nullsFirst: false }).limit(30);
      return (data ?? []) as MeetingHit[];
    };

    try {
      const [t, m] = await Promise.all([taskReq(), meetingReq()]);
      setTasks(t); setMeetings(m);
    } catch {
      setErr("Search failed. Try again.");
    } finally {
      setLoading(false);
    }
  }, [activeWorkspace, router]);

  useEffect(() => { run(query); }, [query, run]);

  const submit = (q: string) => {
    setInput(q); setQuery(q);
    router.replace(q ? `/search?q=${encodeURIComponent(q)}` : "/search");
  };

  const chips = useMemo(() => (parsed ? describe(parsed) : []), [parsed]);
  const total = tasks.length + meetings.length;

  return (
    <div style={{ paddingBottom: "48px" }} className="page-enter">
      <div className="page-header">
        <div>
          <div className="page-header-title">Search</div>
          <div className="page-header-sub">Ask in plain English across your meetings and tasks</div>
        </div>
      </div>

      <div style={{ padding: "24px 36px", maxWidth: "980px" }}>
        <form onSubmit={e => { e.preventDefault(); submit(input.trim()); }} style={{ position: "relative", marginBottom: "14px" }}>
          <Search size={17} style={{ position: "absolute", left: "16px", top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
          <input className="form-input" autoFocus value={input} onChange={e => setInput(e.target.value)}
            placeholder='Try "unfinished tasks from last week"' style={{ paddingLeft: "44px", paddingRight: "110px", height: "50px", fontSize: "15px" }} />
          <button className="btn btn-primary btn-sm" type="submit" style={{ position: "absolute", right: "8px", top: "50%", transform: "translateY(-50%)" }}>
            Search <ArrowRight size={13} />
          </button>
        </form>

        {!query && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "24px" }}>
            {EXAMPLES.map(e => (
              <button key={e} className="btn btn-secondary btn-sm" onClick={() => submit(e)}>{e}</button>
            ))}
          </div>
        )}

        {parsed && (
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px", marginBottom: "22px", fontSize: "12px", color: "var(--text-muted)" }}>
            <span>Searching for:</span>
            {chips.map(c => <span key={c} className="badge badge-muted">{c}</span>)}
          </div>
        )}

        {err && <p style={{ color: "var(--crimson)", fontSize: "13px" }}>{err}</p>}
        {loading && <div className="spinner" />}

        {!loading && parsed && total === 0 && !err && (
          <div className="liquid-card" style={{ padding: "28px", textAlign: "center" }}>
            <p style={{ fontSize: "14px", color: "var(--text-primary)", fontWeight: 600, marginBottom: "6px" }}>Nothing matched</p>
            <p style={{ fontSize: "13px", color: "var(--text-muted)" }}>
              {parsed.terms.length > 1 ? "Try fewer words, " : "Try "}a wider time range, or one of these: {EXAMPLES.slice(0, 3).map((e, i) => (
                <button key={e} onClick={() => submit(e)} style={{ background: "none", border: "none", padding: 0, color: "var(--electric-teal)", cursor: "pointer", fontSize: "13px" }}>
                  {e}{i < 2 ? ", " : ""}
                </button>
              ))}
            </p>
          </div>
        )}

        {!loading && meetings.length > 0 && (
          <section style={{ marginBottom: "28px" }}>
            <h3 style={{ fontSize: "12px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--text-muted)", marginBottom: "10px", display: "flex", gap: "8px", alignItems: "center" }}>
              <FileText size={13} /> Meetings ({meetings.length})
            </h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {meetings.map(m => (
                <Link key={m.id} href={`/meeting-summary?id=${m.id}`} className="liquid-card" style={{ padding: "16px 20px", textDecoration: "none", display: "block" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", marginBottom: "6px" }}>
                    <span style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-primary)" }}><Highlight text={m.title || "Untitled meeting"} terms={parsed?.terms ?? []} /></span>
                    <span style={{ fontSize: "12px", color: "var(--text-muted)", display: "flex", gap: "6px", alignItems: "center", whiteSpace: "nowrap" }}><Clock size={12} />{fmt(m.started_at ?? m.created_at)}</span>
                  </div>
                  {m.summary && <p style={{ fontSize: "13px", color: "var(--text-secondary)", lineHeight: 1.6 }}><Highlight text={snippet(m.summary, parsed?.terms ?? [])} terms={parsed?.terms ?? []} /></p>}
                  <div style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "6px" }}>{m.task_count ?? 0} tasks · {m.status ?? "scheduled"}</div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {!loading && tasks.length > 0 && (
          <section>
            <h3 style={{ fontSize: "12px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--text-muted)", marginBottom: "10px", display: "flex", gap: "8px", alignItems: "center" }}>
              <ListChecks size={13} /> Tasks ({tasks.length})
            </h3>
            <div className="data-card">
              <table className="data-table">
                <thead><tr><th>Task</th><th>Assignee</th><th>Meeting</th><th>Priority</th><th>Due</th><th>Status</th></tr></thead>
                <tbody>
                  {tasks.map(t => (
                    <tr key={t.id ?? t.title ?? ""} style={{ cursor: t.meeting_id ? "pointer" : "default" }} onClick={() => t.meeting_id && router.push(`/meeting-summary?id=${t.meeting_id}`)}>
                      <td style={{ fontWeight: 600, color: "var(--text-primary)" }}><Highlight text={t.title ?? ""} terms={parsed?.terms ?? []} /></td>
                      <td>{t.assignee_display ?? "Unassigned"}</td>
                      <td style={{ color: "var(--text-muted)" }}>{t.meeting_title ?? "-"}</td>
                      <td>{t.priority ?? "-"}</td>
                      <td>{t.due_date ? fmt(t.due_date) : "-"}</td>
                      <td><span className={`badge ${STATUS_BADGE[t.status ?? "Open"] ?? "badge-muted"}`}>{t.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={null}>
      <SearchInner />
    </Suspense>
  );
}
