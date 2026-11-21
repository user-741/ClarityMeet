"use client";
export const dynamic = 'force-dynamic';
// Task management, Add Task modal + inline status toggle via Supabase.


import { useState, useEffect, useCallback, useMemo } from "react";
import { ListChecks, Download, Search, Plus, X, ChevronRight, Check } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/current-user";
import { getFirstWorkspaceId } from "@/lib/workspace";
import { useWorkspace } from "@/app/components/WorkspaceContext";
import type { TasksDetail, TaskStatus } from "@/lib/database.types";
import AssigneePicker, { type Assignee } from "@/app/components/AssigneePicker";
import { authFetch } from "@/lib/auth-fetch";

type Member = { id: string; name: string; email?: string | null };

const PRIORITY_MAP: Record<string, number> = { High: 3, Medium: 2, Low: 1 };

const todayKey = () => new Date().toLocaleDateString("en-CA");
const isOverdue = (t: TasksDetail) => t.status !== "Completed" && !!t.due_date && t.due_date.slice(0, 10) < todayKey();
function dueLabel(d: string | null, late: boolean) {
  if (!d) return "No date";
  const day = d.slice(0, 10);
  const date = new Date(`${day}T12:00:00`);
  const tomorrow = new Date(Date.now() + 86400000).toLocaleDateString("en-CA");
  if (day === todayKey()) return "Today";
  if (day === tomorrow) return "Tomorrow";
  const text = date.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", ...(date.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) });
  return late ? `${text} · overdue` : text;
}

// Add Task Modal
interface AddTaskModalProps {
  workspaceId: string;
  members: Member[];
  onClose: () => void;
  onCreated: () => void;
}

function AddTaskModal({ workspaceId, members, onClose, onCreated }: AddTaskModalProps) {
  const [title, setTitle]         = useState("");
  const [description, setDesc]    = useState("");
  const [priority, setPriority]   = useState("Medium");
  const [assignee, setAssignee] = useState<Assignee>({ id: null, name: null });
  const [dueDate, setDueDate]     = useState("");
  const [saving, setSaving]       = useState(false);
  const [err, setErr]             = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) { setErr("Title is required"); return; }
    setSaving(true);
    setErr(null);

    const user = await getCurrentUser();
    const { data: created, error } = await supabase.from("tasks").insert({
      workspace_id:  workspaceId,
      title:         title.trim(),
      description:   description.trim() || null,
      priority,
      status:        "Open",
      assignee_id:   assignee.id,
      assignee_name: assignee.name,
      due_date:      dueDate || null,
      created_by:    user?.id ?? null,
      ai_extracted:  false,
    }).select("id").single();

    if (error) { setErr(error.message); setSaving(false); return; }
    if (assignee.id && created?.id && assignee.id !== user?.id) {
      authFetch("/api/notify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ taskId: created.id, userId: assignee.id }) }).catch(() => {});
    }
    onCreated();
    onClose();
  };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 999,
      background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: "24px",
    }} onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 12 }}
        transition={{ duration: 0.2 }}
        className="liquid-card"
        style={{ width: "100%", maxWidth: "480px", padding: "32px" }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: "17px", fontWeight: 800, color: "var(--text-primary)" }}>
            Add Task
          </h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose} style={{ padding: "6px" }}>
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div>
            <label className="form-label">Title *</label>
            <input
              className="form-input"
              placeholder="e.g. Follow up with client about proposal"
              value={title}
              onChange={e => setTitle(e.target.value)}
              autoFocus
            />
          </div>
          <div>
            <label className="form-label">Description</label>
            <textarea
              className="form-textarea"
              placeholder="Additional context or notes..."
              value={description}
              onChange={e => setDesc(e.target.value)}
              style={{ minHeight: "80px" }}
            />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }} className="rg-2">
            <div>
              <label className="form-label">Priority</label>
              <select className="form-select" value={priority} onChange={e => setPriority(e.target.value)}>
                <option value="High">High</option>
                <option value="Medium">Medium</option>
                <option value="Low">Low</option>
              </select>
            </div>
            <div>
              <label className="form-label">Due date</label>
              <input
                type="date"
                className="form-input"
                value={dueDate}
                onChange={e => setDueDate(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="form-label">Assign to</label>
            <AssigneePicker members={members} value={assignee} onChange={setAssignee} />
          </div>

          {err && (
            <p style={{ fontSize: "13px", color: "var(--crimson)", marginTop: "-4px" }}>{err}</p>
          )}

          <div style={{ display: "flex", gap: "10px", marginTop: "4px" }}>
            <button type="submit" className="btn btn-primary" disabled={saving} style={{ flex: 1, justifyContent: "center" }}>
              {saving ? "Creating..." : <><Plus size={13} /> Create Task</>}
            </button>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

// Main Page
export default function TasksPage() {
  const { activeWorkspace } = useWorkspace();
  const [allTasks,       setAllTasks]   = useState<TasksDetail[]>([]);
  const [loading,        setLoading]    = useState(true);
  const [search,         setSearch]     = useState("");
  const [filterMeeting,  setMeeting]    = useState("");
  const [filterAssignee, setAssignee]   = useState("");
  const [filterPriority, setPriority]   = useState("");
  const [filterStatus,   setStatus]     = useState("all");
  const [sortBy,         setSortBy]     = useState("priority");
  const [showModal,      setShowModal]  = useState(false);
  const [workspaceId,    setWorkspaceId] = useState<string | null>(null);
  const [members,        setMembers]     = useState<Member[]>([]);
  const [toast, setToast]               = useState<string | null>(null);
  const [meId,           setMeId]        = useState<string | null>(null);
  const [openTask,       setOpenTask]    = useState<TasksDetail | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2800);
  };

  const load = useCallback(async () => {
    const user = await getCurrentUser();
    if (!user) return;
    setMeId(user.id);
    const wsId = activeWorkspace?.workspace_id ?? (await getFirstWorkspaceId(user.id));
    if (!wsId) { setLoading(false); return; }
    setWorkspaceId(wsId);
    const { data: mem } = await supabase.from("workspace_members").select("user_id, users(first_name, last_name, email)").eq("workspace_id", wsId);
    setMembers(((mem ?? []) as unknown as { user_id: string; users: { first_name: string | null; last_name: string | null; email: string | null } | null }[])
      .map(m => ({ id: m.user_id, name: [m.users?.first_name, m.users?.last_name].filter(Boolean).join(" ") || m.users?.email || "Member", email: m.users?.email })));
    const { data } = await supabase.from("tasks_detail").select("*").eq("workspace_id", wsId).order("created_at", { ascending: false });
    if (data) setAllTasks(data);
    setLoading(false);
  }, [activeWorkspace]);

  useEffect(() => { load(); }, [load, activeWorkspace]);

  const meetings  = useMemo(() => [...new Set(allTasks.map(t => t.meeting_title).filter((x): x is string => x !== null && x !== undefined))], [allTasks]);
  const assignees = useMemo(() => [...new Set(allTasks.map(t => t.assignee_display).filter((x): x is string => !!x))], [allTasks]);

  const filtered = useMemo(() => allTasks
    .filter(t =>
      (!search         || (t.title ?? "").toLowerCase().includes(search.toLowerCase()) || (t.assignee_display ?? "").toLowerCase().includes(search.toLowerCase())) &&
      (!filterMeeting  || t.meeting_title  === filterMeeting)  &&
      (!filterAssignee || t.assignee_display === filterAssignee) &&
      (!filterPriority || t.priority === filterPriority) &&
      (filterStatus === "all"
        || (filterStatus === "overdue" ? isOverdue(t)
        : filterStatus === "mine" ? (t.assignee_id === meId && t.status !== "Completed")
        : t.status === filterStatus))
    )
    .sort((a, b) => {
      // Finished tasks always sink to the bottom
      const done = Number(a.status === "Completed") - Number(b.status === "Completed");
      if (done) return done;
      if (sortBy === "priority") return (PRIORITY_MAP[b.priority ?? ""] ?? 0) - (PRIORITY_MAP[a.priority ?? ""] ?? 0) || (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999");
      if (sortBy === "due")      return (a.due_date ?? "").localeCompare(b.due_date ?? "");
      if (sortBy === "assignee") return (a.assignee_display ?? "").localeCompare(b.assignee_display ?? "");
      return 0;
    }), [allTasks, search, filterMeeting, filterAssignee, filterPriority, filterStatus, sortBy, meId]);

  const STATUS_COUNTS = {
    all:           allTasks.length,
    mine:          allTasks.filter(t => t.assignee_id === meId && t.status !== "Completed").length,
    overdue:       allTasks.filter(isOverdue).length,
    Open:          allTasks.filter(t => t.status === "Open").length,
    "In Progress": allTasks.filter(t => t.status === "In Progress").length,
    Completed:     allTasks.filter(t => t.status === "Completed").length,
  };

  const assignTask = async (task: TasksDetail, a: Assignee) => {
    if (!task.id) return;
    const { error } = await supabase.from("tasks").update({ assignee_id: a.id, assignee_name: a.name }).eq("id", task.id);
    if (error) { showToast("Only editors can reassign tasks"); return; }
    setAllTasks(prev => prev.map(t => t.id === task.id ? { ...t, assignee_id: a.id, assignee_display: a.name ?? "Unassigned" } : t));
    showToast(a.name ? `Assigned to ${a.name}${a.id || a.name === "Whole team" ? "" : " (not in workspace)"}` : "Task unassigned");
    if (a.id) authFetch("/api/notify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ taskId: task.id, userId: a.id }) }).catch(() => {});
  };

  // Saves one or more fields of a task and updates the row and the open details panel.
  const updateTask = async (task: TasksDetail, patch: { status?: TaskStatus; priority?: string; due_date?: string | null; title?: string; description?: string | null }) => {
    if (!task.id) return;
    const body = {
      ...patch,
      updated_at: new Date().toISOString(),
      ...(patch.status ? { completed_at: patch.status === "Completed" ? new Date().toISOString() : null } : {}),
    };
    const { error } = await supabase.from("tasks").update(body).eq("id", task.id);
    if (error) { showToast("Only editors can change tasks"); return; }
    setAllTasks(prev => prev.map(t => t.id === task.id ? { ...t, ...patch } : t));
    setOpenTask(o => o && o.id === task.id ? { ...o, ...patch } : o);
    if (patch.status) showToast(patch.status === "Completed" ? "Task completed" : `Task moved to ${patch.status}`);
  };

  const exportTasks = (type: "txt" | "csv") => {
    const content = type === "csv"
      ? "Title,Assignee,Priority,Status,Meeting,Due\n" + filtered.map(t => `"${t.title}","${t.assignee_display}",${t.priority},${t.status},"${t.meeting_title ?? ""}",${t.due_date ?? ""}`).join("\n")
      : filtered.map(t => `[${t.priority}] ${t.title} -> ${t.assignee_display} (${t.status}) - Due ${t.due_date ?? "TBD"}`).join("\n");
    const blob = new Blob([content], { type: "text/plain" });
    const url  = URL.createObjectURL(blob);
    Object.assign(document.createElement("a"), { href: url, download: `tasks.${type}` }).click();
    URL.revokeObjectURL(url);
  };

  if (loading) return (
    <div className="page-enter" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "60vh" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "16px" }}>
        <div style={{ width: "32px", height: "32px", border: "3px solid var(--glass-border)", borderTopColor: "#0EA5E9", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
        <span style={{ fontSize: "13px", color: "var(--text-muted)" }}>Loading tasks...</span>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );

  return (
    <>
      <div style={{ paddingBottom: "48px" }} className="page-enter">
        <style>{TK_CSS}</style>
        <div className="page-header">
          <div>
            <div className="page-header-title">Tasks</div>
            <div className="page-header-sub">{STATUS_COUNTS.Open + STATUS_COUNTS["In Progress"]} open · {STATUS_COUNTS.overdue} overdue · {STATUS_COUNTS.Completed} completed</div>
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <button className="btn btn-secondary btn-sm" onClick={() => exportTasks("csv")}><Download size={13} /> Export</button>
            <button className="btn btn-primary btn-sm" onClick={() => setShowModal(true)} disabled={!workspaceId}><Plus size={13} /> Add task</button>
          </div>
        </div>

        <div className="page-body tk-body">
          <div className="tk-tabs" role="tablist">
            {([["all", "All"], ["mine", "Assigned to me"], ["overdue", "Overdue"], ["Open", "Open"], ["In Progress", "In progress"], ["Completed", "Completed"]] as const).map(([k, label]) => (
              <button key={k} role="tab" aria-selected={filterStatus === k} className={`${filterStatus === k ? "on" : ""}${k === "overdue" && STATUS_COUNTS.overdue ? " warn" : ""}`} onClick={() => setStatus(k)}>
                {label}<span>{STATUS_COUNTS[k as keyof typeof STATUS_COUNTS]}</span>
              </button>
            ))}
          </div>

          <div className="tk-filters">
            <div className="tk-search">
              <Search size={13} />
              <input placeholder="Search tasks or people" value={search} onChange={e => setSearch(e.target.value)} aria-label="Search tasks" />
            </div>
            <select className="tk-select" value={filterMeeting} onChange={e => setMeeting(e.target.value)} aria-label="Meeting">
              <option value="">All meetings</option>
              {meetings.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <select className="tk-select" value={filterAssignee} onChange={e => setAssignee(e.target.value)} aria-label="Assignee">
              <option value="">Anyone</option>
              {assignees.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
            <select className="tk-select" value={filterPriority} onChange={e => setPriority(e.target.value)} aria-label="Priority">
              <option value="">Any priority</option><option value="High">High</option><option value="Medium">Medium</option><option value="Low">Low</option>
            </select>
            <select className="tk-select" value={sortBy} onChange={e => setSortBy(e.target.value)} aria-label="Sort">
              <option value="priority">Sort by priority</option><option value="due">Sort by due date</option><option value="assignee">Sort by person</option>
            </select>
          </div>

          <div className="data-card" style={{ overflowX: "auto" }}>
            <table className="data-table mobile-cards tk-table">
              <thead>
                <tr><th style={{ width: "36px" }}></th><th>Task</th><th>Owner</th><th>Priority</th><th>Due</th><th>Status</th></tr>
              </thead>
              <tbody>
                {filtered.map(task => {
                  const done = task.status === "Completed";
                  const late = isOverdue(task);
                  return (
                    <tr key={task.id} className={`tk-row${done ? " done" : ""}`} onClick={() => setOpenTask(task)}>
                      <td onClick={e => e.stopPropagation()} className="mc-hide">
                        <button className={`tk-check${done ? " on" : ""}`} aria-label={done ? "Mark as not done" : "Mark as done"} title={done ? "Mark as not done" : "Mark as done"}
                          onClick={() => updateTask(task, { status: done ? "Open" : "Completed" })}>
                          {done && <Check size={12} />}
                        </button>
                      </td>
                      <td className="mc-title">
                        <div className="tk-title">{task.title}</div>
                        {task.meeting_title && <div className="tk-sub">{task.meeting_title}</div>}
                      </td>
                      <td onClick={e => e.stopPropagation()} data-label="Owner">
                        <div className="tk-owner">
                          <AssigneePicker compact autoCommit members={members}
                            value={{ id: task.assignee_id ?? null, name: task.assignee_display && task.assignee_display !== "Unassigned" ? task.assignee_display : null }}
                            onChange={a => assignTask(task, a)} placeholder="Unassigned" />
                          {!task.assignee_id && task.ai_extracted && (!task.assignee_display || task.assignee_display === "Unassigned") && (
                            <span className="badge badge-amber" title="The AI could not match this task to a team member. Pick the right owner.">Check owner</span>
                          )}
                        </div>
                      </td>
                      <td data-label="Priority"><span className={`tk-pri ${(task.priority ?? "Medium").toLowerCase()}`}>{task.priority}</span></td>
                      <td style={{ whiteSpace: "nowrap" }} data-label="Due"><span className={`tk-due${late ? " late" : ""}`}>{dueLabel(task.due_date, late)}</span></td>
                      <td onClick={e => e.stopPropagation()} data-label="Status">
                        <select className={`tk-status s-${(task.status ?? "Open").replace(" ", "").toLowerCase()}`} value={task.status ?? "Open"} onChange={e => updateTask(task, { status: e.target.value as TaskStatus })} aria-label="Status">
                          <option value="Open">Open</option><option value="In Progress">In progress</option><option value="Completed">Completed</option>
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filtered.length === 0 && (
              <div className="empty-state">
                <ListChecks size={30} color="var(--text-disabled)" />
                <p style={{ marginTop: "12px", fontSize: "14px" }}>{filterStatus === "overdue" ? "Nothing is overdue." : filterStatus === "mine" ? "Nothing is assigned to you." : "No tasks match your filters"}</p>
                <button className="btn btn-ghost btn-sm" style={{ marginTop: "10px" }} onClick={() => { setSearch(""); setMeeting(""); setAssignee(""); setPriority(""); setStatus("all"); }}>Show all tasks</button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Task details */}
      <AnimatePresence>
        {openTask && (
          <motion.div className="tk-drawer-bg" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpenTask(null)}>
            <motion.aside className="tk-drawer" role="dialog" aria-label="Task details" initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }} transition={{ duration: 0.18 }} onClick={e => e.stopPropagation()}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "flex-start" }}>
                <textarea className="tk-drawer-title" defaultValue={openTask.title ?? ""} key={openTask.id}
                  onBlur={e => { const v = e.target.value.trim(); if (v && v !== openTask.title) updateTask(openTask, { title: v }); }} rows={2} aria-label="Title" />
                <button className="btn btn-ghost btn-sm" onClick={() => setOpenTask(null)} aria-label="Close"><X size={15} /></button>
              </div>
              <div className="tk-fields">
                <label>Status
                  <select className="form-select" value={openTask.status ?? "Open"} onChange={e => updateTask(openTask, { status: e.target.value as TaskStatus })}>
                    <option value="Open">Open</option><option value="In Progress">In progress</option><option value="Completed">Completed</option>
                  </select>
                </label>
                <label>Priority
                  <select className="form-select" value={openTask.priority ?? "Medium"} onChange={e => updateTask(openTask, { priority: e.target.value })}>
                    <option value="High">High</option><option value="Medium">Medium</option><option value="Low">Low</option>
                  </select>
                </label>
                <label>Due date
                  <input type="date" className="form-input" value={openTask.due_date?.slice(0, 10) ?? ""} onChange={e => updateTask(openTask, { due_date: e.target.value || null })} />
                </label>
                <label>Owner
                  <AssigneePicker members={members} autoCommit
                    value={{ id: openTask.assignee_id ?? null, name: openTask.assignee_display && openTask.assignee_display !== "Unassigned" ? openTask.assignee_display : null }}
                    onChange={a => { assignTask(openTask, a); setOpenTask(o => o ? { ...o, assignee_id: a.id, assignee_display: a.name ?? "Unassigned" } : o); }} />
                </label>
              </div>
              <label className="tk-notes">Notes
                <textarea className="form-textarea" key={`d-${openTask.id}`} defaultValue={openTask.description ?? ""} placeholder="Add details"
                  onBlur={e => { const v = e.target.value.trim(); if (v !== (openTask.description ?? "")) updateTask(openTask, { description: v || null }); }} />
              </label>
              {openTask.meeting_id && (
                <a className="tk-meeting" href={`/meeting-summary?id=${openTask.meeting_id}&tab=tasks`}>
                  From the meeting <strong>{openTask.meeting_title ?? "Untitled"}</strong> <ChevronRight size={13} />
                </a>
              )}
              <div className="tk-meta">
                {openTask.ai_extracted ? "Found by ClarityMeet in the meeting" : "Added by hand"}{openTask.created_at ? ` · ${new Date(openTask.created_at).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}` : ""}
              </div>
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Add Task Modal */}
      <AnimatePresence>
        {showModal && workspaceId && (
          <AddTaskModal
            workspaceId={workspaceId}
            members={members}
            onClose={() => setShowModal(false)}
            onCreated={() => { load(); showToast("Task created successfully"); }}
          />
        )}
      </AnimatePresence>

      {/* Toast */}
      {toast && (
        <div className="toast toast-success" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {toast}
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
}

const TK_CSS = `
.tk-body { padding: 24px 36px; }
@media (max-width: 700px) { .tk-body { padding: 16px; } }
.tk-tabs { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 14px; }
.tk-tabs button { display: inline-flex; align-items: center; gap: 7px; padding: 6px 12px; border-radius: 999px; border: 1px solid var(--glass-border); background: transparent; color: var(--text-secondary); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; transition: background 150ms, color 150ms; }
.tk-tabs button span { font-size: 11px; color: var(--text-muted); font-variant-numeric: tabular-nums; }
.tk-tabs button.on { background: rgba(14,165,233,0.14); border-color: rgba(14,165,233,0.45); color: var(--text-primary); }
.tk-tabs button.warn span { color: var(--crimson); }
.tk-filters { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 14px; }
.tk-search { display: flex; align-items: center; gap: 8px; flex: 1 1 220px; height: 36px; padding: 0 12px; border-radius: 10px; border: 1px solid var(--glass-border); background: var(--bg-raised); }
.tk-search:focus-within { border-color: #0EA5E9; box-shadow: 0 0 0 3px rgba(14,165,233,0.18); }
.tk-search svg { color: var(--text-muted); }
.tk-search input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--text-primary); font: inherit; font-size: 13px; }
.tk-select { height: 36px; padding: 0 28px 0 12px; border-radius: 10px; border: 1px solid var(--glass-border); background-color: var(--bg-raised); color: var(--text-primary); font: inherit; font-size: 13px; max-width: 220px; cursor: pointer; }
.tk-table td { padding-top: 10px; padding-bottom: 10px; }
.tk-row { cursor: pointer; transition: background 150ms; }
.tk-row:hover { background: rgba(14,165,233,0.05); }
.tk-row.done .tk-title { color: var(--text-muted); text-decoration: line-through; }
.tk-row.done .tk-pri, .tk-row.done .tk-due, .tk-row.done .tk-owner { opacity: 0.5; }
.tk-check { width: 20px; height: 20px; border-radius: 50%; border: 1.5px solid var(--text-muted); background: transparent; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; color: #fff; padding: 0; transition: all 150ms; }
.tk-check:hover { border-color: var(--emerald-pulse); background: rgba(16,185,129,0.12); }
.tk-check.on { background: var(--emerald-pulse); border-color: var(--emerald-pulse); }
.tk-title { font-weight: 600; color: var(--text-primary); }
.tk-sub { font-size: 11px; color: var(--text-muted); margin-top: 2px; }
.tk-owner { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.tk-owner input, .tk-owner button { border-color: transparent !important; background: transparent !important; }
.tk-owner:hover input, .tk-owner:hover button, .tk-owner input:focus { border-color: var(--glass-border) !important; background: var(--bg-raised) !important; }
.tk-pri { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; color: var(--text-secondary); }
.tk-pri::before { content: ""; width: 8px; height: 8px; border-radius: 2px; background: #94A3B8; }
.tk-pri.high::before { background: #EF4444; }
.tk-pri.medium::before { background: #F59E0B; }
.tk-due { font-size: 13px; color: var(--text-secondary); }
.tk-due.late { color: var(--crimson); font-weight: 600; }
.tk-status { height: 28px; padding: 0 24px 0 10px; border-radius: 999px; border: 1px solid var(--glass-border); background-color: transparent; color: var(--text-secondary); font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; }
.tk-status.s-inprogress { color: #38BDF8; border-color: rgba(14,165,233,0.4); }
.tk-status.s-completed { color: var(--emerald-pulse); border-color: rgba(16,185,129,0.4); }
.tk-drawer-bg { position: fixed; inset: 0; z-index: 900; background: rgba(0,0,0,0.35); }
.tk-drawer { position: absolute; top: 0; right: 0; bottom: 0; width: min(440px, 100%); overflow-y: auto; padding: 24px; background: var(--bg-elevated); border-left: 1px solid var(--glass-border); box-shadow: -20px 0 40px rgba(0,0,0,0.25); display: flex; flex-direction: column; gap: 18px; }
.tk-drawer-title { flex: 1; border: 1px solid transparent; border-radius: 8px; background: transparent; color: var(--text-primary); font: inherit; font-size: 19px; font-weight: 700; line-height: 1.3; resize: none; padding: 4px 6px; margin: -4px -6px; }
.tk-drawer-title:hover, .tk-drawer-title:focus { border-color: var(--glass-border); outline: 0; }
.tk-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.tk-fields label, .tk-notes { display: flex; flex-direction: column; gap: 6px; font-size: 12px; font-weight: 600; color: var(--text-muted); }
.tk-notes textarea { min-height: 110px; }
.tk-meeting { display: flex; align-items: center; gap: 6px; padding: 10px 12px; border-radius: 10px; border: 1px solid var(--glass-border); font-size: 13px; color: var(--text-secondary); text-decoration: none; }
.tk-meeting strong { color: var(--text-primary); }
.tk-meeting:hover { border-color: rgba(14,165,233,0.45); }
.tk-meta { font-size: 12px; color: var(--text-muted); margin-top: auto; }
`;
