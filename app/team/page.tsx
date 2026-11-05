"use client";
export const dynamic = "force-dynamic";
// Team - everyone in the active workspace. Click a person to see their
// email, role, when they joined and their meetings/tasks in this workspace.
// Admins can change roles and remove members (enforced again by RLS).

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { Mail, Search, UserPlus, X, Shield, CalendarDays, ListChecks, Video, Copy, Check } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/current-user";
import { useWorkspace } from "@/app/components/WorkspaceContext";

type Role = "admin" | "member" | "viewer";
type Member = {
  id: string;            // workspace_members.id
  user_id: string;
  role: Role;
  joined_at: string | null;
  first_name: string;
  last_name: string;
  email: string;
  avatar_url: string | null;
  timezone: string | null;
};
type MemberStats = { meetings: number; openTasks: number; doneTasks: number };

const ROLE_HELP: Record<Role, string> = {
  admin: "Can invite people, change roles and remove members",
  member: "Can record meetings, upload files and manage tasks",
  viewer: "Can view meetings and tasks",
};

function fullName(m: Member) {
  return [m.first_name, m.last_name].filter(Boolean).join(" ") || m.email.split("@")[0] || "Unnamed";
}
function initials(m: Member) {
  const s = [m.first_name[0], m.last_name[0]].filter(Boolean).join("") || fullName(m)[0] || "?";
  return s.toUpperCase();
}
function fmtDate(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" }) : "-";
}

export default function TeamPage() {
  const { activeWorkspace } = useWorkspace();
  const [members, setMembers] = useState<Member[]>([]);
  const [me, setMe] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Member | null>(null);
  const [stats, setStats] = useState<MemberStats | null>(null);
  const [copied, setCopied] = useState(false);

  const myRole = members.find(m => m.user_id === me)?.role;
  const isAdmin = myRole === "admin";

  const load = useCallback(async () => {
    if (!activeWorkspace) return;
    setLoading(true);
    const user = await getCurrentUser();
    setMe(user?.id ?? null);
    const { data, error: e } = await supabase
      .from("workspace_members")
      .select("id, user_id, role, joined_at, users(first_name, last_name, email, avatar_url, timezone)")
      .eq("workspace_id", activeWorkspace.workspace_id)
      .order("joined_at", { ascending: true }) as {
        data: Array<{ id: string; user_id: string; role: Role; joined_at: string | null;
          users: { first_name: string | null; last_name: string | null; email: string | null; avatar_url: string | null; timezone: string | null } | null }> | null;
        error: { message: string } | null;
      };
    if (e) setError(e.message);
    setMembers((data ?? []).map(r => ({
      id: r.id, user_id: r.user_id, role: r.role, joined_at: r.joined_at,
      first_name: r.users?.first_name ?? "", last_name: r.users?.last_name ?? "",
      email: r.users?.email ?? "", avatar_url: r.users?.avatar_url ?? null, timezone: r.users?.timezone ?? null,
    })));
    setLoading(false);
  }, [activeWorkspace]);

  useEffect(() => { load(); }, [load]);

  // Per-person stats when a member is opened
  useEffect(() => {
    if (!selected || !activeWorkspace) return;
    let cancelled = false;
    setStats(null);
    (async () => {
      const ws = activeWorkspace.workspace_id;
      const [m, open, done] = await Promise.all([
        supabase.from("meetings").select("id", { count: "exact", head: true }).eq("workspace_id", ws).eq("owner_id", selected.user_id),
        supabase.from("tasks").select("id", { count: "exact", head: true }).eq("workspace_id", ws).eq("assignee_id", selected.user_id).neq("status", "Completed"),
        supabase.from("tasks").select("id", { count: "exact", head: true }).eq("workspace_id", ws).eq("assignee_id", selected.user_id).eq("status", "Completed"),
      ]);
      if (!cancelled) setStats({ meetings: m.count ?? 0, openTasks: open.count ?? 0, doneTasks: done.count ?? 0 });
    })();
    return () => { cancelled = true; };
  }, [selected, activeWorkspace]);

  // Close the panel with Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSelected(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return members;
    return members.filter(m => fullName(m).toLowerCase().includes(q) || m.email.toLowerCase().includes(q) || m.role.includes(q));
  }, [members, query]);

  const changeRole = async (m: Member, role: Role) => {
    setError("");
    const { error: e } = await supabase.from("workspace_members").update({ role }).eq("id", m.id);
    if (e) { setError(e.message); return; }
    setMembers(prev => prev.map(x => x.id === m.id ? { ...x, role } : x));
    setSelected(prev => prev && prev.id === m.id ? { ...prev, role } : prev);
  };

  const remove = async (m: Member) => {
    if (!window.confirm(`Remove ${fullName(m)} from ${activeWorkspace?.name}?`)) return;
    const { error: e } = await supabase.from("workspace_members").delete().eq("id", m.id);
    if (e) { setError(e.message); return; }
    setMembers(prev => prev.filter(x => x.id !== m.id));
    setSelected(null);
  };

  const copyEmail = async (email: string) => {
    try { await navigator.clipboard.writeText(email); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
  };

  return (
    <div style={{ paddingBottom: 48 }} className="page-enter">
      <div className="page-header">
        <div>
          <div className="page-header-title">Team</div>
          <div className="page-header-sub">{members.length} {members.length === 1 ? "person" : "people"} in {activeWorkspace?.name ?? "this workspace"}</div>
        </div>
        {isAdmin && (
          <Link href="/invite" className="btn btn-primary btn-sm" style={{ textDecoration: "none" }}>
            <UserPlus size={14} /> Invite
          </Link>
        )}
      </div>

      <div style={{ padding: "24px 32px" }} className="team-body">
        <label className="team-search">
          <Search size={15} aria-hidden="true" />
          <input
            type="search" value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Search by name, email or role" aria-label="Search team members"
          />
        </label>

        {error && <p role="alert" style={{ color: "var(--crimson)", fontSize: 13, margin: "12px 0" }}>{error}</p>}

        <div className="data-card" style={{ marginTop: 16 }}>
          {loading ? (
            <p style={{ padding: 24, color: "var(--text-muted)", fontSize: 14 }}>Loading team...</p>
          ) : filtered.length === 0 ? (
            <p style={{ padding: 24, color: "var(--text-muted)", fontSize: 14 }}>No one matches &quot;{query}&quot;.</p>
          ) : (
            <ul className="team-list">
              {filtered.map(m => (
                <li key={m.id}>
                  <button type="button" className="team-row" onClick={() => setSelected(m)} aria-haspopup="dialog">
                    {m.avatar_url
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={m.avatar_url} alt="" className="avatar avatar-md" style={{ objectFit: "cover" }} />
                      : <span className="avatar avatar-md" aria-hidden="true">{initials(m)}</span>}
                    <span className="team-row-main">
                      <span className="team-row-name">{fullName(m)}{m.user_id === me && <span className="team-you">You</span>}</span>
                      <span className="team-row-email">{m.email}</span>
                    </span>
                    <span className={`team-role team-role-${m.role}`}>{m.role}</span>
                    <span className="team-row-joined">Joined {fmtDate(m.joined_at)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Rendered into <body>: the page's entrance animation uses a CSS
          transform, which would otherwise trap this fixed panel inside it. */}
      {selected && typeof document !== "undefined" && createPortal(
        <div className="team-overlay" onClick={() => setSelected(null)}>
          <aside
            className="team-panel" role="dialog" aria-modal="true" aria-labelledby="member-name"
            onClick={e => e.stopPropagation()}
          >
            <button type="button" className="btn btn-ghost btn-sm team-close" onClick={() => setSelected(null)} aria-label="Close" autoFocus>
              <X size={16} />
            </button>

            {selected.avatar_url
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={selected.avatar_url} alt="" className="avatar avatar-xl" style={{ objectFit: "cover" }} />
              : <span className="avatar avatar-xl" aria-hidden="true">{initials(selected)}</span>}
            <h2 id="member-name" className="team-panel-name">{fullName(selected)}</h2>
            <span className={`team-role team-role-${selected.role}`}>{selected.role}</span>

            <dl className="team-details">
              <div>
                <dt><Mail size={14} aria-hidden="true" /> Email</dt>
                <dd>
                  <a href={`mailto:${selected.email}`}>{selected.email || "-"}</a>
                  {selected.email && (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => copyEmail(selected.email)} aria-label="Copy email address">
                      {copied ? <Check size={13} /> : <Copy size={13} />}
                    </button>
                  )}
                </dd>
              </div>
              <div>
                <dt><Shield size={14} aria-hidden="true" /> Role</dt>
                <dd>
                  {isAdmin && selected.user_id !== me ? (
                    <select className="form-select" value={selected.role} onChange={e => changeRole(selected, e.target.value as Role)} aria-label="Role" style={{ width: "auto" }}>
                      <option value="admin">Admin</option>
                      <option value="member">Member</option>
                      <option value="viewer">Viewer</option>
                    </select>
                  ) : <span style={{ textTransform: "capitalize" }}>{selected.role}</span>}
                  <small>{ROLE_HELP[selected.role]}</small>
                </dd>
              </div>
              <div>
                <dt><CalendarDays size={14} aria-hidden="true" /> Joined</dt>
                <dd>{fmtDate(selected.joined_at)}{selected.timezone ? ` · ${selected.timezone}` : ""}</dd>
              </div>
            </dl>

            <div className="team-stats">
              <div><Video size={15} aria-hidden="true" /><strong>{stats?.meetings ?? "..."}</strong><span>meetings recorded</span></div>
              <div><ListChecks size={15} aria-hidden="true" /><strong>{stats?.openTasks ?? "..."}</strong><span>open tasks</span></div>
              <div><Check size={15} aria-hidden="true" /><strong>{stats?.doneTasks ?? "..."}</strong><span>tasks done</span></div>
            </div>

            {isAdmin && selected.user_id !== me && (
              <button type="button" className="btn btn-danger" style={{ marginTop: 24, width: "100%" }} onClick={() => remove(selected)}>
                Remove from workspace
              </button>
            )}
          </aside>
        </div>,
        document.body
      )}

      <style>{`
        .team-search { display: flex; align-items: center; gap: 8px; max-width: 420px; padding: 9px 12px; border: 1px solid var(--glass-strong); border-radius: var(--radius-sm); background: var(--bg-elevated); color: var(--text-muted); }
        .team-search input { flex: 1; border: 0; outline: 0; background: transparent; color: var(--text-primary); font: inherit; font-size: 14px; }
        .team-search:focus-within { border-color: var(--electric-teal); }
        .team-list { list-style: none; margin: 0; padding: 0; }
        .team-list li + li { border-top: 1px solid var(--glass-border); }
        .team-row { width: 100%; display: grid; grid-template-columns: auto 1fr auto auto; align-items: center; gap: 14px; padding: 14px 20px; background: none; border: 0; cursor: pointer; text-align: left; color: inherit; font: inherit; }
        .team-row:hover { background: var(--glass-white); }
        .team-row:focus-visible { outline: 2px solid var(--electric-teal); outline-offset: -2px; }
        .team-row-main { display: flex; flex-direction: column; min-width: 0; }
        .team-row-name { font-size: 14px; font-weight: 600; color: var(--text-primary); display: flex; align-items: center; gap: 8px; }
        .team-row-email { font-size: 12.5px; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .team-row-joined { font-size: 12.5px; color: var(--text-muted); }
        .team-you { font-size: 11px; font-weight: 600; color: var(--text-muted); border: 1px solid var(--glass-strong); border-radius: 999px; padding: 1px 7px; }
        .team-role { font-size: 12px; font-weight: 600; text-transform: capitalize; padding: 3px 10px; border-radius: 999px; justify-self: start; }
        .team-role-admin { background: rgba(37,99,235,0.1); color: #2563eb; }
        .team-role-member { background: rgba(16,185,129,0.1); color: #059669; }
        .team-role-viewer { background: var(--glass-white); color: var(--text-secondary); border: 1px solid var(--glass-border); }
        .team-overlay { position: fixed; inset: 0; background: rgba(15,23,42,0.35); z-index: 300; display: flex; justify-content: flex-end; }
        .team-panel { position: relative; width: min(420px, 100%); height: 100%; overflow-y: auto; background: var(--bg-elevated); border-left: 1px solid var(--glass-border); padding: 40px 28px; display: flex; flex-direction: column; align-items: flex-start; gap: 10px; }
        .team-close { position: absolute; top: 14px; right: 14px; }
        .team-panel-name { font-size: 22px; font-weight: 700; color: var(--text-primary); margin: 8px 0 0; letter-spacing: -0.01em; }
        .team-details { width: 100%; margin: 20px 0 0; display: flex; flex-direction: column; }
        .team-details > div { padding: 14px 0; border-top: 1px solid var(--glass-border); }
        .team-details dt { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-muted); margin-bottom: 6px; }
        .team-details dd { margin: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 14px; color: var(--text-primary); }
        .team-details dd a { color: var(--electric-teal); text-decoration: none; word-break: break-all; }
        .team-details dd small { width: 100%; font-size: 12px; color: var(--text-muted); }
        .team-stats { width: 100%; display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 8px; }
        .team-stats > div { border: 1px solid var(--glass-border); border-radius: var(--radius-md); padding: 12px; display: flex; flex-direction: column; gap: 4px; color: var(--text-muted); }
        .team-stats strong { font-size: 20px; color: var(--text-primary); }
        .team-stats span { font-size: 12px; }
        @media (max-width: 640px) {
          .team-body { padding: 16px !important; }
          .team-row { grid-template-columns: auto 1fr auto; padding: 12px 14px; }
          .team-row-joined { display: none; }
        }
      `}</style>
    </div>
  );
}
