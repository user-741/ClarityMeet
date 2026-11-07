"use client";

import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import {
  Users,
  LayoutDashboard, FileText, ListChecks, BarChart2, CalendarDays,
  Settings, Video, Zap, LogOut, ChevronDown, Bell, Upload,
  Sun, Moon, UserCircle, Building2, CheckCheck, X, Search,
} from "lucide-react";
import { useState, useEffect, useCallback, useRef } from "react";
import ThemeSwitch from "./ThemeSwitch";
import { useTheme } from "./ThemeProvider";
import { supabase } from "@/lib/supabase";
import { authFetch } from "@/lib/auth-fetch";
import { getCurrentUser } from "@/lib/current-user";
import { useWorkspace } from "./WorkspaceContext";

const NAV_MAIN = [
  { label: "Dashboard",       href: "/dashboard",       icon: LayoutDashboard },
  { label: "Search",          href: "/search",          icon: Search },
  { label: "Meetings",        href: "/meeting-summary", icon: FileText },
  { label: "Tasks",           href: "/tasks",           icon: ListChecks },
  { label: "Analytics",       href: "/analytics",       icon: BarChart2 },
  { label: "Calendar",        href: "/calendar",        icon: CalendarDays },
  { label: "Team",            href: "/team",            icon: Users },
];

const NAV_TOOLS = [
  { label: "Upload / Transcribe", href: "/upload",   icon: Upload },
  { label: "Bots",                href: "/bot",      icon: Video },
  { label: "Settings",            href: "/settings", icon: Settings },
];

type Workspace   = { workspace_id: string; name: string; role: string };
type Notification = { id: string; type: string; title: string; body: string; link: string | null; created_at: string; read: boolean };
type NotifRow = { id: string; type: string; title: string; body: string | null; link: string | null; created_at: string; read: boolean };

const toNotif = (n: NotifRow, read: boolean): Notification => ({ id: n.id, type: n.type, title: n.title, body: n.body ?? "", link: n.link, created_at: n.created_at, read });

// Creates in-app reminders for my tasks that are due within a day or overdue.
async function createDueReminders(userId: string) {
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
  const { data: due } = await supabase
    .from("tasks")
    .select("id, title, due_date, workspace_id, meeting_id")
    .eq("assignee_id", userId)
    .in("status", ["Open", "In Progress"])
    .not("due_date", "is", null)
    .lte("due_date", tomorrow)
    .limit(20);
  if (!due?.length) return;
  const since = new Date(); since.setHours(0, 0, 0, 0);
  const { data: sent } = await supabase
    .from("notifications").select("link").eq("user_id", userId).gte("created_at", since.toISOString()).like("link", "/tasks?reminder=%");
  const already = new Set((sent ?? []).map(s => s.link));
  const rows = due
    .filter(t => !already.has(`/tasks?reminder=${t.id}`))
    .map(t => {
      const overdue = (t.due_date as string) < today;
      return {
        user_id: userId,
        workspace_id: t.workspace_id,
        type: (overdue ? "warning" : "info") as "warning" | "info",
        title: overdue ? `Overdue: ${t.title}` : `Due ${t.due_date === today ? "today" : "tomorrow"}: ${t.title}`,
        body: overdue ? `This task was due on ${new Date(t.due_date as string).toLocaleDateString("en-AU")}.` : "Reminder for a task assigned to you.",
        link: `/tasks?reminder=${t.id}`,
        read: false,
      };
    });
  if (rows.length) {
    await supabase.from("notifications").insert(rows);
    const ids = due.filter(t => !already.has(`/tasks?reminder=${t.id}`)).map(t => t.id);
    authFetch("/api/notify/reminders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ taskIds: ids }) }).catch(() => {});
  }
}

function desktopAlert(n: Notification) {
  try {
    if (typeof window === "undefined" || !("Notification" in window) || window.Notification.permission !== "granted") return;
    new window.Notification(n.title, { body: n.body, icon: "/favicon.ico" });
  } catch { /* ignore */ }
}

const STORAGE_KEY = "claritymeet_notif_read_ids";
function loadReadIds(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]")); } catch { return new Set(); }
}
function saveReadIds(ids: Set<string>) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids])); } catch {}
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function Sidebar({ mobileOpen = false, onClose }: { mobileOpen?: boolean; onClose?: () => void } = {}) {
  const pathname = usePathname();
  const router   = useRouter();
  const { theme } = useTheme();
  const { activeWorkspace, workspaces, setActiveWorkspace } = useWorkspace();

  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [wsMenuOpen,   setWsMenuOpen]   = useState(false);
  const [notifOpen,    setNotifOpen]    = useState(false);
  const [userName,     setUserName]     = useState("User");
  const [userInitials, setUserInitials] = useState("U");
  const [userRole,     setUserRole]     = useState("member");
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unread,        setUnread]        = useState(0);

  const channelRef    = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const loadData = useCallback(async () => {
    const user = await getCurrentUser();
    if (!user) return;

    // User profile
    const { data: rawUserData } = await supabase
      .from("users").select("first_name, last_name").eq("id", user.id).single() as
      { data: { first_name: string | null; last_name: string | null } | null };
    if (rawUserData) {
      const fn   = rawUserData.first_name ?? "";
      const ln   = rawUserData.last_name  ?? "";
      const full = [fn, ln].filter(Boolean).join(" ") || user.email?.split("@")[0] || "User";
      setUserName(full);
      setUserInitials([fn[0], ln[0]].filter(Boolean).join("").toUpperCase() || full[0]?.toUpperCase() || "U");
    }

    // Fetch real notifications for this user from the notifications table
    const readIds = loadReadIds();
    await createDueReminders(user.id).catch(() => {});
    const { data: notifRows } = await supabase
      .from("notifications")
      .select("id, type, title, body, link, created_at, read")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(20) as {
        data: NotifRow[] | null
      };

    if (notifRows?.length) {
      const mapped: Notification[] = notifRows.map(n => toNotif(n, n.read || readIds.has(n.id)));
      setNotifications(mapped);
      setUnread(mapped.filter(n => !n.read).length);
    }
  }, []);

  // Realtime, subscribe to new rows in notifications table for this user
  useEffect(() => {
    getCurrentUser().then((user) => {
      if (!user) return;
      if (channelRef.current) { supabase.removeChannel(channelRef.current); }

      const channel = supabase
        .channel("user_notifications")
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
          (payload) => {
            const newNotif = toNotif(payload.new as NotifRow, false);
            desktopAlert(newNotif);
            setNotifications(prev => [newNotif, ...prev.filter(n => n.id !== newNotif.id)]);
            setUnread(prev => prev + 1);
          }
        )
        .subscribe();

      channelRef.current = channel;
    });

    return () => { if (channelRef.current) { supabase.removeChannel(channelRef.current); } };
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const switchWorkspace = (ws: Workspace) => {
    setActiveWorkspace(ws);
    setUserRole(ws.role);
    setWsMenuOpen(false);
    router.push("/dashboard");
  };

  const logout = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  const NavItem = ({ item }: { item: { label: string; href: string; icon: React.ElementType } }) => {
    const Icon   = item.icon;
    const active = pathname === item.href;
    return (
      <Link href={item.href} className={`nav-link ${active ? "active" : ""}`}>
        <span className="nav-link-icon"><Icon size={15} /></span>
        {item.label}
      </Link>
    );
  };

  return (
    <aside className={`sidebar${mobileOpen ? " open" : ""}`} aria-label="Main navigation">
      {onClose && (
        <button type="button" className="btn btn-ghost btn-sm sidebar-close" onClick={onClose} aria-label="Close menu">
          <X size={16} />
        </button>
      )}
      {/* Logo */}
      <div className="sidebar-logo" style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <Link href="/" aria-label="ClarityMeet home" style={{ display: "flex", alignItems: "center", gap: "10px", textDecoration: "none" }}>
          <div className="logo-mark">C</div>
          <div>
            <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "15px", color: "var(--text-primary)", letterSpacing: "-0.3px" }}>ClarityMeet</div>
            <div style={{ fontSize: "10px", color: "var(--text-disabled)", marginTop: "1px", letterSpacing: "0.04em" }}>MEETING INTELLIGENCE</div>
          </div>
        </Link>
      </div>

      {/* Workspace switcher */}
      {workspaces.length > 0 && (
        <div style={{ padding: "10px 12px 4px", position: "relative" }}>
          <button
            onClick={() => { setWsMenuOpen(!wsMenuOpen); setUserMenuOpen(false); setNotifOpen(false); }}
            style={{ width: "100%", display: "flex", alignItems: "center", gap: "8px", padding: "8px 10px", background: "var(--glass-white)", border: "1px solid var(--glass-border)", borderRadius: "var(--radius-sm)", cursor: "pointer", color: "var(--text-secondary)", fontSize: "12px", fontWeight: 500 }}
          >
            <Building2 size={13} color="var(--text-muted)" />
            <span style={{ flex: 1, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{activeWorkspace?.name ?? "Select workspace"}</span>
            <ChevronDown size={12} style={{ transform: wsMenuOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s", flexShrink: 0 }} />
          </button>

          {wsMenuOpen && (
            <div style={{ position: "absolute", top: "calc(100% - 2px)", left: "12px", right: "12px", background: "var(--bg-elevated)", border: "1px solid var(--glass-strong)", borderRadius: "var(--radius-md)", overflow: "hidden", boxShadow: "0 16px 48px rgba(0,0,0,0.3)", zIndex: 200 }}>
              <div style={{ padding: "6px 10px 4px", fontSize: "10px", color: "var(--text-disabled)", letterSpacing: "0.06em", textTransform: "uppercase" }}>Your workspaces</div>
              {workspaces.map(ws => (
                <button
                  key={ws.workspace_id}
                  onClick={() => switchWorkspace(ws)}
                  style={{ width: "100%", display: "flex", alignItems: "center", gap: "8px", padding: "9px 10px", background: ws.workspace_id === activeWorkspace?.workspace_id ? "var(--glass-white)" : "none", border: "none", cursor: "pointer", color: ws.workspace_id === activeWorkspace?.workspace_id ? "var(--text-primary)" : "var(--text-secondary)", fontSize: "13px", textAlign: "left" }}
                >
                  <div style={{ width: "22px", height: "22px", borderRadius: "6px", background: "var(--grad-neural)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", fontWeight: 700, color: "white", flexShrink: 0 }}>{ws.name[0]?.toUpperCase()}</div>
                  <div style={{ flex: 1, overflow: "hidden" }}>
                    <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ws.name}</div>
                    <div style={{ fontSize: "10px", color: "var(--text-disabled)", textTransform: "capitalize" }}>{ws.role}</div>
                  </div>
                  {ws.workspace_id === activeWorkspace?.workspace_id && <CheckCheck size={13} color="var(--emerald-pulse)" />}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Quick start CTA */}
      <div style={{ padding: "10px 16px 8px" }}>
        <button className="btn btn-primary" style={{ width: "100%", justifyContent: "center", fontSize: "13px" }} onClick={() => router.push("/bot")}>
          <Zap size={13} /> Start Bot
        </button>
      </div>

      {/* Main nav */}
      <div style={{ flex: 1, overflowY: "auto", padding: "4px 0 8px" }}>
        <div className="sidebar-section-label">Navigation</div>
        {NAV_MAIN.map((item) => <NavItem key={item.href} item={item} />)}
        <div className="divider" style={{ margin: "12px 16px" }} />
        <div className="sidebar-section-label">Tools</div>
        {NAV_TOOLS.map((item) => <NavItem key={item.href} item={item} />)}
      </div>

      {/* Bottom */}
      <div style={{ borderTop: "1px solid var(--glass-border)", padding: "8px" }}>

        {/* Notifications bell */}
        <div style={{ position: "relative", marginBottom: "2px" }}>
          <button
            className="nav-link"
            style={{ width: "100%", justifyContent: "space-between" }}
            onClick={() => {
              setNotifOpen(!notifOpen);
              setUserMenuOpen(false);
              setWsMenuOpen(false);
              if (!notifOpen) {
                setUnread(0);
                setNotifications(prev => prev.map(n => ({ ...n, read: true })));
                // Mark all as read in DB
                getCurrentUser().then((user) => {
                  if (!user) return;
                  supabase.from("notifications")
                    .update({ read: true })
                    .eq("user_id", user.id)
                    .eq("read", false);
                  // Also persist locally as fallback
                  const ids = new Set(notifications.map(n => n.id));
                  saveReadIds(ids);
                });
              }
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span className="nav-link-icon"><Bell size={15} /></span>
              Notifications
            </div>
            {unread > 0 && (
              <div style={{ minWidth: "18px", height: "18px", borderRadius: "9px", background: "var(--crimson, #ef4444)", color: "white", fontSize: "10px", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 5px" }}>{unread}</div>
            )}
          </button>

          {notifOpen && (
            <div style={{ position: "absolute", bottom: "calc(100% + 6px)", left: 0, right: 0, background: "var(--bg-elevated)", border: "1px solid var(--glass-strong)", borderRadius: "var(--radius-md)", overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,0.3)", zIndex: 200 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px 6px" }}>
                <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-primary)" }}>Notifications</span>
                <button onClick={() => setNotifOpen(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", display: "flex" }}><X size={13} /></button>
              </div>
              {notifications.length === 0 ? (
                <div style={{ padding: "16px 12px", fontSize: "13px", color: "var(--text-muted)", textAlign: "center" }}>No new notifications</div>
              ) : (
                notifications.map(n => (
                  <div key={n.id} onClick={() => { if (n.link) { setNotifOpen(false); router.push(n.link); } }}
                    style={{ padding: "10px 12px", borderTop: "1px solid var(--glass-border)", fontSize: "13px", cursor: n.link ? "pointer" : "default" }}>
                    <div style={{ color: n.type === "warning" || n.type === "error" ? "var(--crimson)" : "var(--text-primary)", fontWeight: 600, marginBottom: "2px" }}>{n.title}</div>
                    {n.body && <div style={{ color: "var(--text-secondary)", marginBottom: "3px", lineHeight: 1.45 }}>{n.body}</div>}
                    <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>{timeAgo(n.created_at)}</div>
                  </div>
                ))
              )}
              {typeof window !== "undefined" && "Notification" in window && window.Notification.permission === "default" && (
                <button onClick={() => { window.Notification.requestPermission().catch(() => {}); }}
                  style={{ width: "100%", padding: "9px 12px", borderTop: "1px solid var(--glass-border)", background: "none", border: "none", cursor: "pointer", fontSize: "12px", color: "var(--electric-teal)", fontWeight: 600, textAlign: "left" }}>
                  Turn on desktop alerts
                </button>
              )}
            </div>
          )}
        </div>

        <div className="nav-link" style={{ width: "100%", marginBottom: "2px", justifyContent: "space-between", cursor: "default" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span className="nav-link-icon">{theme === "dark" ? <Moon size={15} /> : <Sun size={15} />}</span>
            {theme === "dark" ? "Dark mode" : "Light mode"}
          </div>
          <ThemeSwitch />
        </div>


        {/* User menu */}
        <div style={{ position: "relative" }}>
          <button className="nav-link" style={{ width: "100%", justifyContent: "space-between" }} onClick={() => { setUserMenuOpen(!userMenuOpen); setWsMenuOpen(false); setNotifOpen(false); }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <div className="avatar avatar-sm">{userInitials}</div>
              <div style={{ textAlign: "left" }}>
                <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-primary)" }}>{userName}</div>
                <div style={{ fontSize: "10px", color: "var(--text-disabled)", textTransform: "capitalize" }}>{userRole}</div>
              </div>
            </div>
            <ChevronDown size={13} color="var(--text-muted)" style={{ transform: userMenuOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
          </button>

          {userMenuOpen && (
            <div style={{ position: "absolute", bottom: "calc(100% + 6px)", left: 0, right: 0, background: "var(--bg-elevated)", border: "1px solid var(--glass-strong)", borderRadius: "var(--radius-md)", overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,0.3)", zIndex: 200, backdropFilter: "blur(20px)" }}>
              {[
                { icon: UserCircle, label: "Profile",          href: "/profile" },
                { icon: Settings,   label: "Account Settings", href: "/settings" },
              ].map(({ icon: Icon, label, href }) => (
                <Link key={label} href={href} onClick={() => setUserMenuOpen(false)} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "11px 14px", color: "var(--text-secondary)", textDecoration: "none", fontSize: "13px", transition: "all 150ms" }} onMouseEnter={(e) => { e.currentTarget.style.background = "var(--glass-white)"; e.currentTarget.style.color = "var(--text-primary)"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-secondary)"; }}>
                  <Icon size={14} />{label}
                </Link>
              ))}
              <div className="divider" style={{ margin: "4px 0" }} />
              <button onClick={logout} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "11px 14px", color: "var(--crimson)", background: "none", border: "none", width: "100%", textAlign: "left", fontSize: "13px", cursor: "pointer", transition: "all 150ms" }} onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(239,68,68,0.08)"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
                <LogOut size={14} /> Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}