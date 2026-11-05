"use client";
export const dynamic = 'force-dynamic';
// Task management - Add Task modal + inline status toggle via Supabase.


import { useState, useEffect, useCallback, useMemo } from "react";
import { ListChecks, Download, Search, Plus, X, ChevronRight } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/current-user";
import { getFirstWorkspaceId } from "@/lib/workspace";
import { useWorkspace } from "@/app/components/WorkspaceContext";
import type { TasksDetail, TaskStatus } from "@/lib/database.types";
import { authFetch } from "@/lib/auth-fetch";

type Member = { id: string; name: string };

const PRIORITY_MAP: Record<string, number> = { High: 3, Medium: 2, Low: 1 };
const STATUS_CYCLE: Record<TaskStatus, TaskStatus> = {
  "Open": "In Progress",
  "In Progress": "Completed",
  "Completed": "Open",
  "Cancelled": "Open",
};

// Add Task Modal
interface AddTaskModalProps {
  workspaceId: string;
  onClose: () => void;
  onCreated: () => void;
}

function AddTaskModal({ workspaceId, onClose, onCreated }: AddTaskModalProps) {
  const [title, setTitle]         = useState("");
  const [description, setDesc]    = useState("");
  const [priority, setPriority]   = useState("Medium");
  const [assigneeName, setAssignee] = useState("");
  const [dueDate, setDueDate]     = useState("");
  const [saving, setSaving]       = useState(false);
  const [err, setErr]             = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) { setErr("Title is required"); return; }
    setSaving(true);
    setErr(null);

    const user = await getCurrentUser();
    const { error } = await supabase.from("tasks").insert({
      workspace_id:  workspaceId,
      title:         title.trim(),
      description:   description.trim() || null,
      priority,
      status:        "Open",
      assignee_name: assigneeName.trim() || null,
      due_date:      dueDate || null,
      created_by:    user?.id ?? null,
      ai_extracted:  false,
    });

    if (error) { setErr(error.message); setSaving(false); return; }
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
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
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
            <label className="form-label">Assignee name</label>
            <input
              className="form-input"
              placeholder="e.g. John Doe"
              value={assigneeName}
              onChange={e => setAssignee(e.target.value)}
            />
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
  const [togglingId,     setTogglingId] = useState<string | null>(null);
  const [toast, setToast]               = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2800);
  };

  const load = useCallback(async () => {
    const user = await getCurrentUser();
    if (!user) return;
    const wsId = activeWorkspace?.workspace_id ?? (await getFirstWorkspaceId(user.id));
    if (!wsId) { setLoading(false); return; }
    setWorkspaceId(wsId);
    const { data: mem } = await supabase.from("workspace_members").select("user_id, users(first_name, last_name, email)").eq("workspace_id", wsId);
    setMembers(((mem ?? []) as unknown as { user_id: string; users: { first_name: string | null; last_name: string | null; email: string | null } | null }[])
      .map(m => ({ id: m.user_id, name: [m.users?.first_name, m.users?.last_name].filter(Boolean).join(" ") || m.users?.email || "Member" })));
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
      (filterStatus === "all" || t.status === filterStatus)
    )
    .sort((a, b) => {
      if (sortBy === "priority") return (PRIORITY_MAP[b.priority ?? ""] ?? 0) - (PRIORITY_MAP[a.priority ?? ""] ?? 0);
      if (sortBy === "due")      return (a.due_date ?? "").localeCompare(b.due_date ?? "");
      if (sortBy === "assignee") return (a.assignee_display ?? "").localeCompare(b.assignee_display ?? "");
      return 0;
    }), [allTasks, search, filterMeeting, filterAssignee, filterPriority, filterStatus, sortBy]);

  const STATUS_COUNTS = {
    all:           allTasks.length,
    Open:          allTasks.filter(t => t.status === "Open").length,
    "In Progress": allTasks.filter(t => t.status === "In Progress").length,
    Completed:     allTasks.filter(t => t.status === "Completed").length,
  };

  const assignTask = async (task: TasksDetail, userId: string) => {
    if (!task.id) return;
    const member = members.find(m => m.id === userId) ?? null;
    const { error } = await supabase.from("tasks").update({ assignee_id: member?.id ?? null, assignee_name: member?.name ?? null }).eq("id", task.id);
    if (error) { showToast("Only editors can reassign tasks"); return; }
    setAllTasks(prev => prev.map(t => t.id === task.id ? { ...t, assignee_id: member?.id ?? null, assignee_display: member?.name ?? "Unassigned" } : t));
    showToast(member ? `Assigned to ${member.name}` : "Task unassigned");
    if (member) authFetch("/api/notify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ taskId: task.id, userId: member.id }) }).catch(() => {});
  };

  const toggleStatus = async (task: TasksDetail) => {
    const nextStatus: TaskStatus = STATUS_CYCLE[task.status as TaskStatus] ?? "Open";
    if (!task.id) return;
    setTogglingId(task.id);
    const { error } = await supabase
      .from("tasks")
      .update({
        status: nextStatus,
        completed_at: nextStatus === "Completed" ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", task.id);
    if (!error) {
      setAllTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: nextStatus } : t));
      showToast(`Task moved to "${nextStatus}"`);
    }
    setTogglingId(null);
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
        <div className="page-header">
          <div>
            <div className="page-header-title">Task Management</div>
            <div className="page-header-sub">{filtered.length} tasks across {meetings.length} meetings · click any row to cycle status</div>
          </div>
          <div style={{ display: "flex", gap: "10px" }}>
            <button className="btn btn-secondary btn-sm" onClick={() => exportTasks("csv")}><Download size={13} /> Export</button>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => setShowModal(true)}
              disabled={!workspaceId}
            >
              <Plus size={13} /> Add Task
            </button>
          </div>
        </div>

        <div style={{ padding: "28px 36px" }}>
          {/* Status tabs */}
          <div style={{ display: "flex", gap: "8px", marginBottom: "22px", flexWrap: "wrap" }}>
            {(["all","Open","In Progress","Completed"] as const).map(s => (
              <button key={s} onClick={() => setStatus(s)} style={{
                padding: "8px 18px", border: "1px solid", borderRadius: "var(--radius-md)", cursor: "pointer",
                fontSize: "13px", fontWeight: 600, transition: "all 200ms",
                background: filterStatus === s ? "var(--grad-neural)" : "var(--glass-white)",
                borderColor: filterStatus === s ? "transparent" : "var(--glass-border)",
                color: filterStatus === s ? "white" : "var(--text-secondary)",
                boxShadow: filterStatus === s ? "0 4px 16px var(--glow-teal)" : "none",
              }}>
                {s === "all" ? "All" : s}{" "}
                <span style={{ opacity: 0.7, fontSize: "11px" }}>{STATUS_COUNTS[s as keyof typeof STATUS_COUNTS]}</span>
              </button>
            ))}
          </div>

          {/* Filters row */}
          <div style={{ display: "flex", gap: "10px", marginBottom: "20px", flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ position: "relative", flex: "1 1 220px" }}>
              <Search size={13} color="var(--text-muted)" style={{ position: "absolute", left: "13px", top: "50%", transform: "translateY(-50%)" }} />
              <input className="form-input" placeholder="Search tasks or assignees..." value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: "36px" }} />
            </div>
            <select className="form-select" value={filterMeeting}  onChange={e => setMeeting(e.target.value)}>
              <option value="">All Meetings</option>
              {meetings.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <select className="form-select" value={filterAssignee} onChange={e => setAssignee(e.target.value)}>
              <option value="">All Assignees</option>
              {assignees.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
            <select className="form-select" value={filterPriority} onChange={e => setPriority(e.target.value)}>
              <option value="">All Priorities</option>
              <option value="High">High</option>
              <option value="Medium">Medium</option>
              <option value="Low">Low</option>
            </select>
            <select className="form-select" value={sortBy} onChange={e => setSortBy(e.target.value)}>
              <option value="priority">Sort: Priority</option>
              <option value="due">Sort: Due Date</option>
              <option value="assignee">Sort: Assignee</option>
            </select>
          </div>

          {/* Table */}
          <div className="data-card">
            <table className="data-table">
              <thead>
                <tr><th>Task</th><th>Assignee</th><th>Meeting</th><th>Priority</th><th>Due</th><th>Status</th><th style={{ width: "40px" }}></th></tr>
              </thead>
              <tbody>
                {filtered.map((task, i) => (
                  <motion.tr
                    key={task.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.03, duration: 0.22 }}
                    style={{ cursor: "pointer", opacity: togglingId === task.id ? 0.5 : 1, transition: "opacity 150ms" }}
                    onClick={() => toggleStatus(task)}
                    title="Click to advance status"
                  >
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <div className={`priority-dot priority-${(task.priority ?? "Medium").toLowerCase()}`} />
                        <span style={{ color: "var(--text-primary)", fontWeight: 500, textDecoration: task.status === "Completed" ? "line-through" : "none", opacity: task.status === "Completed" ? 0.6 : 1 }}>
                          {task.title}
                        </span>
                      </div>
                    </td>
                    <td onClick={e => e.stopPropagation()}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <div className="avatar avatar-sm">{(task.assignee_display ?? "Unassigned").split(" ").map((n: string) => n[0]).join("")}</div>
                        <select className="form-select" value={task.assignee_id ?? ""} onChange={e => assignTask(task, e.target.value)}
                          style={{ padding: "4px 8px", fontSize: "13px", minWidth: "130px", background: "transparent" }} aria-label="Assignee">
                          <option value="">{task.assignee_id ? "Unassigned" : (task.assignee_display ?? "Unassigned")}</option>
                          {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                        </select>
                        {!task.assignee_id && task.ai_extracted && (
                          <span className="badge badge-amber" title="The AI could not match this task to a team member. Pick the right owner.">Check owner</span>
                        )}
                      </div>
                    </td>
                    <td><span style={{ fontSize: "13px", color: "var(--text-muted)" }}>{task.meeting_title ?? "-"}</span></td>
                    <td><span className={`badge ${task.priority === "High" ? "badge-red" : task.priority === "Medium" ? "badge-amber" : "badge-muted"}`}>{task.priority}</span></td>
                    <td style={{ fontSize: "13px" }}>{task.due_date ?? "-"}</td>
                    <td><span className={`badge ${task.status === "Completed" ? "badge-green" : task.status === "In Progress" ? "badge-amber" : "badge-muted"}`}>{task.status}</span></td>
                    <td><ChevronRight size={13} color="var(--text-disabled)" /></td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
            {filtered.length === 0 && (
              <div className="empty-state">
                <ListChecks size={32} color="var(--text-disabled)" />
                <p style={{ marginTop: "12px", fontSize: "14px" }}>No tasks match your filters</p>
                <button className="btn btn-ghost btn-sm" style={{ marginTop: "10px" }} onClick={() => { setSearch(""); setMeeting(""); setAssignee(""); setPriority(""); setStatus("all"); }}>
                  Clear all filters
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Add Task Modal */}
      <AnimatePresence>
        {showModal && workspaceId && (
          <AddTaskModal
            workspaceId={workspaceId}
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