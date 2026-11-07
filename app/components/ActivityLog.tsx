"use client";

import { useEffect, useState } from "react";
import { History } from "lucide-react";
import { supabase } from "@/lib/supabase";

type Row = { id: string; action: string; created_at: string; payload: Record<string, unknown> | null; user_id: string | null; users?: { first_name: string | null; last_name: string | null; email: string | null } | null };

const LABEL: Record<string, string> = {
  "meeting.created": "added a meeting",
  "meeting.deleted": "deleted a meeting",
  "meeting.summary_edited": "edited a meeting summary",
  "task.created": "created a task",
  "task.deleted": "deleted a task",
  "task.status_changed": "changed a task's status",
  "member.added": "added a member",
  "member.removed": "removed a member",
  "member.role_changed": "changed a member's role",
  "user.login": "signed in",
};

export default function ActivityLog({ workspaceId }: { workspaceId: string | null }) {
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    if (!workspaceId) return;
    supabase
      .from("audit_logs")
      .select("id, action, created_at, payload, user_id, users(first_name, last_name, email)")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(100)
      .then(({ data }) => setRows((data ?? []) as unknown as Row[]));
  }, [workspaceId]);

  const who = (r: Row) => {
    const u = r.users;
    const name = [u?.first_name, u?.last_name].filter(Boolean).join(" ");
    return name || u?.email || (r.user_id ? "A member" : "ClarityMeet");
  };

  const detail = (r: Row) => {
    const p = r.payload ?? {};
    const title = typeof p.title === "string" ? `"${p.title}"` : "";
    if (r.action === "task.status_changed") return `${title} from ${String(p.from ?? "?")} to ${String(p.to ?? "?")}`;
    return title;
  };

  return (
    <div className="data-card">
      <div style={{ padding: "18px 24px", borderBottom: "1px solid var(--glass-border)", display: "flex", alignItems: "center", gap: "8px" }}>
        <History size={15} />
        <h3 style={{ fontFamily: "var(--font-display)", fontSize: "15px", fontWeight: 700, color: "var(--text-primary)" }}>Activity log</h3>
        <span style={{ marginLeft: "auto", fontSize: "12px", color: "var(--text-muted)" }}>Every change to meetings, tasks and members</span>
      </div>
      {rows === null ? (
        <div style={{ padding: "24px" }}><div className="spinner" /></div>
      ) : rows.length === 0 ? (
        <p style={{ padding: "24px", fontSize: "13px", color: "var(--text-muted)" }}>No activity recorded yet.</p>
      ) : (
        <table className="data-table">
          <thead><tr><th>When</th><th>Who</th><th>What</th></tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id}>
                <td style={{ whiteSpace: "nowrap", color: "var(--text-muted)" }}>{new Date(r.created_at).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                <td>{who(r)}</td>
                <td>{LABEL[r.action] ?? r.action} <span style={{ color: "var(--text-muted)" }}>{detail(r)}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
