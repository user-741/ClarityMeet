"use client";
export const dynamic = 'force-dynamic';
// Meeting summary detail page.


import { useState, useEffect, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Download, ListChecks, Users, ClipboardList, FileText, Sparkles, Clock, ChevronRight, Pencil, Trash2, Check, X, AlertCircle, Loader2, RotateCw, Search } from "lucide-react";
import { authFetch } from "@/lib/auth-fetch";
import { motion } from "framer-motion";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/current-user";
import { getFirstWorkspaceId } from "@/lib/workspace";
import { useWorkspace } from "@/app/components/WorkspaceContext";
import type { Database } from "@/lib/database.types";

type Meeting = Database["public"]["Tables"]["meetings"]["Row"];
type MeetingParticipant = Database["public"]["Tables"]["meeting_participants"]["Row"];
type MeetingHighlight = Database["public"]["Tables"]["meeting_highlights"]["Row"];
type TasksDetail = Database["public"]["Views"]["tasks_detail"]["Row"];

const PRIORITY_MAP: Record<string, number> = { High: 3, Medium: 2, Low: 1 };

function fmtDuration(secs: number | null | undefined) {
  if (!secs) return "-";
  const m = Math.round(secs / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`;
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

type ListRow = Pick<Meeting, "id" | "title" | "platform" | "status" | "started_at" | "created_at" | "duration_secs" | "task_count" | "participant_count">;

function StatusBadge({ status }: { status: string | null }) {
  if (status === "complete") return <span className="badge badge-blue"><span className="badge-dot" />AI Processed</span>;
  if (status === "failed") return <span className="badge badge-red"><span className="badge-dot" />Failed</span>;
  if (status === "recording") return <span className="badge badge-amber"><span className="badge-dot" />Recording</span>;
  return <span className="badge badge-amber"><span className="badge-dot" />Processing</span>;
}

function MeetingSummaryContent() {
  const { activeWorkspace } = useWorkspace();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [participants, setParticipants] = useState<MeetingParticipant[]>([]);
  const [highlights, setHighlights] = useState<MeetingHighlight[]>([]);
  const [allTasks, setAllTasks] = useState<TasksDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy]       = useState("priority");
  const [filterStatus, setFilter] = useState("all");
  const [activeTab, setActiveTab] = useState("summary");
  const [editing, setEditing]     = useState(false);
  const [draft, setDraft]         = useState("");
  const [saving, setSaving]       = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [actionErr, setActionErr] = useState("");
  const [history, setHistory]     = useState<{ id: string; created_at: string; previous: string }[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [list, setList]           = useState<ListRow[]>([]);
  const [others, setOthers]       = useState<ListRow[]>([]);
  const [filter, setFilterText]   = useState("");
  const [failReason, setFailReason] = useState<string | null>(null);
  const [retrying, setRetrying]   = useState(false);

  const load = useCallback(async () => {
    const user = await getCurrentUser();
    if (!user) { router.push("/login"); return; }

    const meetingId = searchParams.get("id");

    let meetingRow: Meeting | null = null;

    if (meetingId) {
      const { data } = await supabase
        .from("meetings")
        .select("*")
        .eq("id", meetingId)
        .single();
      meetingRow = data as Meeting | null;
    } else {
      const wsId = activeWorkspace?.workspace_id ?? (await getFirstWorkspaceId(user.id));
      if (wsId) {
        const { data } = await supabase
          .from("meetings")
          .select("id, title, platform, status, started_at, created_at, duration_secs, task_count, participant_count")
          .eq("workspace_id", wsId)
          .neq("status", "scheduled")
          .order("started_at", { ascending: false, nullsFirst: false })
          .limit(200);
        setList((data ?? []) as ListRow[]);
      }
      setMeeting(null);
      setLoading(false);
      return;
    }

    if (!meetingRow) { setLoading(false); return; }
    setMeeting(meetingRow);
    setList([]);
    if (meetingRow.workspace_id) {
      supabase
        .from("meetings")
        .select("id, title, platform, status, started_at, created_at, duration_secs, task_count, participant_count")
        .eq("workspace_id", meetingRow.workspace_id)
        .neq("status", "scheduled")
        .order("started_at", { ascending: false, nullsFirst: false })
        .limit(100)
        .then(({ data }) => setOthers((data ?? []) as ListRow[]));
    }
    if (meetingRow.status === "failed") {
      const { data: up } = await supabase.from("uploads").select("error_message").eq("meeting_id", meetingRow.id).maybeSingle();
      setFailReason((up as { error_message: string | null } | null)?.error_message ?? null);
    } else setFailReason(null);

    const [{ data: pts }, { data: hls }, { data: tks }] = await Promise.all([
      supabase.from("meeting_participants").select("*").eq("meeting_id", meetingRow.id),
      supabase.from("meeting_highlights").select("*").eq("meeting_id", meetingRow.id).order("sort_order", { ascending: true }),
      supabase.from("tasks_detail").select("*").eq("meeting_id", meetingRow.id).order("created_at", { ascending: true }),
    ]);
    setParticipants((pts ?? []) as MeetingParticipant[]);
    setHighlights((hls ?? []) as MeetingHighlight[]);
    setAllTasks((tks ?? []) as TasksDetail[]);
    const { data: edits } = await supabase
      .from("audit_logs")
      .select("id, created_at, payload")
      .eq("entity_id", meetingRow.id)
      .eq("action", "meeting.summary_edited")
      .order("created_at", { ascending: false })
      .limit(20);
    setHistory((edits ?? [])
      .map(e => ({ id: e.id as string, created_at: e.created_at as string, previous: String((e.payload as { previous?: string } | null)?.previous ?? "") }))
      .filter(e => e.previous));
    setLoading(false);
  }, [router, searchParams, activeWorkspace]);

  useEffect(() => { load(); }, [load, activeWorkspace]);

  useEffect(() => {
    if (!meeting || !["processing", "summarising", "recording"].includes(meeting.status ?? "")) return;
    const t = setInterval(async () => {
      const { data } = await supabase.from("meetings").select("status").eq("id", meeting.id).single();
      if (data && data.status !== meeting.status) load();
    }, 5000);
    return () => clearInterval(t);
  }, [meeting, load]);

  const retryProcessing = async () => {
    if (!meeting) return;
    setRetrying(true); setActionErr("");
    try {
      const res = await authFetch("/api/backend/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meetingId: meeting.id, storagePath: meeting.audio_path, workspaceId: meeting.workspace_id }),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) { setActionErr("The meeting service is not running right now. Try again once it is on."); return; }
      setMeeting({ ...meeting, status: "processing" });
      setFailReason(null);
    } catch {
      setActionErr("The meeting service did not answer. Try again shortly.");
    } finally {
      setRetrying(false);
    }
  };

  const filteredTasks = allTasks
    .filter(t => filterStatus === "all" || t.status === filterStatus)
    .sort((a, b) => sortBy === "priority"
      ? (PRIORITY_MAP[b.priority ?? "Low"] ?? 0) - (PRIORITY_MAP[a.priority ?? "Low"] ?? 0)
      : (a.assignee_display ?? "").localeCompare(b.assignee_display ?? ""));

  const exportTasks = (type: "txt" | "csv") => {
    const content = type === "csv"
      ? "Title,Assignee,Priority,Status,Due\n" + allTasks.map(t => `"${t.title}","${t.assignee_display ?? ""}",${t.priority},${t.status},${t.due_date ?? ""}`).join("\n")
      : allTasks.map(t => `[${t.priority}] ${t.title} -> ${t.assignee_display ?? ""} (${t.status})`).join("\n");
    const blob = new Blob([content], { type: "text/plain" });
    const url  = URL.createObjectURL(blob);
    Object.assign(document.createElement("a"), { href: url, download: `tasks.${type}` }).click();
    URL.revokeObjectURL(url);
  };

  const saveSummary = async () => {
    if (!meeting) return;
    setSaving(true); setActionErr("");
    const { error } = await supabase.from("meetings").update({ summary: draft.trim() }).eq("id", meeting.id);
    setSaving(false);
    if (error) { setActionErr("Only workspace editors can change the summary."); return; }
    if (meeting.summary) setHistory(h => [{ id: `local-${Date.now()}`, created_at: new Date().toISOString(), previous: meeting.summary as string }, ...h]);
    setMeeting({ ...meeting, summary: draft.trim() });
    setEditing(false);
  };

  const deleteMeeting = async () => {
    if (!meeting) return;
    setSaving(true); setActionErr("");
    const { error, count } = await supabase.from("meetings").delete({ count: "exact" }).eq("id", meeting.id);
    if (error || !count) { setSaving(false); setActionErr("Only the meeting owner or a workspace admin can delete it."); setConfirmDel(false); return; }
    await supabase.from("tasks").delete().eq("meeting_id", meeting.id);
    setSaving(false);
    router.push("/dashboard");
  };

  const TABS = [
    { id: "summary",     label: "Summary",                        icon: ClipboardList },
    { id: "tasks",       label: `Tasks (${allTasks.length})`,     icon: ListChecks },
    { id: "transcript",  label: "Transcript",                     icon: FileText },
    { id: "highlights",  label: "Highlights",                     icon: Sparkles },
  ];

  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "60vh" }}>
      <div className="spinner" />
    </div>
  );

  if (!meeting) {
    const q = filter.trim().toLowerCase();
    const shown = list.filter(m => !q || (m.title ?? "").toLowerCase().includes(q));
    return (
      <div style={{ paddingBottom: "48px" }} className="page-enter">
        <div className="page-header">
          <div>
            <div className="page-header-title">Meeting summaries</div>
            <div className="page-header-sub">{list.length} meeting{list.length === 1 ? "" : "s"} in this workspace</div>
          </div>
        </div>
        <div style={{ padding: "24px 36px", display: "flex", flexDirection: "column", gap: "16px" }}>
          <div style={{ position: "relative", maxWidth: "420px" }}>
            <Search size={15} style={{ position: "absolute", left: "13px", top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", pointerEvents: "none", zIndex: 1 }} />
            <input className="form-input" placeholder="Filter by title" value={filter} onChange={e => setFilterText(e.target.value)} style={{ paddingLeft: "38px" }} />
          </div>
          {shown.length === 0 ? (
            <div className="data-card" style={{ padding: "40px", textAlign: "center" }}>
              <p style={{ color: "var(--text-muted)", fontSize: "14px", marginBottom: "12px" }}>{list.length ? "No meetings match that filter." : "No meetings yet."}</p>
              <Link href="/upload" className="btn btn-primary btn-sm">Upload a recording</Link>
            </div>
          ) : (
            <div className="data-card" style={{ overflowX: "auto" }}>
              <table className="data-table">
                <thead><tr><th>Meeting</th><th>Date</th><th>Length</th><th>Tasks</th><th>Status</th></tr></thead>
                <tbody>
                  {shown.map(m => (
                    <tr key={m.id} style={{ cursor: "pointer" }} onClick={() => router.push(`/meeting-summary?id=${m.id}`)}>
                      <td style={{ fontWeight: 500, color: "var(--text-primary)" }}>{m.title ?? "Untitled meeting"}</td>
                      <td style={{ whiteSpace: "nowrap" }}>{fmtDate(m.started_at ?? m.created_at)}</td>
                      <td>{fmtDuration(m.duration_secs)}</td>
                      <td>{m.task_count ?? 0}</td>
                      <td><StatusBadge status={m.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ paddingBottom: "48px" }} className="page-enter">
      {/* Header */}
      <div className="page-header">
        <div>
          <div className="breadcrumb" style={{ marginBottom: "6px" }}>
            <Link href="/meeting-summary" className="">All meetings</Link>
            <ChevronRight size={12} />
            <span className="breadcrumb-current">Meeting Summary</span>
          </div>
          <div className="page-header-title">{meeting.title ?? "Untitled Meeting"}</div>
        </div>
        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
          {others.length > 1 && (
            <select className="form-input" aria-label="Switch meeting" value={meeting.id} onChange={e => router.push(`/meeting-summary?id=${e.target.value}`)}
              style={{ height: "32px", padding: "0 10px", fontSize: "13px", maxWidth: "240px" }}>
              {others.map(m => <option key={m.id} value={m.id}>{(m.title ?? "Untitled meeting").slice(0, 40)} · {fmtDate(m.started_at ?? m.created_at)}</option>)}
            </select>
          )}
          <button className="btn btn-secondary btn-sm" onClick={() => exportTasks("csv")}><Download size={13} /> Export CSV</button>
          <button className="btn btn-secondary btn-sm" onClick={() => exportTasks("txt")}><Download size={13} /> Export TXT</button>
          {confirmDel ? (
            <>
              <button className="btn btn-sm" onClick={deleteMeeting} disabled={saving} style={{ background: "var(--crimson)", color: "#fff" }}><Trash2 size={13} /> Delete for good</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setConfirmDel(false)}>Cancel</button>
            </>
          ) : (
            <button className="btn btn-ghost btn-sm" onClick={() => setConfirmDel(true)} style={{ color: "var(--crimson)" }} title="Delete this meeting, its transcript and tasks"><Trash2 size={13} /> Delete</button>
          )}
        </div>
      </div>

      <div style={{ padding: "24px 36px" }}>
        {/* Meeting meta */}
        <div style={{ display: "flex", gap: "20px", marginBottom: "24px", flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: "13px", color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: "6px" }}>
            <Clock size={13} color="var(--text-muted)" />{fmtDate(meeting.started_at)} · {fmtDuration(meeting.duration_secs)}
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <Users size={13} color="var(--text-muted)" />
            <div style={{ display: "flex", gap: "3px" }}>
              {participants.map(p => (
                <div key={p.id} title={p.display_name ?? ""} className="avatar avatar-sm">
                  {(p.display_name ?? "?").split(" ").map((n: string) => n[0]).join("").toUpperCase()}
                </div>
              ))}
            </div>
            <span style={{ fontSize: "13px", color: "var(--text-secondary)" }}>{participants.length} participants</span>
          </div>
          <StatusBadge status={meeting.status} />
        </div>

        {meeting.status === "failed" && (
          <div className="data-card" style={{ padding: "16px 20px", marginBottom: "20px", display: "flex", alignItems: "center", gap: "12px", borderColor: "rgba(239,68,68,0.35)" }}>
            <AlertCircle size={18} color="var(--crimson)" style={{ flexShrink: 0 }} />
            <div style={{ flex: 1, fontSize: "13px", color: "var(--text-secondary)" }}>
              <strong style={{ color: "var(--text-primary)" }}>This recording could not be processed.</strong> {failReason ?? "Your file is saved, so you can try again."}
            </div>
            {meeting.audio_path && (
              <button className="btn btn-primary btn-sm" onClick={retryProcessing} disabled={retrying}><RotateCw size={13} /> {retrying ? "Starting..." : "Try again"}</button>
            )}
          </div>
        )}
        {["processing", "summarising"].includes(meeting.status ?? "") && (
          <div className="data-card" style={{ padding: "16px 20px", marginBottom: "20px", display: "flex", alignItems: "center", gap: "12px" }}>
            <Loader2 size={18} color="var(--amber-alert)" style={{ animation: "spin 1.2s linear infinite", flexShrink: 0 }} />
            <span style={{ fontSize: "13px", color: "var(--text-secondary)" }}>Processing this recording. The summary, tasks and transcript will appear here automatically.</span>
          </div>
        )}

        {actionErr && <p style={{ fontSize: "13px", color: "var(--crimson)", marginBottom: "16px" }}>{actionErr}</p>}

        {/* Tabs */}
        <div className="tab-bar" style={{ marginBottom: "24px" }}>
          {TABS.map(tab => {
            const Icon = tab.icon;
            return (
              <button key={tab.id} className={`tab-item ${activeTab === tab.id ? "active" : ""}`} onClick={() => setActiveTab(tab.id)}>
                <Icon size={13} />{tab.label}
              </button>
            );
          })}
        </div>

        <motion.div key={activeTab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22 }}>

          {/* SUMMARY */}
          {activeTab === "summary" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
              <div className="ai-insight" style={{ padding: "24px 28px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "14px" }}>
                  <Sparkles size={15} color="#7DD3FC" />
                  <span style={{ fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#7DD3FC" }}>AI Summary</span>
                  {!editing && history.length > 0 && (
                    <button className="btn btn-ghost btn-sm" style={{ marginLeft: "auto" }} onClick={() => setShowHistory(s => !s)}>
                      History ({history.length})
                    </button>
                  )}
                  {!editing && (
                    <button className="btn btn-ghost btn-sm" style={{ marginLeft: history.length ? 0 : "auto" }} onClick={() => { setDraft(meeting.summary ?? ""); setEditing(true); }}>
                      <Pencil size={12} /> Edit
                    </button>
                  )}
                </div>
                {editing ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <textarea className="form-input" value={draft} onChange={e => setDraft(e.target.value)} rows={7} style={{ fontSize: "14px", lineHeight: 1.7, resize: "vertical" }} />
                    <div style={{ display: "flex", gap: "8px" }}>
                      <button className="btn btn-primary btn-sm" onClick={saveSummary} disabled={saving || !draft.trim()}><Check size={13} /> {saving ? "Saving..." : "Save"}</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}><X size={13} /> Cancel</button>
                    </div>
                  </div>
                ) : (
                  <p style={{ fontSize: "15px", color: "var(--text-secondary)", lineHeight: 1.8 }}>{meeting.summary ?? "Summary not yet available."}</p>
                )}
                {showHistory && !editing && (
                  <div style={{ marginTop: "16px", borderTop: "1px solid var(--glass-border)", paddingTop: "12px", display: "flex", flexDirection: "column", gap: "12px" }}>
                    {history.map(h => (
                      <div key={h.id}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                          <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>Before the edit on {new Date(h.created_at).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                          <button className="btn btn-ghost btn-sm" style={{ fontSize: "11px", padding: "2px 8px" }} onClick={() => { setDraft(h.previous); setEditing(true); setShowHistory(false); }}>Restore</button>
                        </div>
                        <p style={{ fontSize: "13px", color: "var(--text-muted)", lineHeight: 1.6 }}>{h.previous}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                <div className="liquid-card" style={{ padding: "22px" }}>
                  <h3 style={{ fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--text-muted)", marginBottom: "14px" }}>Task Completion</h3>
                  <div style={{ fontFamily: "var(--font-display)", fontSize: "34px", fontWeight: 800, marginBottom: "12px" }} className="text-gradient">
                    {allTasks.filter(t => t.status === "Completed").length}/{allTasks.length}
                  </div>
                  {allTasks.length > 0 && (
                    <div className="progress-track">
                      <div className="progress-fill" style={{ width: `${(allTasks.filter(t => t.status === "Completed").length / allTasks.length) * 100}%` }} />
                    </div>
                  )}
                  <div style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "8px" }}>
                    {allTasks.filter(t => t.status === "Open").length} open · {allTasks.filter(t => t.status === "In Progress").length} in progress
                  </div>
                </div>
                <div className="liquid-card" style={{ padding: "22px" }}>
                  <h3 style={{ fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--text-muted)", marginBottom: "14px" }}>Participants</h3>
                  {participants.length === 0 ? (
                    <p style={{ fontSize: "13px", color: "var(--text-muted)" }}>No participants recorded</p>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                      {participants.map(p => (
                        <div key={p.id} style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                          <div className="avatar avatar-sm">{(p.display_name ?? "?").split(" ").map((n: string) => n[0]).join("").toUpperCase()}</div>
                          <span style={{ fontSize: "13px", color: "var(--text-secondary)", flex: 1 }}>{p.display_name ?? p.email ?? "Unknown"}</span>
                          <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>{allTasks.filter(t => t.assignee_display === p.display_name).length} tasks</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TASKS */}
          {activeTab === "tasks" && (
            <div>
              <div style={{ display: "flex", gap: "10px", marginBottom: "18px", flexWrap: "wrap" }}>
                <div style={{ display: "flex", background: "rgba(14,21,37,0.9)", border: "1px solid var(--glass-border)", borderRadius: "var(--radius-sm)", padding: "4px", gap: "2px" }}>
                  {["all","Open","In Progress","Completed"].map(s => (
                    <button key={s} onClick={() => setFilter(s)} style={{ padding: "6px 13px", border: "none", borderRadius: "6px", cursor: "pointer", fontSize: "12px", fontWeight: 600, background: filterStatus === s ? "var(--bg-overlay)" : "transparent", color: filterStatus === s ? "var(--text-primary)" : "var(--text-muted)", transition: "all 200ms" }}>
                      {s === "all" ? "All" : s}
                    </button>
                  ))}
                </div>
                <select className="form-select" value={sortBy} onChange={e => setSortBy(e.target.value)} style={{ width: "auto" }}>
                  <option value="priority">Sort: Priority</option>
                  <option value="assignee">Sort: Assignee</option>
                </select>
              </div>
              <div className="data-card">
                <table className="data-table">
                  <thead><tr><th>Task</th><th>Assignee</th><th>Priority</th><th>Due</th><th>Status</th></tr></thead>
                  <tbody>
                    {filteredTasks.length === 0 ? (
                      <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--text-muted)", padding: "32px" }}>No tasks found</td></tr>
                    ) : filteredTasks.map(t => {
                      const initials = (t.assignee_display ?? "?").split(" ").map((n: string) => n[0]).join("").toUpperCase();
                      const priority = t.priority ?? "Low";
                      const status = t.status ?? "Open";
                      return (
                        <tr key={t.id}>
                          <td><div style={{ display: "flex", alignItems: "center", gap: "10px" }}><div className={`priority-dot priority-${priority.toLowerCase()}`} /><span style={{ color: "var(--text-primary)", fontWeight: 500 }}>{t.title}</span></div></td>
                          <td><div style={{ display: "flex", alignItems: "center", gap: "7px" }}><div className="avatar avatar-sm">{initials}</div>{t.assignee_display ?? "-"}</div></td>
                          <td><span className={`badge ${priority === "High" ? "badge-red" : priority === "Medium" ? "badge-amber" : "badge-muted"}`}>{priority}</span></td>
                          <td style={{ fontSize: "13px" }}>{t.due_date ? new Date(t.due_date).toLocaleDateString("en-AU", { day: "numeric", month: "short" }) : "-"}</td>
                          <td><span className={`badge ${status === "Completed" ? "badge-green" : status === "In Progress" ? "badge-amber" : "badge-muted"}`}>{status}</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TRANSCRIPT */}
          {activeTab === "transcript" && (
            <div className="liquid-card" style={{ padding: "28px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "20px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <FileText size={16} color="#7DD3FC" />
                  <span style={{ fontWeight: 700, color: "var(--text-primary)" }}>Full Transcript</span>
                </div>
                <button className="btn btn-ghost btn-sm" onClick={() => exportTasks("txt")}><Download size={12} /> Download</button>
              </div>
              <pre style={{ fontFamily: "var(--font-mono)", fontSize: "13px", color: "var(--text-secondary)", lineHeight: 2.1, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                {meeting.transcript ?? "Transcript not yet available."}
              </pre>
            </div>
          )}

          {/* HIGHLIGHTS */}
          {activeTab === "highlights" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {highlights.length === 0 ? (
                <p style={{ color: "var(--text-muted)", textAlign: "center", padding: "32px" }}>No highlights recorded yet.</p>
              ) : highlights.map((h, i) => (
                <div key={h.id} className="ai-insight" style={{ padding: "18px 22px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                    <div style={{ width: "26px", height: "26px", background: "rgba(14,165,233,0.12)", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontFamily: "var(--font-display)", fontWeight: 800, fontSize: "12px", color: "#7DD3FC" }}>{i+1}</div>
                    <p style={{ fontSize: "14px", color: "var(--text-primary)", lineHeight: 1.6 }}>{h.content}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

        </motion.div>
      </div>
    </div>
  );
}

export default function MeetingSummaryPage() {
  return (
    <Suspense fallback={<div style={{ padding: "40px", textAlign: "center", color: "var(--text-muted)" }}>Loading...</div>}>
      <MeetingSummaryContent />
    </Suspense>
  );
}