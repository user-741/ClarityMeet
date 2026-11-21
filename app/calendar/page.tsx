"use client";
export const dynamic = 'force-dynamic';


import { useState, useEffect, useCallback } from "react";
import { useRouter }  from "next/navigation";
import Link from "next/link";
import {
  CalendarDays, Video, Clock, Users, ChevronLeft, ChevronRight,
  Plus, RefreshCw, X, Check, AlertCircle, Link2, Wifi,
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
// Day key (YYYY-MM-DD) in the timezone chosen in Profile, so a 9am meeting never lands on the day before.
function toDateStr(iso: string | Date) { return new Date(iso).toLocaleDateString("en-CA"); }
// Calendar all-day events (birthdays, holidays) are stored from midnight UTC to midnight UTC.
function isAllDay(m: { started_at: string | null; ended_at?: string | null }) {
  if (!m.started_at || !m.started_at.match(/T00:00:00(\.000)?(Z|\+00:00)$/)) return false;
  const len = m.ended_at ? new Date(m.ended_at).getTime() - new Date(m.started_at).getTime() : 0;
  return len > 0 && len % 86400000 === 0;
}
function dayKey(m: { started_at: string | null; ended_at?: string | null }) {
  return isAllDay(m) ? m.started_at!.slice(0, 10) : toDateStr(m.started_at!);
}
function hourOf(iso: string) { return Number(new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", hourCycle: "h23" }).slice(0, 2)); }
function timeOf(iso: string) { return new Date(iso).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" }); }
function agoText(iso: string | null) {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  return h < 24 ? `${h} h ago` : new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}
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
  const todayStr = toDateStr(new Date());
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(mon);
    d.setDate(mon.getDate() + i);
    const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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
function ScheduleModal({ workspaceId, userId, onClose, onCreated, initialDate }: ScheduleModalProps & { initialDate?: string }) {
  const [addToGoogle, setAddToGoogle] = useState(!!GOOGLE_CLIENT_ID && googleRemembered());
  const [title,    setTitle]    = useState("");
  const [platform, setPlatform] = useState<Platform>("zoom");
  const [meetUrl,  setMeetUrl]  = useState("");
  const [date,     setDate]     = useState(initialDate ?? toDateStr(new Date()));
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

const CAL_CSS = `
@keyframes spin { to { transform: rotate(360deg); } }
.cal-page { position: relative; z-index: 1; background: var(--bg-base); min-height: 100%; }
.cal-layout { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 20px; padding: 20px 36px; align-items: start; }
@media (max-width: 1100px) { .cal-layout { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 700px) { .cal-layout { padding: 16px; } }
.cal-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px; flex-wrap: wrap; }
.cal-range { font-size: 18px; font-weight: 600; color: var(--text-primary); margin: 0 6px; letter-spacing: -0.01em; }
.cal-tz { font-size: 11px; color: var(--text-muted); margin-left: 4px; }
.cal-seg { display: inline-flex; padding: 2px; border-radius: 999px; background: var(--glass-surface); border: 1px solid var(--glass-border); }
.cal-seg button { border: 0; background: transparent; color: var(--text-secondary); font-size: 12px; font-weight: 600; padding: 5px 14px; border-radius: 999px; cursor: pointer; }
.cal-seg button.on { background: rgba(14,165,233,0.16); color: var(--text-primary); }
.cal-icon-btn { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; border-radius: 50%; border: 1px solid var(--glass-border); background: var(--glass-surface); color: var(--text-secondary); cursor: pointer; flex-shrink: 0; }
.cal-icon-btn:hover { color: var(--text-primary); border-color: rgba(14,165,233,0.45); }
.cal-icon-btn:disabled { opacity: 0.6; cursor: default; }
.cal-icon-danger:hover { color: var(--crimson); border-color: rgba(239,68,68,0.45); }

.cal-month-head, .cal-month-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); }
.cal-month-head div { padding: 10px; font-size: 11px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.06em; border-bottom: 1px solid var(--glass-border); }
.cal-day { min-height: 96px; padding: 6px; border-right: 1px solid var(--glass-border); border-bottom: 1px solid var(--glass-border); min-width: 0; display: flex; flex-direction: column; gap: 1px; cursor: pointer; }
.cal-day:nth-child(7n) { border-right: 0; }
.cal-day:hover { background: rgba(14,165,233,0.04); }
.cal-day.today { background: rgba(14,165,233,0.07); }
.cal-day.out .cal-day-num, .cal-day.out .cal-chip { opacity: 0.4; }
.cal-day-num { display: flex; align-items: center; justify-content: space-between; font-size: 12px; color: var(--text-secondary); margin-bottom: 2px; }
.cal-day-num span { display: inline-flex; align-items: center; justify-content: center; min-width: 24px; height: 24px; border-radius: 12px; font-weight: 500; }
.cal-day.today .cal-day-num span { background: #0EA5E9; color: #fff; font-weight: 700; }
.cal-day-add { opacity: 0; color: var(--text-muted); }
.cal-day:hover .cal-day-add { opacity: 1; }
.cal-chip { display: flex; align-items: center; gap: 6px; width: 100%; min-width: 0; text-align: left; border: 0; background: transparent; border-radius: 6px; padding: 2px 4px; cursor: pointer; font: inherit; color: var(--text-primary); }
.cal-chip:hover { background: rgba(127,127,127,0.12); }
.cal-chip.block { border-radius: 8px; padding: 5px 7px; }
.cal-chip.block:hover { filter: brightness(1.12); }
.cal-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; border: 1.5px solid; display: inline-block; }
.cal-dot.ring { background: transparent !important; }
.cal-chip { align-items: flex-start; }
.cal-chip .cal-dot { margin-top: 4px; }
.cal-chip-body { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.cal-chip-time { font-size: 10px; color: var(--text-muted); line-height: 1.3; }
.cal-chip-title { font-size: 12px; font-weight: 500; line-height: 1.3; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; word-break: break-word; }
.cal-chip-meta { font-size: 10px; color: var(--text-muted); flex-shrink: 0; }
.cal-more { border: 0; background: none; color: #38BDF8; font-size: 11px; font-weight: 600; text-align: left; padding: 2px 4px; cursor: pointer; }

.cal-week-row { display: grid; grid-template-columns: 56px repeat(7, minmax(0, 1fr)); border-bottom: 1px solid var(--glass-border); }
.cal-week-row:last-child { border-bottom: 0; }
.cal-week-head > div { padding: 10px 6px; text-align: center; }
.cal-week-dow { font-size: 11px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
.cal-week-date span { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 14px; margin-top: 4px; font-size: 13px; color: var(--text-primary); }
.cal-week-head .today .cal-week-date span { background: #0EA5E9; color: #fff; font-weight: 700; }
.cal-week-hour { padding: 8px; font-size: 11px; color: var(--text-muted); font-family: var(--font-mono); }
.cal-week-cell { position: relative; border-left: 1px solid var(--glass-border); padding: 4px; min-height: 58px; min-width: 0; display: flex; flex-direction: column; gap: 3px; cursor: pointer; }
.cal-week-cell:hover { background: rgba(14,165,233,0.04); }
.cal-now { position: absolute; left: 0; right: 0; height: 2px; background: #EF4444; z-index: 1; pointer-events: none; }
.cal-now::before { content: ""; position: absolute; left: -5px; top: -4px; width: 10px; height: 10px; border-radius: 50%; background: #EF4444; }
.cal-week-cell.today { background: rgba(14,165,233,0.04); }
.cal-week .cal-chip { flex-direction: column; align-items: flex-start; gap: 1px; }
.cal-week .cal-chip-title { width: 100%; }

.cal-side { display: flex; flex-direction: column; gap: 14px; }
.cal-card { padding: 16px; }
.cal-card-title { display: flex; align-items: center; font-size: 13px; font-weight: 700; color: var(--text-primary); margin-bottom: 10px; }
.cal-empty { font-size: 12px; color: var(--text-muted); line-height: 1.55; margin: 0; }
.cal-hint { font-size: 11px; color: var(--text-muted); margin: 10px 0 0; line-height: 1.5; }
.cal-feature { border: 1px solid; border-radius: 12px; padding: 12px; margin-bottom: 8px; background: rgba(14,165,233,0.05); }
.cal-feature-when { font-size: 11px; font-weight: 600; color: #38BDF8; }
.cal-feature-title { display: block; width: 100%; border: 0; background: none; padding: 0; margin: 3px 0 6px; text-align: left; font: inherit; font-size: 15px; font-weight: 700; color: var(--text-primary); cursor: pointer; }
.cal-feature-title:hover { text-decoration: underline; }
.cal-feature-meta { display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 12px; color: var(--text-muted); margin-bottom: 10px; }
.cal-feature-meta span { display: inline-flex; align-items: center; gap: 5px; }
.cal-feature-meta .bot-on { color: var(--emerald-pulse); }
.cal-row { display: flex; align-items: center; gap: 8px; width: 100%; padding: 7px 4px; border: 0; border-radius: 8px; background: none; cursor: pointer; font: inherit; text-align: left; }
.cal-row:hover { background: rgba(127,127,127,0.1); }
.cal-row-title { flex: 1; min-width: 0; font-size: 13px; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cal-row-when { font-size: 11px; color: var(--text-muted); white-space: nowrap; }
.cal-next { padding: 10px 0; border-top: 1px solid var(--glass-border); }
.cal-next:first-of-type { border-top: 0; padding-top: 2px; }
.cal-next-when { font-size: 11px; font-weight: 600; color: #38BDF8; margin-bottom: 3px; }
.cal-next-title { display: flex; align-items: center; gap: 8px; width: 100%; border: 0; background: none; padding: 0; cursor: pointer; text-align: left; font: inherit; font-size: 14px; font-weight: 600; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cal-next-title:hover { text-decoration: underline; }
.cal-next-meta { font-size: 12px; color: var(--text-muted); margin: 2px 0 8px 16px; }
.cal-next-actions { display: flex; gap: 6px; margin-left: 16px; flex-wrap: wrap; }
.cal-pill { display: inline-flex; align-items: center; gap: 5px; font: inherit; font-size: 12px; font-weight: 600; padding: 4px 11px; border-radius: 999px; border: 1px solid var(--glass-border); background: transparent; color: var(--text-secondary); text-decoration: none; cursor: pointer; }
.cal-pill:hover { color: var(--text-primary); border-color: rgba(14,165,233,0.45); }
.cal-pill.primary { background: #0EA5E9; border-color: #0EA5E9; color: #fff; }
.cal-count { display: inline-flex; align-items: center; justify-content: center; min-width: 18px; height: 18px; padding: 0 5px; margin-left: 6px; border-radius: 9px; background: rgba(14,165,233,0.15); color: #38BDF8; font-size: 11px; }
.cal-phone { display: flex; align-items: center; gap: 8px; width: 100%; margin-top: 8px; padding: 8px 0 0; border: 0; border-top: 1px solid var(--glass-border); background: none; color: var(--text-secondary); font: inherit; font-size: 12px; cursor: pointer; }
.cal-phone:hover { color: var(--text-primary); }
.cal-conn { display: flex; align-items: center; gap: 10px; padding: 7px 0; border-top: 1px solid var(--glass-border); }
.cal-conn:first-of-type { border-top: 0; }
.cal-conn-icon { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 50%; background: rgba(14,165,233,0.1); color: #38BDF8; flex-shrink: 0; }
.cal-conn-name { font-size: 13px; font-weight: 600; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cal-conn-detail { font-size: 11px; color: var(--text-muted); }
.cal-legend { display: flex; flex-wrap: wrap; gap: 6px 14px; padding: 0 4px; font-size: 11px; color: var(--text-muted); }
.cal-legend span { display: inline-flex; align-items: center; gap: 6px; }
.cal-legend i { width: 8px; height: 8px; border-radius: 4px; display: inline-block; }

.cal-toast { position: fixed; right: 24px; bottom: 24px; z-index: 950; display: flex; align-items: center; gap: 10px; max-width: 420px; padding: 12px 14px; border-radius: 12px; font-size: 13px; box-shadow: 0 10px 30px rgba(0,0,0,0.35); background: var(--glass-surface); backdrop-filter: blur(12px); border: 1px solid var(--glass-border); color: var(--text-primary); }
.cal-toast.ok { border-color: rgba(16,185,129,0.4); }
.cal-toast.ok svg:first-child { color: var(--emerald-pulse); }
.cal-toast.err { border-color: rgba(239,68,68,0.45); }
.cal-toast.err svg:first-child { color: var(--crimson); }
.cal-toast button { margin-left: auto; border: 0; background: none; color: var(--text-muted); cursor: pointer; display: inline-flex; }
`;

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
  const [gLastSync,    setGLastSync]    = useState<string | null>(null);
  const [syncingAll,   setSyncingAll]   = useState(false);
  const [newDate,      setNewDate]      = useState<string | null>(null);
  const [autoJoin,     setAutoJoin]     = useState(true);
  const newMeetingOn = (dateStr: string) => { setNewDate(dateStr); setShowModal(true); };

  // Success messages fade out by themselves; errors stay until closed.
  useEffect(() => {
    if (!syncMsg?.ok) return;
    const t = setTimeout(() => setSyncMsg(null), 6000);
    return () => clearTimeout(t);
  }, [syncMsg]);

  const load = useCallback(async () => {
    setLoading(true);
    const user = await getCurrentUser();
    if (!user) { router.push("/login"); return; }
    setUserId(user.id);
    const wsId = activeWorkspace?.workspace_id ??
      (await getFirstWorkspaceId(user.id));
    if (!wsId) { setLoading(false); return; }
    setWsId(wsId);
    const [{ data }, { data: prefs }] = await Promise.all([
      supabase
        .from("meetings")
        .select("id, title, platform, status, started_at, ended_at, duration_secs, participant_count, task_count, meeting_url, zoom_link, workspace_id, created_at, updated_at")
        .eq("workspace_id", wsId)
        .order("started_at", { ascending: false })
        .limit(300),
      supabase.from("user_preferences").select("bot_auto_join").eq("user_id", user.id).maybeSingle(),
    ]);
    setAutoJoin(prefs?.bot_auto_join !== false);
    const mapped: CalMeeting[] = (data ?? []).map(m => {
      const row = m as unknown as Database["public"]["Views"]["meetings_summary"]["Row"] & { meeting_url: string | null; zoom_link: string | null };
      return {
        ...row,
        meeting_url: row.meeting_url ?? row.zoom_link,
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
  const handleSync = async (feed: CalFeed, silent = false): Promise<{ inserted: number; updated: number } | null> => {
    if (!wsId || !userId) return null;
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
          setSyncMsg({ ok: true, text: `${feed.name} synced. ${json.inserted} new, ${json.updated ?? 0} updated.` });
        }
        await load();
        if (userId) loadFeeds(userId);
        return { inserted: json.inserted ?? 0, updated: json.updated ?? 0 };
      }
    } catch (e: unknown) {
      if (!silent) setSyncMsg({ ok: false, text: e instanceof Error ? e.message : "Network error" });
    } finally {
      setSyncing(null);
    }
    return null;
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
      const now = new Date().toISOString();
      setGLastSync(now);
      try { localStorage.setItem("cm_gcal_last", now); } catch { /* ignore */ }
      const toGoogle = (json.pushedNew ?? 0) + (json.pushedUpdated ?? 0);
      if (!opts.silent || json.inserted || json.updated || toGoogle) {
        setSyncMsg({ ok: true, text: `Google Calendar synced. ${json.inserted ?? 0} brought in, ${toGoogle} sent to Google.` });
      }
      await load();
    } catch (e) {
      if (!opts.silent) throw e;
    } finally {
      setGSyncing(false);
    }
  }, [wsId, load]);

  useEffect(() => { try { setGLastSync(localStorage.getItem("cm_gcal_last")); } catch { /* ignore */ } }, []);

  // One button that syncs Google and every linked calendar, then shows one message.
  const syncAll = async () => {
    setSyncingAll(true);
    setSyncMsg(null);
    const failed: string[] = [];
    let brought = 0;
    for (const f of feeds) {
      const r = await handleSync(f, true);
      if (r) brought += r.inserted; else failed.push(f.name);
    }
    if (googleOn) {
      try { await importGoogle({}); } catch { failed.push("Google Calendar"); }
    }
    setSyncingAll(false);
    if (failed.length) setSyncMsg({ ok: false, text: `Could not sync ${failed.join(", ")}. Try again or reconnect it.` });
    else if (!googleOn) setSyncMsg({ ok: true, text: `All calendars synced. ${brought} new meeting${brought === 1 ? "" : "s"}.` });
  };

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
  const meetingsOn = (date: string) =>
    meetings.filter(m => m.started_at && dayKey(m) === date)
      .sort((a, b) => Number(isAllDay(b)) - Number(isAllDay(a)) || new Date(a.started_at!).getTime() - new Date(b.started_at!).getTime());

  const step = (dir: number) => {
    const d = new Date(anchor);
    if (view === "week") d.setDate(d.getDate() + dir * 7);
    else d.setMonth(d.getMonth() + dir);
    setAnchor(d);
  };
  const rangeLabel = view === "week"
    ? `${weekDays[0].date} – ${weekDays[6].date}`
    : anchor.toLocaleDateString("en-AU", { month: "long", year: "numeric" });

  const platformIcon = (p: Platform) => PLATFORM_ICONS[p] ?? <Link2 size={13} />;
  const platformColor = (p: Platform) => PLATFORM_COLORS[p] ?? "#6B7280";
  // A real meeting has a join link or was recorded. Plain calendar events (a birthday, a reminder) get a hollow dot.
  const isMeeting = (m: CalMeeting) => !isAllDay(m);
  const whenText = (m: CalMeeting) => {
    if (!m.started_at) return "";
    if (isAllDay(m)) return "All day";
    return `${timeOf(m.started_at)}${m.ended_at ? ` – ${timeOf(m.ended_at)}` : ""}`;
  };
  const botText = (m: CalMeeting) => {
    if (m.status === "complete") return "Summary ready";
    if (m.status === "recording") return "Bot is recording";
    if (!m.meeting_url) return isAllDay(m) ? "" : "No meeting link";
    return autoJoin && (m.platform === "zoom" || m.platform === "teams") ? "Bot will join" : "Bot not scheduled";
  };
  const platformName = (p: Platform) => ({ zoom: "Zoom", google_meet: "Google Meet", teams: "Teams", webex: "Webex", upload: "Upload", other: "Other" })[p] ?? "Other";

  const now = Date.now();
  const upcoming = meetings
    .filter(m => m.started_at && new Date(m.started_at).getTime() > now - 30 * 60000 && m.status !== "complete")
    .sort((a, b) => new Date(a.started_at!).getTime() - new Date(b.started_at!).getTime())
    .slice(0, 5);
  const listUpcoming = meetings.filter(m => m.started_at && new Date(m.started_at).getTime() >= now)
    .sort((a, b) => new Date(a.started_at!).getTime() - new Date(b.started_at!).getTime());
  const listPast = meetings.filter(m => !m.started_at || new Date(m.started_at).getTime() < now);

  const anySyncing = syncingAll || gSyncing || !!syncing;
  const connections = (googleOn ? 1 : 0) + feeds.length;
  const lastSynced = [gLastSync, ...feeds.map(f => f.last_synced)].filter(Boolean).sort().pop() ?? null;

  const statusBadge = (st: string | null) => (
    <span className={`badge ${st === "complete" ? "badge-green" : st === "recording" ? "badge-red" : st === "scheduled" ? "badge-blue" : "badge-muted"}`}>
      {st === "complete" ? "Summarised" : st === "scheduled" ? "Upcoming" : st}
    </span>
  );

  // A meeting chip used in the week and month grids
  const Chip = ({ m, compact = false }: { m: CalMeeting; compact?: boolean }) => (
    <button className={`cal-chip${compact ? "" : " block"}`} onClick={e => { e.stopPropagation(); setSelected(m); }} title={m.title || "Meeting"}
      style={compact ? undefined : { background: `${platformColor(m.platform)}22`, color: "var(--text-primary)" }}>
      {compact && <i className={`cal-dot${isMeeting(m) ? "" : " ring"}`} style={{ background: isMeeting(m) ? platformColor(m.platform) : "transparent", borderColor: platformColor(m.platform) }} />}
      <span className="cal-chip-body">
        <span className="cal-chip-time">{isAllDay(m) ? "All day" : m.started_at ? timeOf(m.started_at) : ""}</span>
        <span className="cal-chip-title">{m.title || "Untitled meeting"}</span>
        {!compact && !isAllDay(m) && <span className="cal-chip-meta">{botText(m)}</span>}
      </span>
    </button>
  );

  const ConnectionRow = ({ icon, name, detail, busy, onSync, onRemove }: { icon: JSX.Element; name: string; detail: string; busy: boolean; onSync: () => void; onRemove: () => void }) => (
    <div className="cal-conn">
      <span className="cal-conn-icon">{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="cal-conn-name">{name}</div>
        <div className="cal-conn-detail">{detail}</div>
      </div>
      <button className="cal-icon-btn" onClick={onSync} disabled={busy} title="Sync now" aria-label={`Sync ${name}`}>
        <RefreshCw size={13} style={busy ? { animation: "spin 0.8s linear infinite" } : {}} />
      </button>
      <button className="cal-icon-btn cal-icon-danger" onClick={onRemove} title="Disconnect" aria-label={`Disconnect ${name}`}>
        <X size={13} />
      </button>
    </div>
  );

  return (
    <>
      <div style={{ paddingBottom: "48px" }} className="page-enter cal-page">
        <div className="page-header">
          <div>
            <div className="page-header-title">Calendar</div>
            <div className="page-header-sub">
              {listUpcoming.length} upcoming · {connections ? `${connections} calendar${connections === 1 ? "" : "s"} linked · synced ${agoText(lastSynced)}` : "no calendars linked yet"}
            </div>
          </div>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
            {connections > 0 && (
              <button className="btn btn-secondary btn-sm" onClick={syncAll} disabled={anySyncing}>
                <RefreshCw size={13} style={anySyncing ? { animation: "spin 0.8s linear infinite" } : {}} />
                {anySyncing ? "Syncing..." : "Sync now"}
              </button>
            )}
            <button className="btn btn-primary btn-sm" onClick={() => setShowModal(true)} disabled={!wsId || !userId}>
              <Plus size={13} /> New meeting
            </button>
          </div>
        </div>

        <div className="page-body cal-layout">
          {/* Main calendar */}
          <div style={{ minWidth: 0 }}>
            <div className="cal-toolbar">
              {view !== "list" ? (
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <button className="cal-icon-btn" onClick={() => step(-1)} aria-label="Previous"><ChevronLeft size={16} /></button>
                  <button className="cal-icon-btn" onClick={() => step(1)} aria-label="Next"><ChevronRight size={16} /></button>
                  <span className="cal-range">{rangeLabel}</span>
                  <button className="btn btn-ghost btn-sm" onClick={() => setAnchor(new Date())}>Today</button>
                  <span className="cal-tz">{Intl.DateTimeFormat().resolvedOptions().timeZone.replace(/_/g, " ")}</span>
                </div>
              ) : <span className="cal-range">All meetings</span>}
              <div className="cal-seg" role="tablist" aria-label="Calendar view">
                {(["month", "week", "list"] as ViewMode[]).map(v => (
                  <button key={v} role="tab" aria-selected={view === v} className={view === v ? "on" : ""} onClick={() => setView(v)}>
                    {v === "month" ? "Month" : v === "week" ? "Week" : "List"}
                  </button>
                ))}
              </div>
            </div>

            {loading ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "40vh" }}>
                <div style={{ width: "32px", height: "32px", border: "3px solid var(--glass-border)", borderTopColor: "#0EA5E9", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
              </div>
            ) : (
              <>
                {/* MONTH VIEW */}
                {view === "month" && (
                  <div className="data-card cal-month">
                    <div className="cal-month-head">
                      {DAYS.map(d => <div key={d}>{d}</div>)}
                    </div>
                    <div className="cal-month-grid">
                      {(() => {
                        const y = anchor.getFullYear(), mo = anchor.getMonth();
                        const offset = (new Date(y, mo, 1).getDay() + 6) % 7; // Monday first
                        const cells = Math.ceil((offset + new Date(y, mo + 1, 0).getDate()) / 7) * 7;
                        const todayStr = toDateStr(new Date());
                        return Array.from({ length: cells }).map((_, i) => {
                          const d = new Date(y, mo, i - offset + 1);
                          const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
                          const inMonth = d.getMonth() === mo;
                          const dayMeetings = meetingsOn(dateStr);
                          const isToday = dateStr === todayStr;
                          return (
                            <div key={dateStr} className={`cal-day${inMonth ? "" : " out"}${isToday ? " today" : ""}`} onClick={() => newMeetingOn(dateStr)} title="Click to add a meeting">
                              <div className="cal-day-num"><span>{d.getDate()}</span><Plus size={12} className="cal-day-add" /></div>
                              {dayMeetings.slice(0, 3).map(m => <Chip key={m.id} m={m} compact />)}
                              {dayMeetings.length > 3 && (
                                <button className="cal-more" onClick={e => { e.stopPropagation(); setAnchor(d); setView("week"); }}>+{dayMeetings.length - 3} more</button>
                              )}
                            </div>
                          );
                        });
                      })()}
                    </div>
                  </div>
                )}

                {/* WEEK VIEW */}
                {view === "week" && (
                  <div className="data-card cal-week">
                    <div className="cal-week-row cal-week-head">
                      <div />
                      {weekDays.map(d => (
                        <div key={d.dateStr} className={d.isToday ? "today" : ""}>
                          <div className="cal-week-dow">{d.label}</div>
                          <div className="cal-week-date"><span>{d.date.split(" ")[0]}</span></div>
                        </div>
                      ))}
                    </div>
                    {HOURS.map(hour => (
                      <div key={hour} className="cal-week-row">
                        <div className="cal-week-hour">{hour}</div>
                        {weekDays.map(d => {
                          const h = Number(hour.slice(0, 2));
                          const inSlot = meetingsOn(d.dateStr).filter(m => {
                            const mh = hourOf(m.started_at!);
                            return mh === h || (mh < 8 && h === 8) || (mh > 18 && h === 18);
                          });
                          return (
                            <div key={d.dateStr} className={`cal-week-cell${d.isToday ? " today" : ""}`} onClick={() => newMeetingOn(d.dateStr)}>
                              {d.isToday && hourOf(new Date().toISOString()) === h && (
                                <div className="cal-now" style={{ top: `${(new Date().getMinutes() / 60) * 100}%` }} aria-label="Now" />
                              )}
                              {inSlot.map(m => <Chip key={m.id} m={m} />)}
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                )}

                {/* LIST VIEW */}
                {view === "list" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
                    {[{ label: "Upcoming", rows: listUpcoming }, { label: "Past", rows: listPast.slice(0, 100) }].map(group => (
                      <div key={group.label} className="data-card">
                        <div className="cal-card-title" style={{ padding: "14px 18px 0" }}>{group.label} <span style={{ color: "var(--text-muted)", fontWeight: 500 }}>· {group.rows.length}</span></div>
                        <table className="data-table">
                          <thead><tr><th>Meeting</th><th>Platform</th><th>When</th><th>Length</th><th>Status</th><th></th></tr></thead>
                          <tbody>
                            {group.rows.map(m => (
                              <tr key={m.id} style={{ cursor: "pointer" }} onClick={() => setSelected(m)}>
                                <td>
                                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                                    <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: platformColor(m.platform), flexShrink: 0 }} />
                                    <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>{m.title || "Untitled meeting"}</span>
                                  </div>
                                </td>
                                <td><span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "var(--text-secondary)" }}>{platformIcon(m.platform)} {platformName(m.platform)}</span></td>
                                <td style={{ fontSize: "13px" }}>{m.started_at ? new Date(m.started_at).toLocaleString("en-AU", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "-"}</td>
                                <td style={{ fontSize: "13px" }}>{fmtDuration(m.duration_secs)}</td>
                                <td>{statusBadge(m.status)}</td>
                                <td style={{ textAlign: "right" }}>
                                  {m.meeting_url && m.status !== "complete" && (
                                    <a href={`/bot?url=${encodeURIComponent(m.meeting_url)}`} className="btn btn-ghost btn-sm" style={{ textDecoration: "none", fontSize: "11px" }} onClick={e => e.stopPropagation()}>
                                      <Video size={11} /> Send bot
                                    </a>
                                  )}
                                </td>
                              </tr>
                            ))}
                            {group.rows.length === 0 && (
                              <tr><td colSpan={6} style={{ textAlign: "center", padding: "32px", color: "var(--text-muted)" }}>
                                {group.label === "Upcoming" ? "Nothing coming up. Schedule a meeting or link a calendar." : "No past meetings yet."}
                              </td></tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Side panel */}
          <aside className="cal-side">
            <div className="data-card cal-card">
              <div className="cal-card-title">Up next</div>
              {upcoming.length === 0 && <p className="cal-empty">No upcoming meetings.</p>}
              {upcoming.map((m, i) => {
                const start = new Date(m.started_at!);
                const today = toDateStr(start) === toDateStr(new Date());
                const tomorrow = toDateStr(start) === toDateStr(new Date(Date.now() + 86400000));
                const day = today ? "Today" : tomorrow ? "Tomorrow" : start.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });
                const mins = m.ended_at ? Math.round((new Date(m.ended_at).getTime() - start.getTime()) / 60000) : 0;
                if (i === 0) return (
                  <div key={m.id} className="cal-feature" style={{ borderColor: `${platformColor(m.platform)}55` }}>
                    <div className="cal-feature-when">{day} · {whenText(m)}{mins && !isAllDay(m) ? ` (${fmtDuration(mins * 60)})` : ""}</div>
                    <button className="cal-feature-title" onClick={() => setSelected(m)}>{m.title || "Untitled meeting"}</button>
                    <div className="cal-feature-meta">
                      <span><i className="cal-dot" style={{ background: platformColor(m.platform), borderColor: platformColor(m.platform) }} />{platformName(m.platform)}</span>
                      {m.participant_count ? <span><Users size={11} /> {m.participant_count}</span> : null}
                      {botText(m) && <span className={botText(m) === "Bot will join" ? "bot-on" : ""}><Video size={11} /> {botText(m)}</span>}
                    </div>
                    <div className="cal-next-actions" style={{ marginLeft: 0 }}>
                      {m.meeting_url && <a className="cal-pill primary" href={m.meeting_url} target="_blank" rel="noreferrer">Join</a>}
                      {m.meeting_url && botText(m) !== "Bot will join" && <Link className="cal-pill" href={`/bot?url=${encodeURIComponent(m.meeting_url)}`}>Send bot</Link>}
                      <button className="cal-pill" onClick={() => setSelected(m)}>Details</button>
                    </div>
                  </div>
                );
                return (
                  <button key={m.id} className="cal-row" onClick={() => setSelected(m)} title={m.title || "Meeting"}>
                    <i className={`cal-dot${isMeeting(m) ? "" : " ring"}`} style={{ background: platformColor(m.platform), borderColor: platformColor(m.platform) }} />
                    <span className="cal-row-title">{m.title || "Untitled meeting"}</span>
                    <span className="cal-row-when">{today ? "" : `${day.split(",")[0]} `}{isAllDay(m) ? "All day" : timeOf(m.started_at!)}</span>
                  </button>
                );
              })}
            </div>

            <div className="data-card cal-card">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
                <div className="cal-card-title" style={{ marginBottom: 0 }}>Calendars {connections > 0 && <span className="cal-count">{connections}</span>}</div>
                <button className="btn btn-ghost btn-sm" onClick={() => setShowAddFeed(true)} disabled={!wsId || !userId} style={{ fontSize: "12px" }}>
                  <Plus size={12} /> Add
                </button>
              </div>
              {connections === 0 && (
                <p className="cal-empty">Link Google, Outlook or iCloud to bring meetings in.</p>
              )}
              {googleOn && (
                <ConnectionRow
                  icon={<CalendarDays size={15} />}
                  name="Google Calendar"
                  detail={`Synced ${agoText(gLastSync)}`}
                  busy={gSyncing}
                  onSync={() => importGoogle().catch(e => setSyncMsg({ ok: false, text: e instanceof Error ? e.message : "Google Calendar sync failed" }))}
                  onRemove={disconnectGoogle}
                />
              )}
              {feeds.map(feed => (
                <ConnectionRow
                  key={feed.id}
                  icon={FEED_ICONS[feed.provider] ?? <Link2 size={15} />}
                  name={feed.name}
                  detail={`Synced ${agoText(feed.last_synced)}`}
                  busy={syncing === feed.id}
                  onSync={() => { handleSync(feed); }}
                  onRemove={() => handleDeleteFeed(feed.id)}
                />
              ))}
              {connections === 0 && (
                <button className="btn btn-secondary btn-sm" onClick={() => setShowAddFeed(true)} disabled={!wsId || !userId} style={{ width: "100%", justifyContent: "center", marginTop: "4px" }}>
                  <Wifi size={13} /> Link a calendar
                </button>
              )}
              <button className="cal-phone" onClick={() => setShowSubscribe(true)} disabled={!wsId}>
                <Smartphone size={13} /> Show these meetings on my phone
              </button>
            </div>

            <div className="cal-legend">
              {(["zoom", "teams", "google_meet", "upload"] as Platform[]).map(p => (
                <span key={p}><i style={{ background: platformColor(p) }} />{platformName(p)}</span>
              ))}
              <span><i style={{ background: "transparent", border: "1.5px solid var(--text-muted)" }} />All-day event</span>
            </div>
          </aside>
        </div>
      </div>

      {/* Sync message, bottom right */}
      <AnimatePresence>
        {syncMsg && (
          <motion.div role="status" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16 }}
            className={`cal-toast ${syncMsg.ok ? "ok" : "err"}`}>
            {syncMsg.ok ? <Check size={15} /> : <AlertCircle size={15} />}
            <span>{syncMsg.text}</span>
            <button onClick={() => setSyncMsg(null)} aria-label="Dismiss"><X size={14} /></button>
          </motion.div>
        )}
      </AnimatePresence>

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
                  { icon: <CalendarDays size={13} />, label: "Date", value: selected.started_at ? new Date(isAllDay(selected) ? `${selected.started_at.slice(0, 10)}T12:00:00` : selected.started_at).toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : "-" },
                  { icon: <Clock size={13} />, label: "Time", value: whenText(selected) || "-" },
                  { icon: <Video size={13} />, label: "Bot", value: botText(selected) || "-" },
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
            initialDate={newDate ?? undefined}
            onClose={() => { setShowModal(false); setNewDate(null); }}
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

      <style>{CAL_CSS}</style>
    </>
  );
}