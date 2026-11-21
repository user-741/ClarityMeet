"use client";
export const dynamic = "force-dynamic";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Search, FileText, ListChecks, Clock, History, User, Sparkles, Star } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/current-user";
import { getFirstWorkspaceId } from "@/lib/workspace";
import { useWorkspace } from "@/app/components/WorkspaceContext";
import { parseQuery, describe, type ParsedQuery } from "@/lib/nl-search";
import type { TasksDetail } from "@/lib/database.types";
import { buildSuggestions, loadRecent, saveRecent, type Suggestion } from "@/lib/search-suggest";

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
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [recent, setRecent] = useState<string[]>([]);
  const [titles, setTitles] = useState<string[]>([]);
  const [people, setPeople] = useState<string[]>([]);
  const boxRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<"all" | "meetings" | "tasks">("all");
  const [sort, setSort] = useState<"relevant" | "newest">("relevant");
  const [range, setRange] = useState("any");
  const [person, setPerson] = useState("");
  const [saved, setSaved] = useState<string[]>([]);

  // Saved searches live in this browser, like recent ones.
  useEffect(() => { try { setSaved(JSON.parse(localStorage.getItem("cm_saved_searches") ?? "[]")); } catch { /* ignore */ } }, []);
  const toggleSaved = (q: string) => {
    const next = saved.includes(q) ? saved.filter(x => x !== q) : [q, ...saved].slice(0, 8);
    setSaved(next);
    try { localStorage.setItem("cm_saved_searches", JSON.stringify(next)); } catch { /* ignore */ }
  };
  const clearRecent = () => { try { localStorage.removeItem("cm-recent-searches"); } catch { /* ignore */ } setRecent([]); };

  // "/" or Ctrl+K jumps to the search box
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if ((e.key === "k" && (e.ctrlKey || e.metaKey)) || (e.key === "/" && tag !== "INPUT" && tag !== "TEXTAREA")) {
        e.preventDefault(); inputRef.current?.focus(); setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    setRecent(loadRecent());
    (async () => {
      const user = await getCurrentUser();
      if (!user) return;
      const wsId = activeWorkspace?.workspace_id ?? (await getFirstWorkspaceId(user.id));
      if (!wsId) return;
      const [{ data: ms }, { data: mem }] = await Promise.all([
        supabase.from("meetings").select("title").eq("workspace_id", wsId).not("title", "is", null).order("created_at", { ascending: false }).limit(200),
        supabase.from("workspace_members").select("users(first_name, last_name)").eq("workspace_id", wsId),
      ]);
      setTitles(Array.from(new Set((ms ?? []).map(m => (m.title ?? "").trim()).filter(Boolean))));
      const rows = (mem ?? []) as unknown as Array<{ users: { first_name: string | null; last_name: string | null } | null }>;
      setPeople(rows.map(r => [r.users?.first_name, r.users?.last_name].filter(Boolean).join(" ")).filter(Boolean));
    })();
  }, [activeWorkspace]);

  useEffect(() => {
    const close = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const suggestions = useMemo<Suggestion[]>(() => buildSuggestions(input, { recent, meetings: titles, people }, 5), [input, recent, titles, people]);

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
      if (p.unassigned) r = r.eq("assignee_display", "Unassigned");
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
    setInput(q); setQuery(q); setOpen(false); setActive(-1);
    if (q) { saveRecent(q); setRecent(loadRecent()); }
    router.replace(q ? `/search?q=${encodeURIComponent(q)}` : "/search");
  };

  const chips = useMemo(() => (parsed ? describe(parsed) : []), [parsed]);
  const terms = useMemo(() => parsed?.terms ?? [], [parsed]);

  // Filters and ranking are applied to what came back from the database.
  const view = useMemo(() => {
    const since = range === "any" ? 0 : Date.now() - Number(range) * 86400000;
    const count = (text: string | null | undefined) => terms.reduce((n, t) => n + ((text ?? "").toLowerCase().split(t).length - 1), 0);
    const ms = meetings
      .filter(m => !since || new Date(m.started_at ?? m.created_at).getTime() >= since)
      .map(m => ({ m, score: count(m.title) * 3 + count(m.summary) }))
      .sort((a, b) => sort === "newest" || !terms.length
        ? new Date(b.m.started_at ?? b.m.created_at).getTime() - new Date(a.m.started_at ?? a.m.created_at).getTime()
        : b.score - a.score)
      .map(x => x.m);
    const ts = tasks
      .filter(t => !since || new Date(t.created_at ?? 0).getTime() >= since)
      .filter(t => !person || (t.assignee_display ?? "") === person)
      .map(t => ({ t, score: count(t.title) * 3 + count(t.description) + count(t.meeting_title) }))
      .sort((a, b) => sort === "newest" || !terms.length
        ? new Date(b.t.created_at ?? 0).getTime() - new Date(a.t.created_at ?? 0).getTime()
        : b.score - a.score)
      .map(x => x.t);
    return { ms, ts };
  }, [meetings, tasks, range, person, sort, terms]);
  const total = view.ms.length + view.ts.length;

  // A plain summary of the results, built only from the records found, each one linked.
  const overview = useMemo(() => {
    if (!total) return null;
    const today = new Date().toLocaleDateString("en-CA");
    const late = view.ts.filter(t => t.status !== "Completed" && t.due_date && t.due_date.slice(0, 10) < today).length;
    const open = view.ts.filter(t => t.status !== "Completed").length;
    const parts: string[] = [];
    if (view.ms.length) parts.push(`${view.ms.length} meeting${view.ms.length === 1 ? "" : "s"}`);
    if (view.ts.length) parts.push(`${view.ts.length} task${view.ts.length === 1 ? "" : "s"}`);
    let text = `Found ${parts.join(" and ")}.`;
    if (view.ts.length) text += ` ${open} still open${late ? `, ${late} overdue` : ""}.`;
    const latest = view.ms[0];
    if (latest) text += ` Most relevant meeting: ${latest.title || "Untitled"} (${fmt(latest.started_at ?? latest.created_at)}).`;
    return { text, sources: view.ms.slice(0, 3) };
  }, [view, total]);

  const groupedSuggestions = [
    { label: "Recent", items: suggestions.filter(x => x.kind === "recent") },
    { label: "Suggestions", items: suggestions.filter(x => x.kind !== "recent") },
  ].filter(g => g.items.length);
  const flat = groupedSuggestions.flatMap(g => g.items);
  const showMeetings = tab !== "tasks" && view.ms.length > 0;
  const showTasks = tab !== "meetings" && view.ts.length > 0;
  const taskPeople = Array.from(new Set(tasks.map(t => t.assignee_display).filter((x): x is string => !!x && x !== "Unassigned")));

  return (
    <div style={{ paddingBottom: "48px" }} className="page-enter">
      <style>{SR_CSS}</style>
      <div className="page-header">
        <div>
          <div className="page-header-title">Search</div>
          <div className="page-header-sub">Meetings, summaries, transcripts and tasks in this workspace</div>
        </div>
      </div>

      <div className={`page-body sr-body${query ? "" : " sr-landing"}`}>
        {!query && (
          <div className="sr-hero">
            <h1>Find anything in your meetings</h1>
            <p>Search by keyword, or ask in plain English, like &ldquo;overdue tasks&rdquo; or &ldquo;what did we decide in October&rdquo;.</p>
          </div>
        )}

        <form ref={boxRef} className="sr-form" onSubmit={e => { e.preventDefault(); submit((active >= 0 && open ? flat[active]?.text ?? input : input).trim()); }}>
          <div className="sr-box">
            <Search size={16} />
            <input ref={inputRef} autoFocus value={input} role="combobox" aria-expanded={open && flat.length > 0} aria-controls="search-suggest" aria-autocomplete="list" aria-label="Search"
              onChange={e => { setInput(e.target.value); setOpen(true); setActive(-1); }}
              onFocus={() => setOpen(true)}
              onKeyDown={e => {
                if (e.key === "Escape") { setOpen(false); return; }
                if (!open || !flat.length) return;
                if (e.key === "ArrowDown") { e.preventDefault(); setActive(i => (i + 1) % flat.length); }
                else if (e.key === "ArrowUp") { e.preventDefault(); setActive(i => (i <= 0 ? flat.length - 1 : i - 1)); }
                else if (e.key === "Tab" && active >= 0) { e.preventDefault(); setInput(flat[active].text); setActive(-1); }
              }}
              placeholder="Ask a question or search by keyword" />
            {!input && <kbd className="sr-kbd">Ctrl K</kbd>}
            <button className="btn btn-primary btn-sm" type="submit">Search</button>
          </div>
          {open && flat.length > 0 && (
            <div id="search-suggest" role="listbox" className="sr-suggest">
              {groupedSuggestions.map(g => (
                <div key={g.label}>
                  <div className="sr-suggest-label">{g.label}</div>
                  {g.items.map(sg => {
                    const i = flat.indexOf(sg);
                    return (
                      <div key={sg.text} role="option" aria-selected={i === active} className={`sr-opt${i === active ? " on" : ""}`}
                        onMouseEnter={() => setActive(i)} onMouseDown={e => { e.preventDefault(); if (sg.text.endsWith(" ")) setInput(sg.text); else submit(sg.text.trim()); }}>
                        {sg.kind === "recent" ? <History size={14} /> : sg.kind === "person" ? <User size={14} /> : sg.kind === "meeting" ? <FileText size={14} /> : <Sparkles size={14} />}
                        <span><Highlight text={sg.text} terms={input.trim() ? input.trim().toLowerCase().split(/\s+/).filter(w => w.length > 1) : []} /></span>
                        <em>{sg.kind === "person" ? "Person" : sg.kind === "meeting" ? "Meeting" : ""}</em>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </form>

        <div className="sr-filters">
          <select className="sr-select" value={range} onChange={e => setRange(e.target.value)} aria-label="Date range">
            <option value="any">Any date</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option>
          </select>
          <select className="sr-select" value={person} onChange={e => setPerson(e.target.value)} aria-label="Person">
            <option value="">Anyone</option>
            {(taskPeople.length ? taskPeople : people).map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          {query && (
            <select className="sr-select" value={sort} onChange={e => setSort(e.target.value as "relevant" | "newest")} aria-label="Sort">
              <option value="relevant">Most relevant</option><option value="newest">Newest first</option>
            </select>
          )}
          {query && (
            <button type="button" className={`sr-save${saved.includes(query) ? " on" : ""}`} onClick={() => toggleSaved(query)}>
              <Star size={13} /> {saved.includes(query) ? "Saved" : "Save search"}
            </button>
          )}
        </div>

        {!query && (
          <div className="sr-grid">
            <div className="data-card sr-card">
              <div className="sr-card-head"><h3>Recent searches</h3>{recent.length > 0 && <button onClick={clearRecent}>Clear</button>}</div>
              {recent.length === 0 ? <p className="sr-muted">Your searches will show here.</p> : recent.slice(0, 5).map(r => (
                <button key={r} className="sr-link" onClick={() => submit(r)}><History size={13} /> {r}</button>
              ))}
            </div>
            <div className="data-card sr-card">
              <div className="sr-card-head"><h3>Try asking</h3></div>
              {EXAMPLES.slice(0, 5).map(e => (
                <button key={e} className="sr-link" onClick={() => submit(e)}><Sparkles size={13} /> {e}</button>
              ))}
            </div>
            <div className="data-card sr-card">
              <div className="sr-card-head"><h3>Saved searches</h3></div>
              {saved.length === 0 ? <p className="sr-muted">Run a search and press Save search to keep it here, e.g. &ldquo;overdue tasks&rdquo;.</p> : saved.map(r => (
                <div key={r} className="sr-saved"><button className="sr-link" onClick={() => submit(r)}><Star size={13} /> {r}</button><button className="sr-x" onClick={() => toggleSaved(r)} aria-label={`Remove ${r}`}>×</button></div>
              ))}
            </div>
          </div>
        )}

        {query && (
          <>
            <div className="sr-results-head">
              <div className="sr-tabs" role="tablist">
                {([["all", "All", total], ["meetings", "Meetings", view.ms.length], ["tasks", "Tasks", view.ts.length]] as const).map(([k, label, n]) => (
                  <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{label}<span>{n}</span></button>
                ))}
              </div>
              {chips.length > 0 && (
                <div className="sr-chips"><span>Understood as</span>{chips.map(c => <span key={c} className="sr-chip">{c}</span>)}</div>
              )}
            </div>

            {err && <p style={{ color: "var(--crimson)", fontSize: "13px" }}>{err}</p>}
            {loading && <div className="sr-skel">{[0, 1, 2].map(i => <div key={i} />)}</div>}

            {!loading && overview && tab === "all" && (
              <div className="data-card sr-overview">
                <div className="sr-overview-label"><Sparkles size={13} /> Summary of results</div>
                <p>{overview.text}</p>
                {overview.sources.length > 0 && (
                  <div className="sr-sources">Sources: {overview.sources.map(m => <Link key={m.id} href={`/meeting-summary?id=${m.id}`}>{m.title || "Untitled"}</Link>)}</div>
                )}
              </div>
            )}

            {!loading && parsed && total === 0 && !err && (
              <div className="data-card sr-empty">
                <p><strong>Nothing matched &ldquo;{query}&rdquo;</strong></p>
                <p>{terms.length > 1 ? "Try fewer words, " : "Try "}a wider date range, or one of these:</p>
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", justifyContent: "center" }}>
                  {EXAMPLES.slice(0, 3).map(e => <button key={e} className="sr-chip-btn" onClick={() => submit(e)}>{e}</button>)}
                </div>
              </div>
            )}

            {!loading && showMeetings && (
              <section className="sr-section">
                <h3><FileText size={13} /> Meetings <span>{view.ms.length}</span></h3>
                <div className="data-card">
                  {view.ms.map(m => (
                    <div key={m.id} className="sr-meeting">
                      <Link href={`/meeting-summary?id=${m.id}`} className="sr-meeting-title"><Highlight text={m.title || "Untitled meeting"} terms={terms} /></Link>
                      <div className="sr-meta"><Clock size={11} /> {fmt(m.started_at ?? m.created_at)} · {m.task_count ?? 0} tasks{m.status === "complete" ? " · Summary ready" : ""}</div>
                      {m.summary && <p className="sr-snippet"><Highlight text={snippet(m.summary, terms)} terms={terms} /></p>}
                      {m.status === "complete" && (
                        <div className="sr-actions">
                          <Link href={`/meeting-summary?id=${m.id}&tab=summary`}>Summary</Link>
                          <Link href={`/meeting-summary?id=${m.id}&tab=transcript`}>Transcript</Link>
                          <Link href={`/meeting-summary?id=${m.id}&tab=tasks`}>Tasks</Link>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {!loading && showTasks && (
              <section className="sr-section">
                <h3><ListChecks size={13} /> Tasks <span>{view.ts.length}</span></h3>
                <div className="data-card">
                  {view.ts.map(t => (
                    <div key={t.id ?? t.title ?? ""} className="sr-task" onClick={() => t.meeting_id && router.push(`/meeting-summary?id=${t.meeting_id}&tab=tasks`)} style={{ cursor: t.meeting_id ? "pointer" : "default" }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="sr-task-title"><Highlight text={t.title ?? ""} terms={terms} /></div>
                        <div className="sr-meta">{t.assignee_display ?? "Unassigned"}{t.meeting_title ? ` · ${t.meeting_title}` : ""}{t.due_date ? ` · due ${fmt(t.due_date)}` : ""}</div>
                      </div>
                      <span className={`tk-pri-dot p-${(t.priority ?? "Medium").toLowerCase()}`}>{t.priority}</span>
                      <span className={`badge ${STATUS_BADGE[t.status ?? "Open"] ?? "badge-muted"}`}>{t.status}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

const SR_CSS = `
.sr-body { padding: 20px 36px; max-width: 1000px; }
.sr-landing { padding-top: 48px; margin: 0 auto; }
@media (max-width: 700px) { .sr-body { padding: 16px; } .sr-landing { padding-top: 20px; } }
.sr-hero { text-align: center; margin-bottom: 20px; }
.sr-hero h1 { font-family: var(--font-display); font-size: 26px; font-weight: 800; color: var(--text-primary); margin: 0 0 6px; letter-spacing: -0.4px; }
.sr-hero p { font-size: 14px; color: var(--text-secondary); margin: 0; }
.sr-form { position: relative; margin-bottom: 12px; }
.sr-box { display: flex; align-items: center; gap: 10px; height: 48px; padding: 0 6px 0 16px; border-radius: 12px; border: 1px solid var(--glass-border); background: var(--bg-raised); transition: border-color 150ms, box-shadow 150ms; }
.sr-box:focus-within { border-color: rgba(14,165,233,0.6); box-shadow: 0 0 0 3px rgba(14,165,233,0.14); }
.sr-box > svg { color: var(--text-muted); flex-shrink: 0; }
.sr-box input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--text-primary); font: inherit; font-size: 15px; }
.sr-box .btn { height: 36px; }
.sr-kbd { font-family: var(--font-mono); font-size: 11px; color: var(--text-muted); border: 1px solid var(--glass-border); border-radius: 6px; padding: 2px 6px; }
.sr-suggest { position: absolute; top: calc(100% + 6px); left: 0; right: 0; z-index: 40; padding: 6px; border-radius: 12px; border: 1px solid var(--glass-border); background: var(--bg-elevated); box-shadow: 0 14px 36px rgba(0,0,0,0.28); max-height: 280px; overflow-y: auto; }
.sr-suggest-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em; color: var(--text-muted); padding: 6px 10px 4px; }
.sr-opt { display: flex; align-items: center; gap: 10px; height: 38px; padding: 0 10px; border-radius: 8px; font-size: 13px; color: var(--text-primary); cursor: pointer; }
.sr-opt svg { color: var(--text-muted); flex-shrink: 0; }
.sr-opt span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sr-opt em { font-style: normal; font-size: 11px; color: var(--text-muted); }
.sr-opt.on { background: rgba(14,165,233,0.1); }
.sr-filters { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 18px; }
.sr-landing .sr-filters { justify-content: center; }
.sr-select { height: 32px; padding: 0 28px 0 10px; border-radius: 999px; border: 1px solid var(--glass-border); background-color: transparent; color: var(--text-secondary); font: inherit; font-size: 12px; cursor: pointer; }
.sr-save { display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 12px; border-radius: 999px; border: 1px solid var(--glass-border); background: transparent; color: var(--text-secondary); font: inherit; font-size: 12px; cursor: pointer; margin-left: auto; }
.sr-save.on { color: var(--amber-alert); border-color: rgba(245,158,11,0.45); }
.sr-save.on svg { fill: currentColor; }
.sr-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; margin-top: 8px; }
@media (max-width: 900px) { .sr-grid { grid-template-columns: 1fr; } }
.sr-card { padding: 14px 16px; }
.sr-card-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.sr-card-head h3 { font-family: var(--font-display); font-size: 13px; font-weight: 700; color: var(--text-primary); margin: 0; }
.sr-card-head button { border: 0; background: none; color: var(--text-muted); font: inherit; font-size: 11px; cursor: pointer; }
.sr-muted { font-size: 12px; color: var(--text-muted); margin: 0; line-height: 1.5; }
.sr-link { display: flex; align-items: center; gap: 8px; width: 100%; padding: 7px 6px; border: 0; border-radius: 7px; background: none; color: var(--text-secondary); font: inherit; font-size: 13px; text-align: left; cursor: pointer; }
.sr-link svg { color: var(--text-muted); flex-shrink: 0; }
.sr-link:hover { background: rgba(14,165,233,0.07); color: var(--text-primary); }
.sr-saved { display: flex; align-items: center; }
.sr-x { border: 0; background: none; color: var(--text-muted); font-size: 16px; cursor: pointer; padding: 0 6px; }
.sr-results-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; border-bottom: 1px solid var(--glass-border); }
.sr-tabs { display: flex; gap: 4px; }
.sr-tabs button { display: inline-flex; align-items: center; gap: 6px; padding: 9px 12px; border: 0; border-bottom: 2px solid transparent; background: none; color: var(--text-muted); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; margin-bottom: -1px; }
.sr-tabs button span { font-size: 11px; padding: 1px 7px; border-radius: 999px; background: rgba(127,127,127,0.14); }
.sr-tabs button.on { color: var(--text-primary); border-bottom-color: #0EA5E9; }
.sr-chips { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-size: 11px; color: var(--text-muted); padding-bottom: 8px; }
.sr-chip { padding: 2px 8px; border-radius: 999px; border: 1px solid var(--glass-border); color: var(--text-secondary); }
.sr-chip-btn { padding: 5px 12px; border-radius: 999px; border: 1px solid var(--glass-border); background: none; color: #38BDF8; font: inherit; font-size: 12px; cursor: pointer; }
.sr-overview { padding: 14px 16px; margin-bottom: 18px; border-color: rgba(14,165,233,0.3); background: rgba(14,165,233,0.04); }
.sr-overview-label { display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #38BDF8; margin-bottom: 6px; }
.sr-overview p { font-size: 14px; color: var(--text-primary); line-height: 1.55; margin: 0; }
.sr-sources { display: flex; flex-wrap: wrap; gap: 6px 10px; margin-top: 8px; font-size: 12px; color: var(--text-muted); }
.sr-sources a { color: #38BDF8; text-decoration: none; }
.sr-sources a:hover { text-decoration: underline; }
.sr-empty { padding: 28px; text-align: center; font-size: 13px; color: var(--text-muted); display: flex; flex-direction: column; gap: 8px; }
.sr-empty strong { color: var(--text-primary); }
.sr-empty p { margin: 0; }
.sr-section { margin-bottom: 22px; }
.sr-section h3 { display: flex; align-items: center; gap: 7px; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em; color: var(--text-muted); margin: 0 0 8px; }
.sr-section h3 span { font-weight: 600; }
.sr-meeting { padding: 14px 18px; border-top: 1px solid var(--glass-border); }
.sr-meeting:first-child { border-top: 0; }
.sr-meeting-title { font-size: 15px; font-weight: 700; color: var(--text-primary); text-decoration: none; }
.sr-meeting-title:hover { text-decoration: underline; }
.sr-meta { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; font-size: 12px; color: var(--text-muted); margin-top: 3px; }
.sr-snippet { font-size: 13px; color: var(--text-secondary); line-height: 1.6; margin: 6px 0 0; }
.sr-actions { display: flex; gap: 4px; margin-top: 8px; margin-left: -7px; }
.sr-actions a { font-size: 12px; color: #38BDF8; text-decoration: none; padding: 3px 7px; border-radius: 6px; }
.sr-actions a:hover { background: rgba(14,165,233,0.12); }
.sr-task { display: flex; align-items: center; gap: 12px; padding: 11px 18px; border-top: 1px solid var(--glass-border); transition: background 150ms; }
.sr-task:first-child { border-top: 0; }
.sr-task:hover { background: rgba(14,165,233,0.05); }
.sr-task-title { font-size: 14px; font-weight: 600; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tk-pri-dot { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-secondary); white-space: nowrap; }
.tk-pri-dot::before { content: ""; width: 8px; height: 8px; border-radius: 2px; background: #94A3B8; }
.tk-pri-dot.p-high::before { background: #EF4444; }
.tk-pri-dot.p-medium::before { background: #F59E0B; }
.sr-skel { display: flex; flex-direction: column; gap: 10px; }
.sr-skel div { height: 64px; border-radius: 12px; background: linear-gradient(90deg, rgba(127,127,127,0.08), rgba(127,127,127,0.16), rgba(127,127,127,0.08)); background-size: 200% 100%; animation: sr-shimmer 1.2s linear infinite; }
@keyframes sr-shimmer { to { background-position: -200% 0; } }
`;

export default function SearchPage() {
  return (
    <Suspense fallback={null}>
      <SearchInner />
    </Suspense>
  );
}
