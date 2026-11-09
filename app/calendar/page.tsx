"use client";
export const dynamic = 'force-dynamic';


import { useState, useEffect, useCallback } from "react";
import { useRouter }  from "next/navigation";
import Link from "next/link";
import {
  CalendarDays, Video, Clock, Users, ChevronLeft, ChevronRight,
  Plus, RefreshCw, X, Check, AlertCircle, Link2, Trash2, Wifi,
  Smartphone, Monitor, Upload, Globe,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { supabase }  from "@/lib/supabase";
import { getCurrentUser } from "@/lib/current-user";
import { getFirstWorkspaceId } from "@/lib/workspace";
import { authFetch } from "@/lib/auth-fetch";
import { useWorkspace } from "@/app/components/WorkspaceContext";
import type { Database } from "@/lib/database.types";
import { GOOGLE_CLIENT_ID, getGoogleToken, cachedGoogleToken, clearGoogleToken } from "@/lib/google-calendar";

const GOOGLE_FLAG = "cm_gcal_connected";
function googleRemembered() { try { return localStorage.getItem(GOOGLE_FLAG) === "1"; } catch { return false; } }
function rememberGoogle(on: boolean) { try { if (on) localStorage.setItem(GOOGLE_FLAG, "1"); else localStorage.removeItem(GOOGLE_FLAG); } catch { /* ignore */ } }

// Constants
const HOURS  = ["08:00","09:00","10:00","11:00","12:00","13:00","14:00","15:00","16:00","17:00","18:00"];
const DAYS   = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
const COLORS = ["#0EA5E9","#10B981","#A78BFA","#F59E0B","#EC4899","#14B8A6","#F97316"];

type ViewMode = "week" | "month" | "list";
type Platform = "zoom" | "google_meet" | "teams" | "webex" | "upload" | "other";

const PLATFORM_ICONS: Record<Platform, JSX.Element> = {
  zoom: <Video size={14} />,
  google_meet: <Monitor size={14} />,
  teams: <Users size={14} />,
  webex: <Globe size={14} />,
  upload: <Upload size={14} />,
  other: <Link2 size={14} />,
};
const PLATFORM_COLORS: Record<Platform, string> = {
  zoom: "#2D8CFF", google_meet: "#34A853", teams: "#6264A7", webex: "#00B0C3", upload: "#A78BFA", other: "#6B7280",
};

function strColor(s: string) {
  return COLORS[s.split("").reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length];
}
function toDateStr(iso: string) { return iso.slice(0, 10); }
function fmtDuration(secs: number | null) {
  if (!secs) return "-";
  const m = Math.round(secs / 60);
  return m >= 60 ? `${Math.floor(m/60)}h ${m%60}m` : `${m}m`;
}
function weekStart(anchor: Date) {
  const d = new Date(anchor);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday
  d.setHours(0, 0, 0, 0);
  return d;
}
function getWeekDays(anchor: Date) {
  const mon = weekStart(anchor);
  const todayStr = toDateStr(new Date().toISOString());
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(mon);
    d.setDate(mon.getDate() + i);
    const ds = toDateStr(d.toISOString());
    return {
      label: DAYS[i],
      date: d.toLocaleDateString("en-AU", { day: "numeric", month: "short" }),
      dateStr: ds,
      isToday: ds === todayStr,
    };
  });
}

// Calendar feed type
type FeedProvider = "google" | "icloud" | "outlook" | "other";
interface CalFeed {
  id:          string;
  name:        string;
  feed_url:    string;
  provider:    FeedProvider;
  last_synced: string | null;
  event_count: number | null;
}

// Add Feed Modal
const PROVIDER_HELP: Record<FeedProvider, { label: string; icon: JSX.Element; steps: string }> = {
  google: {
    label: "Google Calendar",
    icon: <CalendarDays size={18} />,
    steps: "Google Calendar > Settings > [your calendar] > 'Secret address in iCal format' > copy the URL.",
  },
  icloud: {
    label: "iPhone / iCloud",
    icon: <Smartphone size={18} />,
    steps: "iPhone: Calendar app > Calendars > tap the (i) next to the calendar > turn on Public Calendar > Share Link > copy. Or iCloud.com > Calendar > share icon > Public Calendar > copy the link.",
  },
  outlook: {
    label: "Outlook / Microsoft 365",
    icon: <Monitor size={18} />,
    steps: "Outlook on the web > Settings > Calendar > Shared calendars > Publish a calendar > choose calendar and 'Can view all details' > Publish > copy the ICS link.",
  },
  other: {
    label: "Other (.ics feed URL)",
    icon: <Link2 size={18} />,
    steps: "Paste any publicly accessible .ics or webcal:// feed URL.",
  },
};

const FEED_ICONS: Record<FeedProvider, JSX.Element> = {
  google: <CalendarDays size={16} />,
  icloud: <Smartphone size={16} />,
  outlook: <Monitor size={16} />,
  other: <Link2 size={16} />,
};

interface AddFeedModalProps {
  workspaceId: string;
  userId: string;
  onClose: () => void;
  onAdded: (feed: CalFeed) => void;
  onGoogle: () => Promise<void>;
}
function AddFeedModal({ workspaceId, userId, onClose, onAdded, onGoogle }: AddFeedModalProps) {
  const [gBusy, setGBusy] = useState(false);
  const [provider, setProvider] = useState<FeedProvider>("google");
  const [name,     setName]     = useState("");
  const [url,      setUrl]      = useState("");
  const [saving,   setSaving]   = useState(false);
  const [err,      setErr]      = useState("");

  const help = PROVIDER_HELP[provider];
  const handleSave = async () => {
    if (!url.trim()) { setErr("Paste your calendar feed URL"); return; }
    if (!name.trim()) { setErr("Give this calendar a name"); return; }
    setSaving(true);
    const { data, error } = await supabase.from("calendar_feeds").insert({
      user_id:      userId,
      workspace_id: workspaceId,
      name:         name.trim(),
      feed_url:     url.trim(),
      provider,
    }).select("*").single();
    setSaving(false);
    if (error) { setErr(error.message); return; }
    onAdded(data as CalFeed);
    onClose();
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 999, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }} onClick={onClose}>
      <motion.div initial={{ opacity: 0, scale: 0.95, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} className="liquid-card" style={{ width: "100%", maxWidth: "500px", padding: "30px" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "20px" }}>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: "17px", fontWeight: 800, color: "var(--text-primary)" }}>Connect Live Calendar</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}><X size={15} /></button>
        </div>

        {/* Provider selector */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "8px", marginBottom: "20px" }} className="rg-4">
          {(Object.keys(PROVIDER_HELP) as FeedProvider[]).map(p => (
            <button key={p} onClick={() => setProvider(p)}
              style={{ padding: "10px 6px", borderRadius: "var(--radius-sm)", border: `1px solid ${provider === p ? "#0EA5E9" : "var(--glass-border)"}`,
                background: provider === p ? "rgba(14,165,233,0.12)" : "var(--glass-surface)", cursor: "pointer",
                display: "flex", flexDirection: "column", alignItems: "center", gap: "4px", fontSize: "11px",
                fontWeight: provider === p ? 700 : 500, color: provider === p ? "#7DD3FC" : "var(--text-secondary)",
              }}>
              <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "28px", height: "28px" }}>{PROVIDER_HELP[p].icon}</span>
              {PROVIDER_HELP[p].label.split(" ")[0]}
            </button>
          ))}
        </div>

        {provider === "google" && GOOGLE_CLIENT_ID && (
          <div style={{ marginBottom: "18px" }}>
            <button className="btn btn-primary" style={{ width: "100%", justifyContent: "center" }} disabled={gBusy}
              onClick={async () => { setGBusy(true); setErr(""); try { await onGoogle(); onClose(); } catch (e) { setErr(e instanceof Error ? e.message : "Google sign-in failed"); } finally { setGBusy(false); } }}>
              {gBusy ? "Connecting..." : <><CalendarDays size={14} /> Sign in with Google</>}
            </button>
            <p style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "8px", textAlign: "center" }}>
              Imports your Google Calendar and lets you create Google Meet meetings. Or paste a secret iCal link below.
            </p>
          </div>
        )}

        {/* Instructions */}
        <div style={{ padding: "12px 14px", borderRadius: "var(--radius-sm)", background: "rgba(14,165,233,0.06)", border: "1px solid rgba(14,165,233,0.15)", marginBottom: "18px", fontSize: "12px", color: "var(--text-secondary)", lineHeight: 1.6 }}>
          <strong style={{ color: "var(--text-primary)", display: "inline-flex", alignItems: "center", gap: "8px" }}>{help.icon} How to get your {help.label} URL:</strong><br />
          {help.steps}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <div>
            <label className="form-label">Calendar name</label>
            <input className="form-input" placeholder={`e.g. My ${help.label}`} value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div>
            <label className="form-label">Feed URL (webcal:// or https://)</label>
            <input className="form-input" placeholder="https://calendar.google.com/calendar/ical/..." value={url} onChange={e => setUrl(e.target.value)} />
          </div>
          {err && <p style={{ fontSize: "12px", color: "var(--crimson)" }}>{err}</p>}
          <div style={{ display: "flex", gap: "10px" }}>
            <button className="btn btn-primary" onClick={handleSave} disabled={saving} style={{ flex: 1, justifyContent: "center" }}>
              {saving ? "Connecting..." : <><Link2 size={13} /> Connect calendar</>}
            </button>
            <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}


// Schedule Meeting Modal
interface ScheduleModalProps {
  workspaceId: string;
  userId: string;
  onClose: () => void;
  onCreated: () => void;
}
function ScheduleModal({ workspaceId, userId, onClose, onCreated }: ScheduleModalProps) {
  const [addToGoogle, setAddToGoogle] = useState(!!GOOGLE_CLIENT_ID && googleRemembered());
  const [title,    setTitle]    = useState("");
  const [platform, setPlatform] = useState<Platform>("zoom");
  const [meetUrl,  setMeetUrl]  = useState("");
  const [date,     setDate]     = useState(new Date().toISOString().slice(0, 10));
  const [time,     setTime]     = useState("09:00");
  const [saving,   setSaving]   = useState(false);
  const [err,      setErr]      = useState("");

  const handleSave = async () => {
    if (!title.trim()) { setErr("Title is required"); return; }
    setSaving(true);
    setErr("");
    const scheduledAt = new Date(`${date}T${time}:00`).toISOString();

    const wantsMeet = platform === "google_meet" && !meetUrl.trim();
    if (GOOGLE_CLIENT_ID && (addToGoogle || wantsMeet)) {
      try {
        const token = await getGoogleToken();
        const res = await authFetch("/api/calendar/google", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "create", accessToken: token, workspaceId, title: title.trim(), start: scheduledAt, addMeet: wantsMeet }),
        });
        const json = await res.json();
        if (!res.ok) { if (json.reconnect) clearGoogleToken(); throw new Error(json.error || "Could not add to Google Calendar"); }
        rememberGoogle(true);
        setSaving(false);
        onCreated();
        onClose();
        return;
      } catch (e) {
        setSaving(false);
        setErr(e instanceof Error ? e.message : "Could not add to Google Calendar");
        return;
      }
    }

    const { error } = await supabase.from("meetings").insert({
      workspace_id: workspaceId,
      owner_id:     userId,
      title:        title.trim(),
      platform,
      meeting_url:  meetUrl.trim() || null,
      status:       "scheduled",
      started_at:   scheduledAt,
    });
    setSaving(false);
    if (error) { setErr(error.message); return; }
    onCreated();
    onClose();
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 999, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }} onClick={onClose}>
      <motion.div initial={{ opacity: 0, scale: 0.95, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ duration: 0.2 }} className="liquid-card" style={{ width: "100%", maxWidth: "440px", padding: "30px" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "22px" }}>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: "17px", fontWeight: 800, color: "var(--text-primary)" }}>Schedule Meeting</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose} style={{ padding: "6px" }}><X size={15} /></button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <div>
            <label className="form-label">Title *</label>
            <input className="form-input" placeholder="e.g. Q2 Planning" value={title} onChange={e => setTitle(e.target.value)} autoFocus />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }} className="rg-2">
            <div>
              <label className="form-label">Date</label>
              <input type="date" className="form-input" value={date} onChange={e => setDate(e.target.value)} />
            </div>
            <div>
              <label className="form-label">Time</label>
              <input type="time" className="form-input" value={time} onChange={e => setTime(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="form-label">Platform</label>
            <select className="form-select" value={platform} onChange={e => setPlatform(e.target.value as Platform)}>
              <option value="zoom">Zoom</option>
              <option value="google_meet">Google Meet</option>
              <option value="teams">Microsoft Teams</option>
              <option value="webex">Webex</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <label className="form-label">Meeting link (optional)</label>
            <input className="form-input" placeholder={platform === "google_meet" && GOOGLE_CLIENT_ID ? "Leave empty to create a Google Meet link" : "https://zoom.us/j/..."} value={meetUrl} onChange={e => setMeetUrl(e.target.value)} />
          </div>
          {GOOGLE_CLIENT_ID && (
            <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "var(--text-secondary)", cursor: "pointer" }}>
              <input type="checkbox" checked={addToGoogle || (platform === "google_meet" && !meetUrl.trim())} disabled={platform === "google_meet" && !meetUrl.trim()} onChange={e => setAddToGoogle(e.target.checked)} />
              Also add to my Google Calendar
            </label>
          )}
          {err && <p style={{ fontSize: "12px", color: "var(--crimson)" }}>{err}</p>}
          <div style={{ display: "flex", gap: "10px", marginTop: "4px" }}>
            <button className="btn btn-primary" onClick={handleSave} disabled={saving} style={{ flex: 1, justifyContent: "center" }}>
              {saving ? "Saving..." : <><Check size={13} /> Save meeting</>}
            </button>
            <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function SubscribeModal({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const [links, setLinks] = useState<{ https: string; webcal: string } | null>(null);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    authFetch("/api/calendar/feed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId }),
    }).then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error || "Could not create link"); setLinks(j); })
      .catch(e => setErr(e instanceof Error ? e.message : "Could not create link"));
  }, [workspaceId]);

  const copy = async () => {
    if (!links) return;
    try { await navigator.clipboard.writeText(links.https); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* ignore */ }
  };

  const steps = [
    { icon: <Smartphone size={15} />, name: "iPhone", text: "Open this page on your iPhone and tap Add to iPhone. Or go to Settings > Apps > Calendar > Calendar Accounts > Add Account > Other > Add Subscribed Calendar and paste the link." },
    { icon: <CalendarDays size={15} />, name: "Google Calendar", text: "Other calendars > + > From URL, paste the link. Shows on any phone signed in to that Google account." },
    { icon: <Monitor size={15} />, name: "Outlook", text: "Add calendar > Subscribe from web, paste the link." },
  ];

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 999, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }} onClick={onClose}>
      <motion.div initial={{ opacity: 0, scale: 0.95, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} className="liquid-card" style={{ width: "100%", maxWidth: "520px", padding: "30px" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "14px" }}>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: "17px", fontWeight: 800, color: "var(--text-primary)" }}>Show meetings on your phone</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}><X size={15} /></button>
        </div>
        <p style={{ fontSize: "13px", color: "var(--text-secondary)", marginBottom: "16px", lineHeight: 1.6 }}>
          Subscribe to this link and every ClarityMeet meeting in this workspace appears in your calendar app, with the join link and a link to the summary. It updates by itself.
        </p>
        {err && <p style={{ fontSize: "12px", color: "var(--crimson)", marginBottom: "12px" }}>{err}</p>}
        <div style={{ display: "flex", gap: "8px", marginBottom: "18px" }}>
          <input className="form-input" readOnly value={links?.https ?? "Creating link..."} onFocus={e => e.target.select()} style={{ fontSize: "12px" }} />
          <button className="btn btn-secondary btn-sm" onClick={copy} disabled={!links}>{copied ? <><Check size={13} /> Copied</> : "Copy"}</button>
        </div>
        {links && (
          <a className="btn btn-primary" href={links.webcal} style={{ width: "100%", justifyContent: "center", marginBottom: "18px" }}>
            <Smartphone size={14} /> Add to iPhone / Mac Calendar
          </a>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {steps.map(s => (
            <div key={s.name} style={{ display: "flex", gap: "10px", fontSize: "12px", color: "var(--text-secondary)", lineHeight: 1.6 }}>
              <span style={{ marginTop: "2px", color: "var(--text-primary)" }}>{s.icon}</span>
              <span><strong style={{ color: "var(--text-primary)" }}>{s.name}:</strong> {s.text}</span>
            </div>
          ))}
        </div>
        <p style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "16px" }}>Keep this link private. Anyone with it can see this workspace&apos;s meeting times.</p>
      </motion.div>
    </div>
  );
}

// Main Page
type CalMeeting = Database["public"]["Views"]["meetings_summary"]["Row"] & { color: string; platform: Platform; meeting_url?: string | null };

export default function CalendarPage() {
  const router = useRouter();
  const { activeWorkspace } = useWorkspace();
  const [view,       setView]       = useState<ViewMode>("month");
  const [meetings,   setMeetings]   = useState<CalMeeting[]>([]);
  const [anchor,     setAnchor]     = useState(new Date());
  const [selected,   setSelected]   = useState<CalMeeting | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [wsId,       setWsId]       = useState<string | null>(null);
  const [userId,     setUserId]     = useState<string | null>(null);
  const [showModal,   setShowModal]   = useState(false);
  const [showAddFeed,  setShowAddFeed]  = useState(false);
  const [feeds,        setFeeds]        = useState<CalFeed[]>([]);
  const [syncing,      setSyncing]      = useState<string | null>(null);
  const [syncMsg,      setSyncMsg]      = useState<{ ok: boolean; text: string } | null>(null);
  const [showSubscribe, setShowSubscribe] = useState(false);
  const [googleOn,     setGoogleOn]     = useState(false);
  const [gSyncing,     setGSyncing]     = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const user = await getCurrentUser();
    if (!user) { router.push("/login"); return; }
    setUserId(user.id);
    const wsId = activeWorkspace?.workspace_id ??
      (await getFirstWorkspaceId(user.id));
    if (!wsId) { setLoading(false); return; }
    setWsId(wsId);
    const { data } = await supabase
      .from("meetings_summary")
      .select("*")
      .eq("workspace_id", wsId)
      .order("started_at", { ascending: false })
      .limit(200);
    const mapped: CalMeeting[] = (data ?? []).map(m => {
      const row = m as Database["public"]["Views"]["meetings_summary"]["Row"];
      return {
        ...row,
        color:    strColor(row.id ?? ""),
        platform: (row.platform as Platform) ?? "other",
      };
    });
    setMeetings(mapped);
    setLoading(false);
  }, [router, activeWorkspace]);

  useEffect(() => { load(); }, [load, activeWorkspace]);

  // Load calendar feeds
  const loadFeeds = useCallback(async (uid: string) => {
    const { data } = await supabase
      .from("calendar_feeds")
      .select("*")
      .eq("user_id", uid)
      .order("created_at", { ascending: true });
    setFeeds((data ?? []) as CalFeed[]);
  }, []);

  useEffect(() => { if (userId) loadFeeds(userId); }, [userId, loadFeeds]);

  // Sync a feed (calls server-side /api/calendar/sync)
  const handleSync = async (feed: CalFeed, silent = false) => {
    if (!wsId || !userId) return;
    setSyncing(feed.id);
    if (!silent) setSyncMsg(null);
    try {
      const res  = await authFetch("/api/calendar/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedId: feed.id, feedUrl: feed.feed_url, workspaceId: wsId, userId }),
      });
      const json = await res.json();
      if (!res.ok) {
        if (!silent) setSyncMsg({ ok: false, text: json.error || "Sync failed" });
      } else {
        if (!silent || json.inserted || json.updated) {
          setSyncMsg({ ok: true, text: `Synced "${feed.name}": ${json.inserted} new, ${json.updated ?? 0} updated` });
        }
        await load();
        if (userId) loadFeeds(userId);
      }
    } catch (e: unknown) {
      if (!silent) setSyncMsg({ ok: false, text: e instanceof Error ? e.message : "Network error" });
    } finally {
      setSyncing(null);
    }
  };

  const importGoogle = useCallback(async (opts: { prompt?: boolean; silent?: boolean } = {}) => {
    if (!wsId) return;
    setGSyncing(true);
    try {
      const token = opts.silent ? cachedGoogleToken() : await getGoogleToken(!!opts.prompt);
      if (!token) return;
      const res = await authFetch("/api/calendar/google", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "import", accessToken: token, workspaceId: wsId }),
      });
      const json = await res.json();
      if (!res.ok) {
        if (json.reconnect) clearGoogleToken();
        throw new Error(json.error || "Google Calendar sync failed");
      }
      rememberGoogle(true);
      setGoogleOn(true);
      if (!opts.silent || json.inserted || json.updated) {
        setSyncMsg({ ok: true, text: `Google Calendar: ${json.inserted} new, ${json.updated} updated` });
      }
      await load();
    } catch (e) {
      if (!opts.silent) throw e;
    } finally {
      setGSyncing(false);
    }
  }, [wsId, load]);

  useEffect(() => { setGoogleOn(!!GOOGLE_CLIENT_ID && googleRemembered()); }, []);

  const [autoSynced, setAutoSynced] = useState(false);
  useEffect(() => {
    if (autoSynced || !wsId || !userId) return;
    setAutoSynced(true);
    const stale = (f: CalFeed) => !f.last_synced || Date.now() - new Date(f.last_synced).getTime() > 15 * 60 * 1000;
    (async () => {
      for (const f of feeds.filter(stale)) await handleSync(f, true);
      if (googleRemembered()) await importGoogle({ silent: true });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsId, userId, feeds]);

  const disconnectGoogle = () => { clearGoogleToken(); rememberGoogle(false); setGoogleOn(false); };

  // Delete a feed
  const handleDeleteFeed = async (feedId: string) => {
    await supabase.from("calendar_feeds").delete().eq("id", feedId);
    setFeeds(f => f.filter(x => x.id !== feedId));
  };

  // Week view data
  const weekDays = getWeekDays(anchor);
  const weekMeetings = (date: string) =>
    meetings.filter(m => m.started_at && toDateStr(m.started_at) === date);

  const prevWeek = () => { const d = new Date(anchor); d.setDate(d.getDate() - 7); setAnchor(d); };
  const nextWeek = () => { const d = new Date(anchor); d.setDate(d.getDate() + 7); setAnchor(d); };

  const platformIcon = (p: Platform) => PLATFORM_ICONS[p] ?? <Link2 size={13} />;
  const platformColor = (p: Platform) => PLATFORM_COLORS[p] ?? "#6B7280";

  // Meeting detail panel
  const MeetingCard = ({ m }: { m: CalMeeting }) => (
    <motion.div
      initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
      style={{
        padding: "10px 12px", borderRadius: "var(--radius-sm)", cursor: "pointer",
        background: `${platformColor(m.platform)}18`,
        border: `1px solid ${platformColor(m.platform)}35`,
        marginBottom: "5px",
      }}
      onClick={() => setSelected(m)}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "2px" }}>
        <span style={{ fontSize: "13px" }}>{platformIcon(m.platform)}</span>
        <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
          {m.title || "Untitled meeting"}
        </span>
      </div>
      <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>
        {m.started_at ? new Date(m.started_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}
        {m.duration_secs ? ` · ${fmtDuration(m.duration_secs)}` : ""}
      </div>
    </motion.div>
  );

  return (
    <>
      <div style={{ paddingBottom: "48px" }} className="page-enter">
        <div className="page-header">
          <div>
            <div className="page-header-title">Calendar</div>
            <div className="page-header-sub">{meetings.length} meetings · {feeds.length} connected calendar{feeds.length !== 1 ? "s" : ""}</div>
          </div>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            {/* View toggle */}
            {(["week","month","list"] as ViewMode[]).map(v => (
              <button key={v} className={`btn btn-sm ${view === v ? "btn-primary" : "btn-secondary"}`} onClick={() => setView(v)} style={{ textTransform: "capitalize" }}>{v}</button>
            ))}
            <div style={{ width: "1px", background: "var(--glass-border)", margin: "0 4px" }} />
            {/* Connect Live Calendar */}
            <button className="btn btn-secondary btn-sm" onClick={() => setShowAddFeed(true)} disabled={!wsId || !userId} title="Connect Google Calendar, iPhone iCloud, or Outlook for live sync">
              <Wifi size={13} /> Connect calendar
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => setShowSubscribe(true)} disabled={!wsId} title="Show ClarityMeet meetings in your phone's calendar">
              <Smartphone size={13} /> Add to phone
            </button>
            {/* Schedule meeting */}
            <button className="btn btn-primary btn-sm" onClick={() => setShowModal(true)} disabled={!wsId || !userId}>
              <Plus size={13} /> New meeting
            </button>
          </div>
        </div>

        {/* Sync status banner */}
        <AnimatePresence>
          {syncMsg && (
            <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
              style={{ margin: "16px 36px 0", padding: "12px 18px", borderRadius: "var(--radius-md)", display: "flex", alignItems: "center", gap: "10px",
                background: syncMsg.ok ? "rgba(16,185,129,0.08)" : "rgba(239,68,68,0.08)",
                border: `1px solid ${syncMsg.ok ? "rgba(16,185,129,0.25)" : "rgba(239,68,68,0.25)"}`,
              }}>
              {syncMsg.ok ? <Check size={15} color="var(--emerald-pulse)" /> : <AlertCircle size={15} color="var(--crimson)" />}
              <span style={{ fontSize: "13px", color: syncMsg.ok ? "#6EE7B7" : "#FCA5A5" }}>{syncMsg.text}</span>
              <button onClick={() => setSyncMsg(null)} style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}><X size={14} /></button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Connected calendars panel */}
        {(feeds.length > 0 || googleOn) && (
          <div style={{ margin: "16px 36px 0", padding: "14px 18px", borderRadius: "var(--radius-md)", background: "var(--glass-surface)", border: "1px solid var(--glass-border)" }}>
            <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: "10px" }}>Connected Calendars</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {googleOn && (
                <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "8px 12px", borderRadius: "var(--radius-sm)", background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "18px", height: "18px" }}><CalendarDays size={16} /></span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-primary)" }}>Google Calendar</div>
                    <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>Signed in with Google · events and Google Meet links</div>
                  </div>
                  <button className="btn btn-ghost btn-sm" onClick={() => importGoogle().catch(e => setSyncMsg({ ok: false, text: e instanceof Error ? e.message : "Google Calendar sync failed" }))} disabled={gSyncing} title="Sync now" style={{ fontSize: "11px" }}>
                    <RefreshCw size={12} style={gSyncing ? { animation: "spin 0.8s linear infinite" } : {}} />
                    {gSyncing ? "Syncing..." : "Sync"}
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={disconnectGoogle} title="Disconnect" style={{ color: "var(--crimson)", padding: "5px" }}>
                    <Trash2 size={12} />
                  </button>
                </div>
              )}
              {feeds.map(feed => (
                <div key={feed.id} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "8px 12px", borderRadius: "var(--radius-sm)", background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "18px", height: "18px" }}>{FEED_ICONS[feed.provider]}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-primary)" }}>{feed.name}</div>
                    <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                      {feed.last_synced ? `Last synced ${new Date(feed.last_synced).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : "Never synced"}
                      {feed.event_count ? ` · ${feed.event_count} events` : ""}
                    </div>
                  </div>
                  <button className="btn btn-ghost btn-sm" onClick={() => handleSync(feed)} disabled={syncing === feed.id} title="Sync now" style={{ fontSize: "11px" }}>
                    <RefreshCw size={12} style={syncing === feed.id ? { animation: "spin 0.8s linear infinite" } : {}} />
                    {syncing === feed.id ? "Syncing..." : "Sync"}
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => handleDeleteFeed(feed.id)} title="Remove" style={{ color: "var(--crimson)", padding: "5px" }}>
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ padding: "24px 36px" }} className="page-body">
          {loading ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "40vh" }}>
              <div style={{ width: "32px", height: "32px", border: "3px solid var(--glass-border)", borderTopColor: "#0EA5E9", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
            </div>
          ) : (
            <>
              {/* WEEK VIEW */}
              {view === "week" && (
                <div>
                  {/* Week nav */}
                  <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px" }}>
                    <button className="btn btn-ghost btn-sm" onClick={prevWeek}><ChevronLeft size={15} /></button>
                    <span style={{ fontFamily: "var(--font-display)", fontSize: "15px", fontWeight: 700, color: "var(--text-primary)" }}>
                      {weekDays[0].date} - {weekDays[6].date}
                    </span>
                    <button className="btn btn-ghost btn-sm" onClick={nextWeek}><ChevronRight size={15} /></button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setAnchor(new Date())}>Today</button>
                  </div>

                  {/* Week grid */}
                  <div className="data-card">
                    {/* Day headers */}
                    <div style={{ display: "grid", gridTemplateColumns: "60px repeat(7, minmax(0, 1fr))", borderBottom: "1px solid var(--glass-border)" }}>
                      <div />
                      {weekDays.map(d => (
                        <div key={d.dateStr} style={{ padding: "12px 8px", textAlign: "center", borderLeft: "1px solid var(--glass-border)" }}>
                          <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{d.label}</div>
                          <div style={{
                            width: "28px", height: "28px", borderRadius: "50%", margin: "4px auto 0",
                            background: d.isToday ? "var(--grad-neural)" : "transparent",
                            display: "flex", alignItems: "center", justifyContent: "center",
                          }}>
                            <span style={{ fontSize: "13px", fontWeight: d.isToday ? 800 : 500, color: d.isToday ? "white" : "var(--text-primary)" }}>
                              {d.date.split(" ")[0]}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Time slots */}
                    {HOURS.map(hour => (
                      <div key={hour} style={{ display: "grid", gridTemplateColumns: "60px repeat(7, minmax(0, 1fr))", borderBottom: "1px solid var(--glass-border)", minHeight: "80px" }}>
                        <div style={{ padding: "8px 10px", fontSize: "11px", color: "var(--text-disabled)", fontFamily: "var(--font-mono)", paddingTop: "10px" }}>{hour}</div>
                        {weekDays.map(d => {
                          const dayMeetings = weekMeetings(d.dateStr).filter(m => {
                            if (!m.started_at) return false;
                            const h = new Date(m.started_at).getHours();
                            const hStr = `${String(h).padStart(2,"0")}:00`;
                            return hStr === hour || (h < 7 && hour === "07:00") || (h >= 22 && hour === "22:00");
                          });
                          return (
                            <div key={d.dateStr} style={{ borderLeft: "1px solid var(--glass-border)", padding: "4px", minWidth: 0, overflow: "hidden", background: d.isToday ? "rgba(14,165,233,0.03)" : "transparent" }}>
                              {dayMeetings.map(m => <MeetingCard key={m.id} m={m} />)}
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* LIST VIEW */}
              {view === "list" && (
                <div className="data-card">
                  <table className="data-table">
                    <thead>
                      <tr><th>Meeting</th><th>Platform</th><th>Date & time</th><th>Duration</th><th>Participants</th><th>Status</th><th></th></tr>
                    </thead>
                    <tbody>
                      {meetings.slice(0, 100).map((m, i) => (
                        <motion.tr key={m.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.025 }} style={{ cursor: "pointer" }} onClick={() => setSelected(m)}>
                          <td>
                            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                              <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: platformColor(m.platform), flexShrink: 0 }} />
                              <span style={{ fontWeight: 500, color: "var(--text-primary)" }}>{m.title || "Untitled meeting"}</span>
                            </div>
                          </td>
                          <td>
                            <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px" }}>
                              {platformIcon(m.platform)}
                              <span style={{ color: "var(--text-secondary)" }}>{m.platform?.replace("_", " ")}</span>
                            </span>
                          </td>
                          <td style={{ fontSize: "13px" }}>{m.started_at ? new Date(m.started_at).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "-"}</td>
                          <td style={{ fontSize: "13px" }}>{fmtDuration(m.duration_secs)}</td>
                          <td style={{ fontSize: "13px" }}>{m.participant_count || "-"}</td>
                          <td>
                            <span className={`badge ${m.status === "complete" ? "badge-green" : m.status === "recording" ? "badge-red" : m.status === "scheduled" ? "badge-blue" : "badge-muted"}`}>
                              {m.status}
                            </span>
                          </td>
                          <td>
                            {m.meeting_url && (
                              <a href={`/bot?url=${encodeURIComponent(m.meeting_url)}`} className="btn btn-ghost btn-sm" style={{ textDecoration: "none", fontSize: "11px" }}>
                                <Video size={11} /> Bot
                              </a>
                            )}
                          </td>
                        </motion.tr>
                      ))}
                      {meetings.length === 0 && (
                        <tr><td colSpan={7} style={{ textAlign: "center", padding: "48px", color: "var(--text-muted)" }}>
                          No meetings in your workspace yet. Connect a calendar above and click Sync, or schedule a meeting.
                        </td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {/* MONTH VIEW */}
              {view === "month" && (
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px" }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => { const d = new Date(anchor); d.setMonth(d.getMonth()-1); setAnchor(d); }}><ChevronLeft size={15} /></button>
                    <span style={{ fontFamily: "var(--font-display)", fontSize: "15px", fontWeight: 700, color: "var(--text-primary)" }}>
                      {anchor.toLocaleDateString("en-AU", { month: "long", year: "numeric" })}
                    </span>
                    <button className="btn btn-ghost btn-sm" onClick={() => { const d = new Date(anchor); d.setMonth(d.getMonth()+1); setAnchor(d); }}><ChevronRight size={15} /></button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setAnchor(new Date())}>Today</button>
                  </div>

                  {/* Month grid */}
                  <div className="data-card">
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", borderBottom: "1px solid var(--glass-border)" }}>
                      {DAYS.map(d => (
                        <div key={d} style={{ padding: "10px", textAlign: "center", fontSize: "11px", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", borderLeft: "1px solid var(--glass-border)" }}>{d}</div>
                      ))}
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))" }}>
                      {(() => {
                        const y = anchor.getFullYear(), mo = anchor.getMonth();
                        const firstDay = new Date(y, mo, 1).getDay();
                        const offset = (firstDay + 6) % 7; // Mon start
                        const daysInMonth = new Date(y, mo + 1, 0).getDate();
                        const todayStr = toDateStr(new Date().toISOString());
                        return Array.from({ length: offset + daysInMonth }).map((_, i) => {
                          if (i < offset) return <div key={`pad-${i}`} style={{ borderLeft: "1px solid var(--glass-border)", minHeight: "80px" }} />;
                          const day = i - offset + 1;
                          const dateStr = `${y}-${String(mo+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
                          const dayMeetings = meetings.filter(m => m.started_at && toDateStr(m.started_at) === dateStr);
                          const isToday = dateStr === todayStr;
                          return (
                            <div key={dateStr} style={{ borderLeft: "1px solid var(--glass-border)", borderTop: "1px solid var(--glass-border)", minHeight: "80px", padding: "6px", minWidth: 0, overflow: "hidden", background: isToday ? "rgba(14,165,233,0.04)" : "transparent" }}>
                              <div style={{ fontWeight: isToday ? 800 : 400, fontSize: "12px", color: isToday ? "#7DD3FC" : "var(--text-muted)", marginBottom: "4px" }}>{day}</div>
                              {dayMeetings.slice(0, 3).map(m => (
                                <div key={m.id} title={m.title || "Meeting"} onClick={() => setSelected(m)} style={{ fontSize: "10px", fontWeight: 600, color: "white", background: platformColor(m.platform), borderRadius: "4px", padding: "2px 5px", marginBottom: "2px", cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>
                                  {m.title || "Meeting"}
                                </div>
                              ))}
                              {dayMeetings.length > 3 && <div style={{ fontSize: "10px", color: "var(--text-muted)" }}>+{dayMeetings.length - 3} more</div>}
                            </div>
                          );
                        });
                      })()}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Meeting detail modal */}
      <AnimatePresence>
        {selected && (
          <div style={{ position: "fixed", inset: 0, zIndex: 900, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }} onClick={() => setSelected(null)}>
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="liquid-card" style={{ width: "100%", maxWidth: "420px", padding: "28px" }} onClick={e => e.stopPropagation()}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "20px" }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                    <span style={{ fontSize: "18px" }}>{platformIcon(selected.platform)}</span>
                    <h2 style={{ fontFamily: "var(--font-display)", fontSize: "18px", fontWeight: 800, color: "var(--text-primary)" }}>{selected.title || "Untitled meeting"}</h2>
                  </div>
                  <span className={`badge ${selected.status === "complete" ? "badge-green" : selected.status === "recording" ? "badge-red" : "badge-muted"}`}>{selected.status}</span>
                </div>
                <button className="btn btn-ghost btn-sm" onClick={() => setSelected(null)} style={{ padding: "6px" }}><X size={15} /></button>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginBottom: "24px" }}>
                {[
                  { icon: <CalendarDays size={13} />, label: "Date", value: selected.started_at ? new Date(selected.started_at).toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : "-" },
                  { icon: <Clock size={13} />, label: "Time", value: selected.started_at ? new Date(selected.started_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "-" },
                  { icon: <Clock size={13} />, label: "Duration", value: fmtDuration(selected.duration_secs) },
                  { icon: <Users size={13} />, label: "Participants", value: String(selected.participant_count || 0) },
                ].map(row => (
                  <div key={row.label} style={{ display: "flex", gap: "12px", alignItems: "center" }}>
                    <span style={{ color: "var(--text-muted)", flexShrink: 0 }}>{row.icon}</span>
                    <span style={{ fontSize: "12px", color: "var(--text-muted)", width: "80px", flexShrink: 0 }}>{row.label}</span>
                    <span style={{ fontSize: "13px", color: "var(--text-primary)" }}>{row.value}</span>
                  </div>
                ))}
              </div>

              <div style={{ display: "flex", gap: "10px" }}>
                {selected.meeting_url && (
                  <Link
                    href={`/bot?url=${encodeURIComponent(selected.meeting_url)}`}
                    className="btn btn-primary"
                    style={{ flex: 1, justifyContent: "center", textDecoration: "none" }}
                  >
                    <Video size={13} /> Join with Bot
                  </Link>
                )}
                <Link href={`/meeting-summary?id=${selected.id}`} className="btn btn-secondary" style={{ flex: 1, justifyContent: "center", textDecoration: "none" }}>
                  View summary
                </Link>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Schedule modal */}
      <AnimatePresence>
        {showModal && wsId && userId && (
          <ScheduleModal
            workspaceId={wsId}
            userId={userId}
            onClose={() => setShowModal(false)}
            onCreated={() => { load(); }}
          />
        )}
      </AnimatePresence>

      {/* Add Feed modal */}
      <AnimatePresence>
        {showAddFeed && wsId && userId && (
          <AddFeedModal
            workspaceId={wsId}
            userId={userId}
            onClose={() => setShowAddFeed(false)}
            onAdded={(feed) => {
              setFeeds(f => [...f, feed]);
              handleSync(feed);
            }}
            onGoogle={() => importGoogle({ prompt: true })}
          />
        )}
      </AnimatePresence>

      {/* Subscribe modal */}
      <AnimatePresence>
        {showSubscribe && wsId && (
          <SubscribeModal workspaceId={wsId} onClose={() => setShowSubscribe(false)} />
        )}
      </AnimatePresence>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
}